/**
 * Subscribe to missing Shopify webhooks
 *
 * This script subscribes to:
 * - orders/updated: Fires when order is modified (tags added, fulfillment created, etc.)
 * - fulfillments/create: Fires when a fulfillment is created (redundant but provides coverage)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

const SHOPIFY_STORE = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const WEBHOOK_URL = 'https://smitheywarehouse.vercel.app/api/webhooks/shopify';
const API_VERSION = '2024-10';

interface WebhookResponse {
  webhook?: {
    id: number;
    topic: string;
    address: string;
  };
  errors?: string | Record<string, string[]>;
}

async function subscribeWebhook(topic: string): Promise<boolean> {
  const url = `https://${SHOPIFY_STORE}/admin/api/${API_VERSION}/webhooks.json`;

  console.log(`\nSubscribing to ${topic}...`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN || '',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      webhook: {
        topic,
        address: WEBHOOK_URL,
        format: 'json',
      },
    }),
  });

  const data: WebhookResponse = await response.json();

  if (!response.ok) {
    console.error(`  ERROR: ${response.status} ${response.statusText}`);
    console.error('  Response:', JSON.stringify(data, null, 2));

    // Check if already exists
    if (JSON.stringify(data).includes('already been taken')) {
      console.log(`  → Webhook already exists for ${topic}`);
      return true;
    }
    return false;
  }

  if (data.webhook) {
    console.log(`  ✓ Success! Webhook ID: ${data.webhook.id}`);
    console.log(`    Topic: ${data.webhook.topic}`);
    console.log(`    Address: ${data.webhook.address}`);
    return true;
  }

  console.error('  Unexpected response:', JSON.stringify(data, null, 2));
  return false;
}

async function listWebhooks(): Promise<void> {
  const url = `https://${SHOPIFY_STORE}/admin/api/${API_VERSION}/webhooks.json`;

  const response = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN || '',
      'Content-Type': 'application/json',
    },
  });

  const data = await response.json();
  const webhooks = data.webhooks || [];

  console.log('\n=== CURRENT WEBHOOKS ===');
  for (const w of webhooks) {
    console.log(`  ${w.topic} → ${w.address}`);
  }
  console.log(`\nTotal: ${webhooks.length} webhooks`);
}

async function main() {
  console.log('=== SHOPIFY WEBHOOK SUBSCRIPTION ===');
  console.log(`Store: ${SHOPIFY_STORE}`);
  console.log(`Webhook URL: ${WEBHOOK_URL}`);

  // Show current state
  await listWebhooks();

  // Subscribe to new webhooks
  const results = {
    'orders/updated': await subscribeWebhook('orders/updated'),
    'fulfillments/create': await subscribeWebhook('fulfillments/create'),
  };

  // Show final state
  await listWebhooks();

  // Summary
  console.log('\n=== SUMMARY ===');
  for (const [topic, success] of Object.entries(results)) {
    console.log(`  ${topic}: ${success ? '✓ OK' : '✗ FAILED'}`);
  }

  const allSuccess = Object.values(results).every(Boolean);
  if (allSuccess) {
    console.log('\n✓ All webhooks subscribed successfully!');
    console.log('\nNext steps:');
    console.log('  1. Create a test order in Shopify to verify webhooks fire');
    console.log('  2. Run the backfill script to fix historical data');
  } else {
    console.log('\n✗ Some webhooks failed to subscribe. Check errors above.');
    process.exit(1);
  }
}

main().catch(console.error);
