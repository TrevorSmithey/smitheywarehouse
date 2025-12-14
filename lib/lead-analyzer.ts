/**
 * Claude AI Lead Analyzer
 * Analyzes Typeform leads to evaluate fit for Smithey wholesale/corporate partnerships
 */

import Anthropic from "@anthropic-ai/sdk";
import type { TypeformLead, LeadFormType } from "./types";

// Lazy-initialize Anthropic client
let anthropic: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY environment variable is not set");
    }
    anthropic = new Anthropic({ apiKey });
  }
  return anthropic;
}

// B2B Wholesale analysis prompt - evaluates retail/hospitality partners
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

// Corporate/Gifting analysis prompt - evaluates corporate gift buyers
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

export interface LeadAnalysisResult {
  summary: string;
  fit_score: number;
  strengths: string[];
  concerns: string[];
  recommendation: string;
  analysisFailed?: boolean;
  error?: string;
}

/**
 * Format B2B wholesale lead data for analysis
 */
function formatB2BLeadContext(lead: TypeformLead): string {
  const lines: string[] = [
    `Company: ${lead.company_name}`,
  ];

  if (lead.contact_first_name || lead.contact_last_name) {
    lines.push(`Contact: ${[lead.contact_first_name, lead.contact_last_name].filter(Boolean).join(" ")}${lead.contact_title ? ` (${lead.contact_title})` : ""}`);
  }
  if (lead.email) lines.push(`Email: ${lead.email}`);
  if (lead.industry) lines.push(`Industry: ${lead.industry}`);
  if (lead.years_in_business) lines.push(`Years in Business: ${lead.years_in_business}`);
  if (lead.store_type) lines.push(`Store Type: ${lead.store_type}`);
  if (lead.location_count) lines.push(`Locations: ${lead.location_count}`);

  // Address
  const addressParts = [lead.city, lead.state].filter(Boolean);
  if (addressParts.length > 0) {
    lines.push(`Location: ${addressParts.join(", ")}`);
  }

  // Web presence
  if (lead.has_website !== null) {
    lines.push(`Has Website: ${lead.has_website ? "Yes" : "No"}`);
    if (lead.website) lines.push(`Website: ${lead.website}`);
  }
  if (lead.has_instagram !== null) {
    lines.push(`Has Instagram: ${lead.has_instagram ? "Yes" : "No"}`);
    if (lead.instagram_url) lines.push(`Instagram: ${lead.instagram_url}`);
  }

  // Qualitative responses - these are KEY for evaluation
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

/**
 * Format corporate gifting lead data for analysis
 */
function formatCorporateLeadContext(lead: TypeformLead): string {
  const lines: string[] = [
    `Company: ${lead.company_name}`,
  ];

  if (lead.contact_first_name || lead.contact_last_name) {
    lines.push(`Contact: ${[lead.contact_first_name, lead.contact_last_name].filter(Boolean).join(" ")}`);
  }
  if (lead.email) lines.push(`Email: ${lead.email}`);
  if (lead.phone) lines.push(`Phone: ${lead.phone}`);

  // Corporate leads store details in notes field from import
  if (lead.notes) {
    lines.push(`Gifting Details: ${lead.notes}`);
  }

  return lines.join("\n");
}

/**
 * Analyze a single lead using Claude
 */
export async function analyzeLead(lead: TypeformLead): Promise<LeadAnalysisResult> {
  const isB2B = lead.form_type === "wholesale";
  const systemPrompt = isB2B ? B2B_WHOLESALE_PROMPT : CORPORATE_GIFTING_PROMPT;
  const leadContext = isB2B
    ? formatB2BLeadContext(lead)
    : formatCorporateLeadContext(lead);

  try {
    const response = await getAnthropicClient().messages.create({
      model: "claude-3-5-haiku-20241022",
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
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[LEAD ANALYSIS FAILURE]", errorMessage);

    return {
      summary: `Analysis failed: ${errorMessage}`,
      fit_score: 0,
      strengths: [],
      concerns: [],
      recommendation: "REVIEW",
      analysisFailed: true,
      error: errorMessage,
    };
  }
}

/**
 * Parse and validate the JSON response from Claude
 */
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

  // Validate and normalize
  const summary = typeof parsed.summary === "string" ? parsed.summary : "Analysis incomplete.";
  const fit_score = typeof parsed.fit_score === "number"
    ? Math.max(1, Math.min(5, Math.round(parsed.fit_score)))
    : 3;
  const strengths = Array.isArray(parsed.strengths)
    ? parsed.strengths.filter((s): s is string => typeof s === "string")
    : [];
  const concerns = Array.isArray(parsed.concerns)
    ? parsed.concerns.filter((c): c is string => typeof c === "string")
    : [];
  const recommendation = typeof parsed.recommendation === "string"
    ? parsed.recommendation
    : "REVIEW";

  return { summary, fit_score, strengths, concerns, recommendation };
}

/**
 * Batch analyze leads with rate limiting
 */
export async function analyzeLeadsBatch(
  leads: TypeformLead[],
  onProgress?: (completed: number, total: number, lead: TypeformLead, result: LeadAnalysisResult) => void
): Promise<Map<number, LeadAnalysisResult>> {
  const results = new Map<number, LeadAnalysisResult>();
  const total = leads.length;

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const result = await analyzeLead(lead);
    results.set(lead.id, result);

    if (onProgress) {
      onProgress(i + 1, total, lead, result);
    }

    // Rate limiting - max 5 requests per second
    if (i < leads.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return results;
}
