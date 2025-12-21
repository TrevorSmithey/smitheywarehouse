/**
 * Lead Analysis Backfill Script
 *
 * Run this script to backfill AI analysis for all leads missing scores.
 * Uses the same Claude Haiku model as the cron job.
 *
 * Usage: npx tsx scripts/backfill-lead-analysis.ts
 *
 * Progress is saved after each batch, so the script can be stopped and resumed.
 */

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import type { TypeformLead, LeadFormType } from "../lib/types";
import { config } from "dotenv";

// Load .env.local
config({ path: ".env.local" });

// Configuration
const BATCH_SIZE = 50;
const DELAY_BETWEEN_CALLS_MS = 200; // Rate limit: 5 req/sec
const DELAY_BETWEEN_BATCHES_MS = 5000; // 5 second pause between batches

// Initialize clients
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// B2B Wholesale analysis prompt
const B2B_WHOLESALE_PROMPT = `You are evaluating wholesale partnership applications for Smithey Ironware, a premium cast iron and carbon steel cookware company based in Charleston, SC. Our products are heirloom-quality, handcrafted cookware priced at $200-$500+ per piece.

IDEAL WHOLESALE PARTNERS:
- Established retail stores with 3+ years in business
- Premium kitchenware, home goods, or specialty food stores
- High-end hospitality (restaurants, hotels, resorts)
- Curated lifestyle boutiques with affluent clientele
- Strong physical presence (brick & mortar preferred)
- Professional web presence and/or social media
- Clear understanding of premium positioning

RED FLAGS:
- Brand new businesses (<1 year)
- Mass-market discount retailers
- Vague or generic business descriptions
- No web/social presence
- Commodity-focused retailers
- Generic "kitchen supplies" without premium positioning

EVALUATE THIS APPLICATION:
1. Business maturity (years, locations, established presence)
2. Industry/niche fit (does their customer match ours?)
3. Quality of application (thoughtful responses vs rushed/generic)
4. Web/social presence (indicates professionalism)
5. Geographic fit (Charleston roots resonate with Southern/coastal)
6. Referral source (organic discovery vs wholesale directory)

Return JSON with:
{
  "summary": "2-3 sentence assessment of who this is and their fit",
  "fit_score": 1-5 (1=poor, 3=maybe, 5=excellent),
  "strengths": ["list", "of", "positives"],
  "concerns": ["list", "of", "concerns"],
  "recommendation": "APPROVE" | "REVIEW" | "DECLINE"
}

Only output valid JSON.`;

// Corporate/Gifting analysis prompt
const CORPORATE_GIFTING_PROMPT = `You are evaluating corporate gifting inquiries for Smithey Ironware, a premium cast iron and carbon steel cookware company. Our corporate program serves businesses giving high-end gifts to clients, employees, or partners.

IDEAL CORPORATE CLIENTS:
- Established companies with meaningful gifting budgets
- Executive/VIP gift programs
- Client appreciation gifts
- Employee milestone awards (5/10/25 year, retirement)
- Holiday gifting programs
- Real estate closing gifts
- Hospitality/hotel guest amenities

GIFTING CONSIDERATIONS:
- Minimum orders typically 10-25+ pieces
- Personalized engraving available
- Premium presentation/packaging
- Individual or bulk shipping options
- Lead time 4-6 weeks for custom orders

EVALUATE:
1. Company legitimacy (real business vs personal inquiry)
2. Order scale (number of recipients)
3. Use case appropriateness (are these good recipients for $200+ cookware?)
4. Engraving interest (indicates higher intent/customization)
5. Contact quality (professional email, complete information)

Return JSON with:
{
  "summary": "2-3 sentence assessment of who this is and their gifting needs",
  "fit_score": 1-5 (1=poor, 3=maybe, 5=excellent),
  "strengths": ["list", "of", "positives"],
  "concerns": ["list", "of", "concerns"],
  "recommendation": "HIGH_PRIORITY" | "STANDARD" | "LOW_PRIORITY"
}

Only output valid JSON.`;

interface LeadAnalysisResult {
  summary: string;
  fit_score: number;
  strengths: string[];
  concerns: string[];
  recommendation: string;
}

function formatB2BLeadContext(lead: TypeformLead): string {
  const lines: string[] = [`Company: ${lead.company_name}`];

  if (lead.contact_first_name || lead.contact_last_name) {
    lines.push(
      `Contact: ${[lead.contact_first_name, lead.contact_last_name].filter(Boolean).join(" ")}${lead.contact_title ? ` (${lead.contact_title})` : ""}`
    );
  }
  if (lead.email) lines.push(`Email: ${lead.email}`);
  if (lead.industry) lines.push(`Industry: ${lead.industry}`);
  if (lead.years_in_business) lines.push(`Years in Business: ${lead.years_in_business}`);
  if (lead.store_type) lines.push(`Store Type: ${lead.store_type}`);
  if (lead.location_count) lines.push(`Locations: ${lead.location_count}`);

  const addressParts = [lead.city, lead.state].filter(Boolean);
  if (addressParts.length > 0) {
    lines.push(`Location: ${addressParts.join(", ")}`);
  }

  if (lead.has_website !== null) {
    lines.push(`Has Website: ${lead.has_website ? "Yes" : "No"}`);
    if (lead.website) lines.push(`Website: ${lead.website}`);
  }
  if (lead.has_instagram !== null) {
    lines.push(`Has Instagram: ${lead.has_instagram ? "Yes" : "No"}`);
    if (lead.instagram_url) lines.push(`Instagram: ${lead.instagram_url}`);
  }

  if (lead.referral_source) {
    lines.push(`How they heard about Smithey: ${lead.referral_source}`);
  }
  if (lead.fit_reason) {
    lines.push(`Why they think they'd be a good fit: ${lead.fit_reason}`);
  }
  if (lead.notes) {
    lines.push(`Additional notes: ${lead.notes}`);
  }

  return lines.join("\n");
}

function formatCorporateLeadContext(lead: TypeformLead): string {
  const lines: string[] = [`Company: ${lead.company_name}`];

  if (lead.contact_first_name || lead.contact_last_name) {
    lines.push(
      `Contact: ${[lead.contact_first_name, lead.contact_last_name].filter(Boolean).join(" ")}`
    );
  }
  if (lead.email) lines.push(`Email: ${lead.email}`);
  if (lead.phone) lines.push(`Phone: ${lead.phone}`);

  if (lead.notes) {
    lines.push(`Gifting Details: ${lead.notes}`);
  }

  return lines.join("\n");
}

function parseAnalysisResponse(text: string): LeadAnalysisResult {
  let jsonText = text.trim();

  // Extract JSON from markdown code blocks if present
  const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    jsonText = jsonMatch[1];
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    // Try to fix common JSON issues
    jsonText = jsonText.replace(/'/g, '"').replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
    parsed = JSON.parse(jsonText);
  }

  const summary = typeof parsed.summary === "string" ? parsed.summary : "Analysis incomplete.";
  const fit_score =
    typeof parsed.fit_score === "number"
      ? Math.max(1, Math.min(5, Math.round(parsed.fit_score)))
      : 3;
  const strengths = Array.isArray(parsed.strengths)
    ? parsed.strengths.filter((s): s is string => typeof s === "string")
    : [];
  const concerns = Array.isArray(parsed.concerns)
    ? parsed.concerns.filter((c): c is string => typeof c === "string")
    : [];
  const recommendation = typeof parsed.recommendation === "string" ? parsed.recommendation : "REVIEW";

  return { summary, fit_score, strengths, concerns, recommendation };
}

async function analyzeLead(lead: TypeformLead): Promise<LeadAnalysisResult | null> {
  const isB2B = lead.form_type === "wholesale";
  const systemPrompt = isB2B ? B2B_WHOLESALE_PROMPT : CORPORATE_GIFTING_PROMPT;
  const leadContext = isB2B ? formatB2BLeadContext(lead) : formatCorporateLeadContext(lead);

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-latest",
      max_tokens: 800,
      temperature: 0.3,
      messages: [
        {
          role: "user",
          content: `Analyze this ${isB2B ? "wholesale partnership" : "corporate gifting"} application:\n\n${leadContext}`,
        },
      ],
      system: systemPrompt,
    });

    const textContent = response.content.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") {
      throw new Error("No text response from Claude");
    }

    return parseAnalysisResponse(textContent.text);
  } catch (error) {
    console.error(`  Error analyzing lead ${lead.id}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("Lead Analysis Backfill Script");
  console.log("=".repeat(60));

  // Get count of unanalyzed YTD leads (2025+)
  const { count: totalCount } = await supabase
    .from("typeform_leads")
    .select("*", { count: "exact", head: true })
    .is("ai_fit_score", null)
    .gte("submitted_at", "2025-01-01");

  console.log(`\nFound ${totalCount} YTD leads needing analysis\n`);

  if (!totalCount || totalCount === 0) {
    console.log("No leads to analyze. Exiting.");
    return;
  }

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let batchNum = 0;

  while (processed < totalCount) {
    batchNum++;
    console.log(`\n--- Batch ${batchNum} (${processed}/${totalCount} completed) ---`);

    // Fetch next batch of unanalyzed YTD leads
    const { data: leads, error } = await supabase
      .from("typeform_leads")
      .select("*")
      .is("ai_fit_score", null)
      .gte("submitted_at", "2025-01-01")
      .order("submitted_at", { ascending: false })
      .limit(BATCH_SIZE);

    if (error) {
      console.error("Error fetching leads:", error);
      break;
    }

    if (!leads || leads.length === 0) {
      console.log("No more leads to process.");
      break;
    }

    for (const lead of leads as TypeformLead[]) {
      process.stdout.write(`  [${lead.id}] ${lead.company_name.substring(0, 30).padEnd(30)}... `);

      const analysis = await analyzeLead(lead);

      if (analysis) {
        // Update the lead with analysis results
        const { error: updateError } = await supabase
          .from("typeform_leads")
          .update({
            ai_summary: analysis.summary,
            ai_fit_score: analysis.fit_score,
            ai_analyzed_at: new Date().toISOString(),
          })
          .eq("id", lead.id);

        if (updateError) {
          console.log(`DB ERROR: ${updateError.message}`);
          failed++;
        } else {
          console.log(`Score ${analysis.fit_score}/5 - ${analysis.recommendation}`);
          succeeded++;
        }
      } else {
        console.log("ANALYSIS FAILED");
        failed++;
      }

      processed++;

      // Rate limiting
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_CALLS_MS));
    }

    console.log(`\nBatch ${batchNum} complete. Progress: ${succeeded} succeeded, ${failed} failed`);

    // Pause between batches
    if (processed < totalCount) {
      console.log(`Pausing ${DELAY_BETWEEN_BATCHES_MS / 1000}s before next batch...`);
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("BACKFILL COMPLETE");
  console.log("=".repeat(60));
  console.log(`Total processed: ${processed}`);
  console.log(`Succeeded: ${succeeded}`);
  console.log(`Failed: ${failed}`);
  console.log(`Success rate: ${((succeeded / processed) * 100).toFixed(1)}%`);
}

main().catch(console.error);
