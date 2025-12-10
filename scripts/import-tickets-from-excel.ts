/**
 * Import Support Tickets from Excel
 *
 * Imports pre-classified tickets from the Customer Service Analysis.xlsx file
 * Uses the "Cleaned" sheet which has already been classified by Make.com + GPT
 *
 * Usage: npx tsx scripts/import-tickets-from-excel.ts [--dry-run]
 */

import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const EXCEL_PATH =
  "/Users/trevorfunderburk/Library/CloudStorage/OneDrive-SharedLibraries-SmitheyIronwareCompany,LLC/Smithey Ironware Team Site - Documents/Reporting/Looker Dashboards/Customer Service Analysis.xlsx";

const BATCH_SIZE = 100;

// Parse args
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

// Excel serial date to JS Date
function excelDateToISO(serial: number): string {
  // Excel epoch is Dec 30, 1899
  const excelEpoch = new Date(1899, 11, 30);
  const date = new Date(excelEpoch.getTime() + serial * 86400000);
  return date.toISOString();
}

// Extract reamaze_id from permalink
function extractReamazeId(permalink: string | number): string | null {
  if (!permalink || permalink === 0) return null;
  const url = String(permalink);
  // Format: https://smithey.reamaze.com/conversations/SLUG/perma?token=...
  const match = url.match(/\/conversations\/([^/]+)\/perma/);
  return match ? match[1] : null;
}

// Clean category (remove trailing whitespace/newlines)
function cleanCategory(category: string): string {
  return (category || "Other").trim().replace(/\s+/g, " ");
}

// Clean sentiment
function cleanSentiment(sentiment: string): string {
  const s = (sentiment || "Neutral").trim().toLowerCase();
  if (s === "positive") return "Positive";
  if (s === "negative") return "Negative";
  if (s === "mixed") return "Mixed";
  return "Neutral";
}

// Clean summary (remove trailing sentiment word that sometimes gets appended)
function cleanSummary(summary: string): string {
  if (!summary) return "";
  let s = summary.trim();
  // Remove trailing "Neutral", "Positive", "Negative" if present
  s = s.replace(/\s+(Neutral|Positive|Negative|Mixed)\.?\s*$/i, "");
  return s.substring(0, 500); // Limit length
}

async function main() {
  console.log("=".repeat(60));
  console.log("Import Tickets from Excel");
  console.log("=".repeat(60));
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Source: ${EXCEL_PATH}`);
  console.log("");

  // Validate environment
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Read Excel file
  console.log("Reading Excel file...");
  const workbook = XLSX.readFile(EXCEL_PATH);

  // Use "Cleaned" sheet
  const sheet = workbook.Sheets["Cleaned"];
  if (!sheet) {
    console.error('Sheet "Cleaned" not found');
    process.exit(1);
  }

  const data = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[];
  console.log(`Found ${data.length} rows in "Cleaned" sheet`);
  console.log("");

  // Transform data
  console.log("Transforming data...");
  const tickets: {
    reamaze_id: string;
    created_at: string;
    subject: string;
    channel: string;
    message_body: string;
    category: string;
    summary: string;
    sentiment: string;
    perma_url: string | null;
    urgency: string | null;
  }[] = [];

  let skipped = 0;
  const seenIds = new Set<string>();

  for (const row of data) {
    // Extract reamaze_id from hyperlink
    const reamazeId = extractReamazeId(row["Hyperlink"] as string | number);

    // Generate a fallback ID if no hyperlink
    const id =
      reamazeId ||
      `excel-${(row["Date"] as number)}-${(row["Subject"] as string || "").substring(0, 20).replace(/[^a-z0-9]/gi, "-")}`;

    // Skip duplicates
    if (seenIds.has(id)) {
      skipped++;
      continue;
    }
    seenIds.add(id);

    // Convert Excel date
    const dateSerial = row["Date"];
    let createdAt: string;
    try {
      if (typeof dateSerial === "number" && dateSerial > 0) {
        createdAt = excelDateToISO(dateSerial);
      } else if (typeof dateSerial === "string" && dateSerial) {
        const parsed = new Date(dateSerial);
        if (!isNaN(parsed.getTime())) {
          createdAt = parsed.toISOString();
        } else {
          createdAt = new Date().toISOString();
        }
      } else {
        createdAt = new Date().toISOString();
      }
    } catch {
      createdAt = new Date().toISOString();
    }

    tickets.push({
      reamaze_id: id,
      created_at: createdAt,
      subject: String(row["Subject"] || "").substring(0, 500),
      channel: String(row["Channel"] || "Unknown"),
      message_body: String(row["Body_Clean"] || "").substring(0, 10000),
      category: cleanCategory(String(row["Category"] || "")),
      summary: cleanSummary(String(row["Summary "] || row["Summary"] || "")),
      sentiment: cleanSentiment(String(row["Sentiment"] || "")),
      perma_url: row["Hyperlink"] && row["Hyperlink"] !== 0 ? String(row["Hyperlink"]) : null,
      urgency: null,
    });
  }

  console.log(`Transformed ${tickets.length} tickets (${skipped} duplicates skipped)`);
  console.log("");

  // Show sample
  console.log("Sample ticket:");
  console.log(JSON.stringify(tickets[0], null, 2));
  console.log("");

  // Show category distribution
  const categoryDist = new Map<string, number>();
  for (const t of tickets) {
    categoryDist.set(t.category, (categoryDist.get(t.category) || 0) + 1);
  }
  console.log("Category Distribution:");
  const sortedCategories = [...categoryDist.entries()].sort((a, b) => b[1] - a[1]);
  for (const [cat, count] of sortedCategories.slice(0, 10)) {
    console.log(`  ${cat}: ${count}`);
  }
  if (sortedCategories.length > 10) {
    console.log(`  ... and ${sortedCategories.length - 10} more categories`);
  }
  console.log("");

  // Show sentiment distribution
  const sentimentDist = new Map<string, number>();
  for (const t of tickets) {
    sentimentDist.set(t.sentiment, (sentimentDist.get(t.sentiment) || 0) + 1);
  }
  console.log("Sentiment Distribution:");
  for (const [sent, count] of sentimentDist.entries()) {
    const pct = ((count / tickets.length) * 100).toFixed(1);
    console.log(`  ${sent}: ${count} (${pct}%)`);
  }
  console.log("");

  // Show date range
  const dates = tickets.map((t) => new Date(t.created_at).getTime());
  const minDate = new Date(Math.min(...dates));
  const maxDate = new Date(Math.max(...dates));
  console.log(`Date Range: ${minDate.toISOString().split("T")[0]} to ${maxDate.toISOString().split("T")[0]}`);
  console.log("");

  if (dryRun) {
    console.log("DRY RUN - No data written to database");
    return;
  }

  // Use upsert to handle potential duplicates
  const newTickets = tickets;
  console.log(`Importing ${newTickets.length} tickets...`);
  console.log("");

  // Insert in batches
  console.log(`Inserting ${newTickets.length} tickets in batches of ${BATCH_SIZE}...`);
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < newTickets.length; i += BATCH_SIZE) {
    const batch = newTickets.slice(i, i + BATCH_SIZE);

    const { error: insertError } = await supabase.from("support_tickets").insert(batch);

    if (insertError) {
      console.error(`Batch ${Math.floor(i / BATCH_SIZE) + 1} error:`, insertError.message);
      errors += batch.length;
    } else {
      inserted += batch.length;
    }

    // Progress
    const progress = Math.min(i + BATCH_SIZE, newTickets.length);
    console.log(`Progress: ${progress}/${newTickets.length} (${inserted} inserted, ${errors} errors)`);
  }

  console.log("");
  console.log("=".repeat(60));
  console.log("Import Complete");
  console.log("=".repeat(60));
  console.log(`Total inserted: ${inserted}`);
  console.log(`Total errors: ${errors}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
