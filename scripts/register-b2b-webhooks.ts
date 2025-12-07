/**
 * Register B2B Shopify webhooks for real-time order sync
 * Run once after deploying the webhook endpoint
 */

import { config } from "dotenv";
config({ path: ".env.local" });

const SHOPIFY_B2B_STORE = process.env.SHOPIFY_B2B_STORE_URL;
const SHOPIFY_B2B_TOKEN = process.env.SHOPIFY_B2B_ADMIN_TOKEN;

// Update this to your production URL
const WEBHOOK_URL = "https://smitheywarehouse.vercel.app/api/webhooks/shopify-b2b";

const WEBHOOK_TOPICS = [
  "orders/create",
  "orders/updated",
  "orders/cancelled",
];

async function listWebhooks() {
  const url = `https://${SHOPIFY_B2B_STORE}/admin/api/2024-01/webhooks.json`;
  const res = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": SHOPIFY_B2B_TOKEN!,
      "Content-Type": "application/json",
    },
  });
  const data = await res.json();
  return data.webhooks || [];
}

async function createWebhook(topic: string) {
  const url = `https://${SHOPIFY_B2B_STORE}/admin/api/2024-01/webhooks.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": SHOPIFY_B2B_TOKEN!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      webhook: {
        topic,
        address: WEBHOOK_URL,
        format: "json",
      },
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Failed to create webhook ${topic}: ${error}`);
  }

  return res.json();
}

async function deleteWebhook(id: number) {
  const url = `https://${SHOPIFY_B2B_STORE}/admin/api/2024-01/webhooks/${id}.json`;
  await fetch(url, {
    method: "DELETE",
    headers: {
      "X-Shopify-Access-Token": SHOPIFY_B2B_TOKEN!,
    },
  });
}

async function main() {
  console.log("B2B Webhook Registration");
  console.log("========================\n");
  console.log(`Store: ${SHOPIFY_B2B_STORE}`);
  console.log(`Webhook URL: ${WEBHOOK_URL}\n`);

  // List existing webhooks
  console.log("Checking existing webhooks...");
  const existing = await listWebhooks();

  if (existing.length > 0) {
    console.log(`Found ${existing.length} existing webhooks:`);
    for (const wh of existing) {
      console.log(`  - ${wh.topic} -> ${wh.address}`);
    }
    console.log("");
  }

  // Check which topics already exist for our URL
  const existingTopics = new Set(
    existing
      .filter((wh: { address: string }) => wh.address === WEBHOOK_URL)
      .map((wh: { topic: string }) => wh.topic)
  );

  // Register missing webhooks
  for (const topic of WEBHOOK_TOPICS) {
    if (existingTopics.has(topic)) {
      console.log(`[SKIP] ${topic} already registered`);
    } else {
      try {
        await createWebhook(topic);
        console.log(`[OK] ${topic} registered`);
      } catch (error) {
        console.error(`[FAIL] ${topic}:`, error);
      }
    }
    await new Promise((r) => setTimeout(r, 500)); // Rate limit
  }

  console.log("\nDone! B2B orders will now sync in real-time.");
}

main().catch(console.error);
