/**
 * Re:amaze Historical Backfill Script
 *
 * Fetches historical conversations from Re:amaze, classifies with Claude,
 * and stores in Supabase. Run this once to populate the database.
 *
 * Usage: npx tsx scripts/backfill-reamaze.ts [--days=90] [--dry-run]
 */

import { createClient } from "@supabase/supabase-js";
import { ReamazeClient, ReamazeConversation, cleanMessageBody } from "../lib/reamaze";
import { classifyTicket } from "../lib/ticket-classifier";
import dotenv from "dotenv";

/**
 * Extract customer data from Re:amaze author object
 */
function extractCustomerData(conv: ReamazeConversation): {
  customer_email: string | null;
  order_count: number;
  total_spent: number;
} {
  const author = conv.author;
  if (!author) {
    return { customer_email: null, order_count: 0, total_spent: 0 };
  }

  const email = author.email || null;
  const data = author.data || {};

  // Parse order count - look for Shopify key
  const orderCountStr = data["(smithey-iron-ware.myshopify.com) Order count"] || "0";
  const orderCount = parseInt(orderCountStr, 10) || 0;

  // Parse total spent - look for Shopify key
  const totalSpentStr = data["(smithey-iron-ware.myshopify.com) Total spent"] || "0";
  const totalSpent = parseFloat(totalSpentStr.replace(/[^0-9.]/g, "")) || 0;

  return { customer_email: email, order_count: orderCount, total_spent: totalSpent };
}

// Load environment variables
dotenv.config({ path: ".env.local" });

// Configuration
const BATCH_SIZE = 100;
const RATE_LIMIT_DELAY = 200; // ms between API calls

// Parse command line arguments
const args = process.argv.slice(2);
const daysArg = args.find((a) => a.startsWith("--days="));
const dryRun = args.includes("--dry-run");
const DAYS_TO_FETCH = daysArg ? parseInt(daysArg.split("=")[1], 10) : 365;

async function main() {
  console.log("=".repeat(60));
  console.log("Re:amaze Historical Backfill");
  console.log("=".repeat(60));
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Days to fetch: ${DAYS_TO_FETCH}`);
  console.log("");

  // Validate environment
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const reamazeBrand = process.env.REAMAZE_BRAND;
  const reamazeEmail = process.env.REAMAZE_EMAIL;
  const reamazeApiToken = process.env.REAMAZE_API_TOKEN;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)");
    process.exit(1);
  }
  if (!reamazeBrand || !reamazeEmail || !reamazeApiToken) {
    console.error("Missing Re:amaze credentials (REAMAZE_BRAND, REAMAZE_EMAIL, REAMAZE_API_TOKEN)");
    process.exit(1);
  }
  if (!anthropicKey) {
    console.error("Missing ANTHROPIC_API_KEY");
    process.exit(1);
  }

  // Initialize clients
  const supabase = createClient(supabaseUrl, supabaseKey);
  const reamaze = new ReamazeClient({
    brand: reamazeBrand,
    email: reamazeEmail,
    apiToken: reamazeApiToken,
  });

  // Calculate date range
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - DAYS_TO_FETCH * 24 * 60 * 60 * 1000);

  console.log(`Fetching conversations from ${startDate.toISOString()} to ${endDate.toISOString()}`);
  console.log("");

  // Fetch all conversations
  console.log("Step 1: Fetching conversations from Re:amaze...");
  const conversations = await reamaze.fetchNewConversations(startDate.toISOString());
  console.log(`Found ${conversations.length} conversations`);
  console.log("");

  if (conversations.length === 0) {
    console.log("No conversations to process. Exiting.");
    return;
  }

  // Check which conversations already exist (in batches to avoid URL length limits)
  console.log("Step 2: Checking existing tickets in database...");
  const slugs = conversations.map((c) => c.slug);
  const existingSlugs = new Set<string>();

  // Check in batches of 100 to avoid 414 errors
  const CHECK_BATCH_SIZE = 100;
  for (let i = 0; i < slugs.length; i += CHECK_BATCH_SIZE) {
    const batch = slugs.slice(i, i + CHECK_BATCH_SIZE);
    const { data: existingData, error: existingError } = await supabase
      .from("support_tickets")
      .select("reamaze_id")
      .in("reamaze_id", batch);

    if (existingError) {
      console.error("Error checking existing tickets:", existingError);
      process.exit(1);
    }

    (existingData || []).forEach((t) => existingSlugs.add(t.reamaze_id));

    if ((i + CHECK_BATCH_SIZE) % 500 === 0) {
      console.log(`  Checked ${Math.min(i + CHECK_BATCH_SIZE, slugs.length)}/${slugs.length}...`);
    }
  }

  const newConversations = conversations.filter((c) => !existingSlugs.has(c.slug));
  console.log(`${existingSlugs.size} already exist, ${newConversations.length} new to process`);
  console.log("");

  if (newConversations.length === 0) {
    console.log("All conversations already exist. Nothing to do.");
    return;
  }

  if (dryRun) {
    console.log("DRY RUN - Would process the following conversations:");
    newConversations.slice(0, 10).forEach((c) => {
      console.log(`  - ${c.slug}: ${c.subject || "(no subject)"}`);
    });
    if (newConversations.length > 10) {
      console.log(`  ... and ${newConversations.length - 10} more`);
    }
    return;
  }

  // Process conversations in batches
  console.log(`Step 3: Processing ${newConversations.length} conversations...`);
  console.log("");

  let processed = 0;
  let errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < newConversations.length; i++) {
    const conv = newConversations[i];

    try {
      // Clean message body
      const cleanBody = cleanMessageBody(conv.message?.body || "");

      // Classify with Claude
      const classification = await classifyTicket(cleanBody);

      // Build permalink
      const permaUrl = ReamazeClient.getPermalink(reamazeBrand, conv.slug);

      // Extract customer data from author
      const customerData = extractCustomerData(conv);

      // Insert into database
      const { error: insertError } = await supabase.from("support_tickets").insert({
        reamaze_id: conv.slug,
        created_at: conv.created_at,
        subject: conv.subject,
        message_body: cleanBody.substring(0, 10000),
        channel: conv.category?.name || String(conv.category?.channel),
        perma_url: permaUrl,
        category: classification.category,
        sentiment: classification.sentiment,
        summary: classification.summary,
        urgency: classification.urgency,
        customer_email: customerData.customer_email,
        order_count: customerData.order_count,
        total_spent: customerData.total_spent,
      });

      if (insertError) {
        console.error(`Error inserting ${conv.slug}:`, insertError.message);
        errors++;
      } else {
        processed++;
      }

      // Progress log
      if ((i + 1) % 10 === 0 || i === newConversations.length - 1) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = (processed / parseFloat(elapsed)).toFixed(1);
        console.log(
          `Progress: ${i + 1}/${newConversations.length} | Processed: ${processed} | Errors: ${errors} | Rate: ${rate}/s`
        );
      }

      // Rate limiting
      if (i < newConversations.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY));
      }
    } catch (err) {
      console.error(`Error processing ${conv.slug}:`, err instanceof Error ? err.message : err);
      errors++;
    }
  }

  // Summary
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("");
  console.log("=".repeat(60));
  console.log("Backfill Complete");
  console.log("=".repeat(60));
  console.log(`Total processed: ${processed}`);
  console.log(`Total errors: ${errors}`);
  console.log(`Total time: ${totalTime}s`);
  console.log("");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
