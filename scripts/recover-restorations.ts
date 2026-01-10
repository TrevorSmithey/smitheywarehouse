/**
 * Recovery Script: Resync All Restorations from AfterShip
 *
 * This script triggers a FULL historical sync from AfterShip to recover
 * restoration data after accidental deletion.
 *
 * What it recovers:
 * - All restorations with AfterShip return IDs
 * - RMA numbers, tracking numbers, carrier info
 * - Status based on tracking (label_sent, in_transit, delivered, received)
 * - Timestamps: label_sent_at, customer_shipped_at, delivered_to_warehouse_at, received_at
 * - Order linkage via order_number lookup
 *
 * What is NOT recovered:
 * - Manual notes added by warehouse staff
 * - Tag numbers (magnet_number/tag_numbers)
 * - Photos uploaded to storage
 * - Manual workflow stages (sent_to_restoration_at, back_from_restoration_at, shipped_at, delivered_at)
 *
 * Run with: npx tsx scripts/recover-restorations.ts
 */

import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function recoverRestorations() {
  console.log("\n" + "=".repeat(70));
  console.log("RESTORATION DATA RECOVERY - FULL AFTERSHIP SYNC");
  console.log("=".repeat(70) + "\n");

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://smitheywarehouse.vercel.app";
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.log("❌ CRON_SECRET not found in .env.local");
    console.log("   Make sure your .env.local file contains CRON_SECRET");
    return;
  }

  const url = `${baseUrl}/api/cron/sync-aftership-returns`;

  console.log("⚠️  This will sync ALL historical returns from AfterShip.");
  console.log("   This may take several minutes depending on data volume.\n");

  console.log(`📡 Calling: ${url}`);
  console.log(`   Mode: full (all historical returns)`);
  console.log("");

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${cronSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "full", // Fetch ALL historical returns, not just recent
      }),
    });

    // Get raw text first to debug
    const rawText = await response.text();
    console.log(`📨 Response status: ${response.status}`);

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      console.log("\n⚠️  Response was not JSON:");
      console.log(rawText.substring(0, 500));
      return;
    }

    if (response.ok) {
      console.log("\n✅ Recovery sync completed:");
      console.log(JSON.stringify(data, null, 2));

      if (data.stats) {
        console.log("\n📊 Summary:");
        console.log(`   Total returns from AfterShip API: ${data.stats.totalReturnsFromApi}`);
        console.log(`   Restoration returns (SKU -rest-): ${data.stats.restorationReturns}`);
        console.log(`   Matched to orders: ${data.stats.matchedToOrders}`);
        console.log(`   Records created: ${data.stats.created}`);
        console.log(`   Records updated: ${data.stats.updated}`);
        console.log(`   Errors: ${data.stats.errors}`);
        console.log(`   Duration: ${data.duration}ms`);
      }

      console.log("\n⚠️  Note: Manual data (notes, tags, photos) could not be recovered.");
      console.log("   Check the restoration dashboard to verify data quality.");
    } else {
      console.log("\n❌ Recovery sync failed:");
      console.log(JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.log("\n❌ Request failed:", error);
  }

  console.log("\n" + "=".repeat(70));
}

recoverRestorations().catch(console.error);
