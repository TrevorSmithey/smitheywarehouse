/* eslint-disable @typescript-eslint/no-explicit-any */
import { config } from 'dotenv';
config({ path: '.env.local' });

const SHOPIFY_STORE = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

async function check() {
  const url = `https://${SHOPIFY_STORE}/admin/api/2024-01/webhooks.json`;

  const response = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN || '',
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    console.error('Error:', response.status, await response.text());
    return;
  }

  const data = await response.json();
  const webhooks = data.webhooks || [];

  console.log('=== SHOPIFY WEBHOOK SUBSCRIPTIONS ===\n');
  console.log(`Total webhooks: ${webhooks.length}\n`);

  // Filter to order-related webhooks
  const orderWebhooks = webhooks.filter((w: any) => w.topic.startsWith('orders/'));

  console.log('Order-related webhooks:');
  for (const w of orderWebhooks) {
    console.log(`  ${w.topic} → ${w.address}`);
  }

  // Check for orders/updated specifically
  const hasOrdersUpdated = orderWebhooks.some((w: any) => w.topic === 'orders/updated');
  console.log(`\norders/updated subscribed: ${hasOrdersUpdated ? 'YES' : 'NO'}`);
}

check();
