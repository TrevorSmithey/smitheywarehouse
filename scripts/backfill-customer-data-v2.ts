/**
 * Backfill Customer Data Script v2
 *
 * Fetches conversations from Re:amaze LIST endpoint (which includes author data)
 * and updates existing support_tickets with customer_email, order_count, and total_spent.
 *
 * The individual conversation endpoint doesn't return author data, so we use
 * the list endpoint with date filters to get what we need.
 *
 * Usage: npx tsx scripts/backfill-customer-data-v2.ts [--days=90]
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

// Parse command line arguments
const args = process.argv.slice(2);
const daysArg = args.find((a) => a.startsWith("--days="));
const DAYS_TO_FETCH = daysArg ? parseInt(daysArg.split("=")[1], 10) : 90;

interface ReamazeAuthor {
  id: number;
  name: string;
  email: string;
  data?: {
    "(smithey-iron-ware.myshopify.com) Order count"?: string;
    "(smithey-iron-ware.myshopify.com) Total spent"?: string;
    [key: string]: string | null | undefined;
  };
}

interface ReamazeConversation {
  slug: string;
  author?: ReamazeAuthor;
}

interface ReamazeResponse {
  conversations: ReamazeConversation[];
  page_count: number;
  page_size: number;
  total_count: number;
}

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

  const orderCountStr = data["(smithey-iron-ware.myshopify.com) Order count"] || "0";
  const orderCount = parseInt(orderCountStr, 10) || 0;

  const totalSpentStr = data["(smithey-iron-ware.myshopify.com) Total spent"] || "0";
  const totalSpent = parseFloat(totalSpentStr.replace(/[^0-9.]/g, "")) || 0;

  return { customer_email: email, order_count: orderCount, total_spent: totalSpent };
}

async function main() {
  console.log("=".repeat(60));
  console.log("Backfill Customer Data v2 (List Endpoint)");
  console.log("=".repeat(60));
  console.log(`Days to fetch: ${DAYS_TO_FETCH}`);
  console.log("");

  // Validate environment
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const reamazeBrand = process.env.REAMAZE_BRAND;
  const reamazeEmail = process.env.REAMAZE_EMAIL;
  const reamazeApiToken = process.env.REAMAZE_API_TOKEN;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials");
    process.exit(1);
  }
  if (!reamazeBrand || !reamazeEmail || !reamazeApiToken) {
    console.error("Missing Re:amaze credentials");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const authHeader = `Basic ${Buffer.from(`${reamazeEmail}:${reamazeApiToken}`).toString("base64")}`;
  const baseUrl = `https://${reamazeBrand}.reamaze.com/api/v1`;

  // Calculate date range
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - DAYS_TO_FETCH * 24 * 60 * 60 * 1000);

  console.log(`Date range: ${startDate.toISOString().split("T")[0]} to ${endDate.toISOString().split("T")[0]}`);
  console.log("");

  // Step 1: Fetch all conversations from Re:amaze list endpoint
  console.log("Step 1: Fetching conversations from Re:amaze...");

  const allConversations: ReamazeConversation[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      filter: "all",
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
      page: page.toString(),
      sort: "changed",
    });

    const res = await fetch(`${baseUrl}/conversations?${params}`, {
      headers: {
        Accept: "application/json",
        Authorization: authHeader,
      },
    });

    if (!res.ok) {
      console.error(`Re:amaze API error: ${res.status}`);
      break;
    }

    const data: ReamazeResponse = await res.json();
    allConversations.push(...data.conversations);

    console.log(`  Page ${page}/${data.page_count}: ${data.conversations.length} conversations`);

    hasMore = page < data.page_count;
    page++;

    // Rate limit
    if (hasMore) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log(`Total conversations fetched: ${allConversations.length}`);
  console.log("");

  // Build a map of slug -> customer data
  const customerDataMap = new Map<string, { customer_email: string | null; order_count: number; total_spent: number }>();
  for (const conv of allConversations) {
    customerDataMap.set(conv.slug, extractCustomerData(conv));
  }

  // Step 2: Get tickets that need updating
  console.log("Step 2: Finding tickets without customer data...");

  const { data: tickets, error: fetchError } = await supabase
    .from("support_tickets")
    .select("id, reamaze_id")
    .is("customer_email", null)
    .gte("created_at", startDate.toISOString())
    .lte("created_at", endDate.toISOString());

  if (fetchError) {
    console.error("Error fetching tickets:", fetchError);
    process.exit(1);
  }

  console.log(`Found ${tickets?.length || 0} tickets to update`);
  console.log("");

  if (!tickets || tickets.length === 0) {
    console.log("No tickets need updating. Exiting.");
    return;
  }

  // Step 3: Update tickets with customer data
  console.log("Step 3: Updating tickets...");

  let updated = 0;
  let noMatch = 0;
  let errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    const customerData = customerDataMap.get(ticket.reamaze_id);

    if (!customerData) {
      noMatch++;
      continue;
    }

    const { error: updateError } = await supabase
      .from("support_tickets")
      .update({
        customer_email: customerData.customer_email,
        order_count: customerData.order_count,
        total_spent: customerData.total_spent,
      })
      .eq("id", ticket.id);

    if (updateError) {
      errors++;
    } else {
      updated++;
    }

    // Progress log every 100
    if ((i + 1) % 100 === 0 || i === tickets.length - 1) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  Progress: ${i + 1}/${tickets.length} | Updated: ${updated} | No match: ${noMatch} | Errors: ${errors} | ${elapsed}s`);
    }
  }

  // Summary
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("");
  console.log("=".repeat(60));
  console.log("Backfill Complete");
  console.log("=".repeat(60));
  console.log(`Total updated: ${updated}`);
  console.log(`No match in Re:amaze: ${noMatch}`);
  console.log(`Errors: ${errors}`);
  console.log(`Total time: ${totalTime}s`);
  console.log("");

  // Quick analysis
  const { data: analysis } = await supabase
    .from("support_tickets")
    .select("order_count")
    .not("customer_email", "is", null)
    .gte("created_at", startDate.toISOString())
    .lte("created_at", endDate.toISOString());

  if (analysis && analysis.length > 0) {
    const prePurchase = analysis.filter((t) => t.order_count === 0).length;
    const postPurchase = analysis.filter((t) => t.order_count > 0).length;
    const total = analysis.length;

    console.log("Quick Analysis:");
    console.log(`  Pre-purchase (order_count=0): ${prePurchase} (${Math.round((prePurchase / total) * 1000) / 10}%)`);
    console.log(`  Post-purchase (order_count>0): ${postPurchase} (${Math.round((postPurchase / total) * 1000) / 10}%)`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
