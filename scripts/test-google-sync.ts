/**
 * Test script for Google Ads sync
 * Run: source .env.local && npx tsx scripts/test-google-sync.ts
 */

import { createGoogleAdsClient } from "../lib/google-ads";

async function testSync() {
  console.log("Testing Google Ads connection and data pull...");

  const client = createGoogleAdsClient();

  // Test connection
  const connection = await client.testConnection();
  console.log("Connection:", connection);

  if (!connection.success) {
    console.error("Connection failed:", connection.error);
    return;
  }

  // Get 7 days of data as a quick test
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7);

  const startStr = startDate.toISOString().split("T")[0];
  const endStr = endDate.toISOString().split("T")[0];

  console.log("\nFetching campaign insights for", startStr, "to", endStr);

  const insights = await client.getCampaignInsights(startStr, endStr);
  console.log("\nGot", insights.length, "campaign insight records");

  if (insights.length > 0) {
    // Group by date to show daily totals
    const byDate = new Map<string, { spend: number; impressions: number; clicks: number }>();
    for (const i of insights) {
      const existing = byDate.get(i.date) || { spend: 0, impressions: 0, clicks: 0 };
      existing.spend += i.spend;
      existing.impressions += i.impressions;
      existing.clicks += i.clicks;
      byDate.set(i.date, existing);
    }

    console.log("\nDaily totals:");
    for (const [date, totals] of [...byDate.entries()].sort()) {
      console.log(`  ${date}: $${totals.spend.toFixed(2)} spend, ${totals.impressions} imps, ${totals.clicks} clicks`);
    }

    // Show campaign types
    const types = new Set(insights.map(i => i.campaign_type));
    console.log("\nCampaign types found:", [...types].join(", "));

    // Show total spend
    const totalSpend = insights.reduce((sum, i) => sum + i.spend, 0);
    console.log("\nTotal 7-day spend: $" + totalSpend.toFixed(2));
  }
}

testSync().catch(console.error);
