/**
 * Trigger Shopify Stats Sync
 *
 * This calls the sync-shopify-stats API endpoint to refresh Dec 28 data.
 *
 * Run with: npx tsx scripts/trigger-sync.ts
 */

import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function triggerSync() {
  console.log("\n" + "=".repeat(70));
  console.log("TRIGGERING SHOPIFY STATS SYNC");
  console.log("=".repeat(70) + "\n");

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.log("❌ CRON_SECRET not found in environment");
    return;
  }

  const url = `${baseUrl}/api/cron/sync-shopify-stats`;
  console.log(`📊 Calling: ${url}`);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${cronSecret}`,
      },
    });

    const data = await response.json();

    if (response.ok) {
      console.log("\n✅ Sync completed successfully:");
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log("\n❌ Sync failed:");
      console.log(JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.log("\n❌ Request failed:", error);
  }

  console.log("\n" + "=".repeat(70));
}

triggerSync().catch(console.error);
