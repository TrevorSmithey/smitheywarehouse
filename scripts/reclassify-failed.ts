/**
 * Re-classify tickets that failed classification
 * Finds tickets with "Classification failed" in summary and re-runs Claude
 */
import { createClient } from "@supabase/supabase-js";
import { classifyTicket } from "../lib/ticket-classifier";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const RATE_LIMIT_DELAY = 200; // ms between API calls

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : 1000;

async function main() {
  console.log("=".repeat(60));
  console.log("Re-classify Failed Tickets");
  console.log("=".repeat(60));
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Limit: ${LIMIT}`);
  console.log("");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials");
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Missing ANTHROPIC_API_KEY");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Find tickets with failed classification
  console.log("Finding tickets with failed classification...");
  const { data: failed, error: fetchError } = await supabase
    .from("support_tickets")
    .select("id, reamaze_id, message_body, summary")
    .ilike("summary", "%Classification failed%")
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  if (fetchError) {
    console.error("Error fetching tickets:", fetchError);
    process.exit(1);
  }

  console.log(`Found ${failed?.length || 0} tickets to re-classify`);
  console.log("");

  if (!failed || failed.length === 0) {
    console.log("No failed tickets found. Done.");
    return;
  }

  if (dryRun) {
    console.log("DRY RUN - Would re-classify:");
    failed.slice(0, 10).forEach((t) => {
      console.log(`  - ${t.reamaze_id}`);
    });
    if (failed.length > 10) {
      console.log(`  ... and ${failed.length - 10} more`);
    }
    return;
  }

  // Re-classify each ticket
  console.log(`Re-classifying ${failed.length} tickets...`);
  console.log("");

  let processed = 0;
  let errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < failed.length; i++) {
    const ticket = failed[i];

    try {
      // Re-classify with Claude
      const classification = await classifyTicket(ticket.message_body || "");

      // Update in database
      const { error: updateError } = await supabase
        .from("support_tickets")
        .update({
          category: classification.category,
          sentiment: classification.sentiment,
          summary: classification.summary,
          urgency: classification.urgency,
        })
        .eq("id", ticket.id);

      if (updateError) {
        console.error(`Error updating ${ticket.reamaze_id}:`, updateError.message);
        errors++;
      } else {
        processed++;
      }

      // Progress log
      if ((i + 1) % 10 === 0 || i === failed.length - 1) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = (processed / parseFloat(elapsed)).toFixed(1);
        console.log(
          `Progress: ${i + 1}/${failed.length} | Processed: ${processed} | Errors: ${errors} | Rate: ${rate}/s`
        );
      }

      // Rate limiting
      if (i < failed.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY));
      }
    } catch (err) {
      console.error(`Error processing ${ticket.reamaze_id}:`, err instanceof Error ? err.message : err);
      errors++;
    }
  }

  // Summary
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("");
  console.log("=".repeat(60));
  console.log("Re-classification Complete");
  console.log("=".repeat(60));
  console.log(`Total processed: ${processed}`);
  console.log(`Total errors: ${errors}`);
  console.log(`Total time: ${totalTime}s`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
