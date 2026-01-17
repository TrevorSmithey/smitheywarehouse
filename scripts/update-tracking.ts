/**
 * Bulk Update Tracking Script - Process all pending shipments via EasyPost
 *
 * Run with: npx tsx scripts/update-tracking.ts
 *
 * This script calls the /api/tracking/check endpoint repeatedly until
 * all shipments have been processed. Use this for initial backfill.
 *
 * For ongoing updates, the Vercel cron job handles this automatically.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

// Use the deployed URL or local dev server
const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

interface TrackingResponse {
  message: string;
  updated: number;
  errors?: string[];
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("=".repeat(50));
  console.log("Smithey Warehouse - Bulk Tracking Update");
  console.log("=".repeat(50));
  console.log(`\nUsing endpoint: ${BASE_URL}/api/tracking/check`);

  let totalUpdated = 0;
  const totalErrors: string[] = [];
  let batchCount = 0;
  let noMoreShipments = false;

  while (!noMoreShipments) {
    batchCount++;
    console.log(`\nBatch ${batchCount}...`);

    try {
      const response = await fetch(`${BASE_URL}/api/tracking/check`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(`API error: ${response.status} - ${text}`);
        break;
      }

      const data: TrackingResponse = await response.json();
      console.log(`  ${data.message}`);

      if (data.updated === 0) {
        noMoreShipments = true;
        console.log("\nNo more shipments to process.");
      } else {
        totalUpdated += data.updated;
        console.log(`  Running total: ${totalUpdated} updated`);
      }

      if (data.errors && data.errors.length > 0) {
        totalErrors.push(...data.errors);
        console.log(`  Errors in batch: ${data.errors.length}`);
      }

      // Rate limit: wait 5 seconds between batches to be nice to EasyPost
      if (!noMoreShipments) {
        await sleep(5000);
      }
    } catch (err) {
      console.error(`\nFetch error:`, err);
      break;
    }
  }

  console.log("\n" + "=".repeat(50));
  console.log("Update Complete!");
  console.log("=".repeat(50));
  console.log(`Batches processed: ${batchCount}`);
  console.log(`Total updated: ${totalUpdated}`);
  console.log(`Total errors: ${totalErrors.length}`);

  if (totalErrors.length > 0 && totalErrors.length <= 20) {
    console.log("\nErrors:");
    totalErrors.forEach((e) => console.log(`  - ${e}`));
  } else if (totalErrors.length > 20) {
    console.log(`\nFirst 20 errors:`);
    totalErrors.slice(0, 20).forEach((e) => console.log(`  - ${e}`));
  }
}

main().catch(console.error);
