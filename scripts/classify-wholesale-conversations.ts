/**
 * Wholesale Conversations Classification (V2)
 *
 * Uses Claude API to classify conversations with focus on:
 * - What the customer actually wants (plain English)
 * - Who should handle it (Sales vs Support)
 * - Complexity for workload planning
 *
 * Usage: npx tsx scripts/classify-wholesale-conversations.ts
 * Options:
 *   --limit=100     Process only N unclassified conversations
 *   --reclassify    Re-classify all conversations (ignore existing)
 *   --batch=20      Batch size for processing
 */

import * as dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

// Configuration
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// Use Haiku for speed and cost efficiency
const MODEL = "claude-3-5-haiku-20241022";
const BATCH_SIZE = 50;  // Larger batches
const PARALLEL_REQUESTS = 10;  // Concurrent API calls
const DELAY_BETWEEN_BATCHES = 500; // ms

// The improved classification prompt
const CLASSIFICATION_PROMPT = `You are a senior B2B operations analyst with 15+ years managing sales and support teams. You understand the difference between inquiries requiring relationship management, negotiation, and commercial judgment versus process execution, system lookups, and policy application.

Analyze this wholesale support conversation for Smithey Ironware, a premium cookware manufacturer. The goal is understanding what wholesale customers are asking about to determine whether inquiries should be handled by sales representatives or customer support staff.

EXCLUDE AS NOISE (return only {"is_noise": true, "noise_type": "description"}):
- Automated payment notifications (streamlinedpayments.com)
- EDI system messages (Williams-Sonoma automated)
- Internal emails (@smitheyironware.com)
- Vendor marketing, supplier solicitations
- Form submissions, spam, system notifications

Return JSON:
{
  "is_noise": false,

  "what_they_want": "plain English, be specific and concrete, 1-2 sentences",

  "primary_topic": "your best categorization in 2-4 words",

  "known_category": "Product Issue | Order/Restock | Payment/Credit | Pricing/Terms | New Business | Relationship | None of These",

  "requires": "Sales | Support | Either",
  "requires_reasoning": "one sentence explaining why",

  "complexity": "Simple | Moderate | Complex",

  "customer_company": "extracted from domain or signature, null if unclear",
  "products_mentioned": ["list or empty"]
}

REQUIRES LOGIC:

Sales - when it needs commercial judgment:
- Negotiating pricing, discounts, or terms
- Unhappy strategic account (relationship at risk)
- New account qualification decisions
- Custom requests requiring business judgment
- Answer depends on customer value or relationship

Support - when it's process execution:
- Defect claims with standard policy (photo, credit/replace)
- Order status, tracking, delivery
- Restock dates, availability
- Invoice copies, payment status
- Product specs, care instructions
- RMA processing

Either - when:
- Standard issue but account context might matter
- Could be handled by trained support with escalation path

KNOWN CATEGORY GUIDANCE (use "None of These" if genuinely different):
- Product Issue: Defects, damage, quality, returns, warranty
- Order/Restock: Placing orders, POs, status, availability, backorders
- Payment/Credit: Invoices, credits, payment terms, AR
- Pricing/Terms: Price sheets, discounts, minimums, wholesale terms
- New Business: Account setup, applications, onboarding
- Relationship: Check-ins, feedback, escalations, strategic discussions`;

interface ConversationToClassify {
  id: number;
  reamaze_slug: string;
  subject: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_company: string | null;
  first_message_clean: string | null;
  tags: string[] | null;
}

interface NoiseResult {
  is_noise: true;
  noise_type: string;
}

interface ClassificationResult {
  is_noise: false;
  what_they_want: string;
  primary_topic: string;
  known_category: string;
  requires: string;
  requires_reasoning: string;
  complexity: string;
  customer_company: string | null;
  products_mentioned: string[];
}

type ClassifyResult = NoiseResult | ClassificationResult;

/**
 * Classify a single conversation using Claude
 */
async function classifyConversation(conv: ConversationToClassify): Promise<ClassifyResult | null> {
  const content = `CONVERSATION:
Subject: ${conv.subject || "(no subject)"}
Customer: ${conv.customer_name || "Unknown"} <${conv.customer_email || "unknown"}>
Company: ${conv.customer_company || "Unknown"}
Tags: ${(conv.tags || []).join(", ") || "none"}

Thread:
${conv.first_message_clean?.substring(0, 4000) || "(empty)"}`;

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: `${CLASSIFICATION_PROMPT}\n\n---\n\n${content}`,
        },
      ],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";

    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error(`  No JSON found in response for ${conv.reamaze_slug}`);
      return null;
    }

    const result = JSON.parse(jsonMatch[0]) as ClassifyResult;
    return result;
  } catch (error) {
    console.error(`  Error classifying ${conv.reamaze_slug}:`, error);
    return null;
  }
}

/**
 * Process a single conversation and save to DB
 */
async function processOne(conv: ConversationToClassify): Promise<boolean> {
  const result = await classifyConversation(conv);

  if (!result) return false;

  // Build update object based on noise vs real
  const updateData: Record<string, unknown> = {
    is_noise: result.is_noise,
    classified_at: new Date().toISOString(),
    classification_model: MODEL,
  };

  if (result.is_noise) {
    updateData.noise_type = result.noise_type;
    updateData.is_spam = true;
  } else {
    updateData.what_they_want = result.what_they_want;
    updateData.primary_topic = result.primary_topic;
    updateData.known_category = result.known_category;
    updateData.requires = result.requires;
    updateData.requires_reasoning = result.requires_reasoning;
    updateData.complexity = result.complexity;
    updateData.products_mentioned = result.products_mentioned;
    updateData.is_spam = false;
    updateData.category = result.known_category;
    updateData.summary = result.what_they_want;
    updateData.requires_action = result.requires !== "Support" || result.complexity === "Complex";

    if (result.customer_company && !conv.customer_company) {
      updateData.customer_company = result.customer_company;
    }
  }

  const { error } = await supabase
    .from("wholesale_conversations")
    .update(updateData)
    .eq("id", conv.id);

  if (error) {
    console.error(`  Error updating ${conv.reamaze_slug}:`, error.message);
    return false;
  }
  return true;
}

/**
 * Process a batch of conversations in parallel
 */
async function processBatch(conversations: ConversationToClassify[]): Promise<number> {
  // Process in parallel chunks
  let classified = 0;

  for (let i = 0; i < conversations.length; i += PARALLEL_REQUESTS) {
    const chunk = conversations.slice(i, i + PARALLEL_REQUESTS);
    const results = await Promise.all(chunk.map(conv => processOne(conv)));
    classified += results.filter(Boolean).length;
  }

  return classified;
}

/**
 * Main classification function
 */
async function classifyAllConversations() {
  console.log("=== Wholesale Conversations Classification (V2) ===\n");
  console.log(`Model: ${MODEL}`);
  console.log(`Batch size: ${BATCH_SIZE}\n`);

  // Parse CLI args
  const args = process.argv.slice(2);
  const limitArg = args.find(a => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1]) : null;
  const reclassify = args.includes("--reclassify");

  // Count unclassified
  let query = supabase
    .from("wholesale_conversations")
    .select("id", { count: "exact", head: true });

  if (!reclassify) {
    query = query.is("classified_at", null);
  }

  const { count: totalUnclassified } = await query;

  const toProcess = limit ? Math.min(limit, totalUnclassified || 0) : (totalUnclassified || 0);

  console.log(`Total in database: ${totalUnclassified} ${reclassify ? "" : "unclassified"}`);
  console.log(`Will process: ${toProcess}\n`);

  if (toProcess === 0) {
    console.log("Nothing to classify!");
    return;
  }

  let processed = 0;
  let classified = 0;
  const startTime = Date.now();

  // First, auto-mark call records as noise (no API call needed)
  console.log("Auto-marking call records as noise...");
  const { count: callsMarked } = await supabase
    .from("wholesale_conversations")
    .update({
      is_noise: true,
      noise_type: "Phone call (no text content)",
      classified_at: new Date().toISOString(),
      classification_model: "auto-skip",
    })
    .is("classified_at", null)
    .or("reamaze_slug.ilike.incoming-call%,reamaze_slug.ilike.outgoing-call%");
  console.log(`Marked ${callsMarked || 0} call records as noise.\n`);

  while (processed < toProcess) {
    // Fetch batch of unclassified conversations (excluding calls)
    let fetchQuery = supabase
      .from("wholesale_conversations")
      .select("id, reamaze_slug, subject, customer_name, customer_email, customer_company, first_message_clean, tags")
      .not("reamaze_slug", "ilike", "incoming-call%")
      .not("reamaze_slug", "ilike", "outgoing-call%")
      .order("created_at", { ascending: false })
      .limit(BATCH_SIZE);

    if (!reclassify) {
      fetchQuery = fetchQuery.is("classified_at", null);
    } else {
      fetchQuery = fetchQuery.range(processed, processed + BATCH_SIZE - 1);
    }

    const { data: batch, error } = await fetchQuery;

    if (error) {
      console.error("Error fetching batch:", error.message);
      break;
    }

    if (!batch || batch.length === 0) {
      break;
    }

    // Process batch
    const batchClassified = await processBatch(batch);
    classified += batchClassified;
    processed += batch.length;

    // Progress
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = classified / elapsed;
    const eta = (toProcess - processed) / rate / 60;

    console.log(
      `Processed: ${processed}/${toProcess} | Classified: ${classified} | ` +
      `Rate: ${rate.toFixed(1)}/s | ETA: ${eta.toFixed(1)} min`
    );

    // Rate limiting
    await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));
  }

  const totalTime = (Date.now() - startTime) / 1000 / 60;

  console.log("\n=== Classification Complete ===");
  console.log(`Processed: ${processed}`);
  console.log(`Classified: ${classified}`);
  console.log(`Time: ${totalTime.toFixed(1)} minutes`);

  // Show distribution
  console.log("\n=== Results Distribution ===");

  // Noise vs Real
  const { data: noiseStats } = await supabase
    .from("wholesale_conversations")
    .select("is_noise")
    .not("classified_at", "is", null);

  if (noiseStats) {
    const noise = noiseStats.filter(r => r.is_noise).length;
    const real = noiseStats.filter(r => !r.is_noise).length;
    console.log(`\nNoise: ${noise} (${((noise / noiseStats.length) * 100).toFixed(1)}%)`);
    console.log(`Real Inquiries: ${real} (${((real / noiseStats.length) * 100).toFixed(1)}%)`);
  }

  // Requires distribution (Sales vs Support)
  const { data: requiresStats } = await supabase
    .from("wholesale_conversations")
    .select("requires")
    .not("requires", "is", null);

  if (requiresStats) {
    const counts: Record<string, number> = {};
    for (const row of requiresStats) {
      counts[row.requires] = (counts[row.requires] || 0) + 1;
    }

    console.log("\n--- Who Should Handle ---");
    for (const [req, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      const pct = ((count / requiresStats.length) * 100).toFixed(1);
      console.log(`  ${req}: ${count} (${pct}%)`);
    }
  }

  // Known category distribution
  const { data: categoryStats } = await supabase
    .from("wholesale_conversations")
    .select("known_category")
    .not("known_category", "is", null);

  if (categoryStats) {
    const counts: Record<string, number> = {};
    for (const row of categoryStats) {
      counts[row.known_category] = (counts[row.known_category] || 0) + 1;
    }

    console.log("\n--- Topic Categories ---");
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    for (const [cat, count] of sorted) {
      const pct = ((count / categoryStats.length) * 100).toFixed(1);
      console.log(`  ${cat}: ${count} (${pct}%)`);
    }
  }

  // Complexity distribution
  const { data: complexityStats } = await supabase
    .from("wholesale_conversations")
    .select("complexity")
    .not("complexity", "is", null);

  if (complexityStats) {
    const counts: Record<string, number> = {};
    for (const row of complexityStats) {
      counts[row.complexity] = (counts[row.complexity] || 0) + 1;
    }

    console.log("\n--- Complexity ---");
    for (const [comp, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      const pct = ((count / complexityStats.length) * 100).toFixed(1);
      console.log(`  ${comp}: ${count} (${pct}%)`);
    }
  }
}

// Run
classifyAllConversations().catch(console.error);
