import { config } from 'dotenv';
config({ path: '.env.local' });

const SHOPIFY_B2B_STORE = process.env.SHOPIFY_B2B_STORE_URL;
const SHOPIFY_B2B_TOKEN = process.env.SHOPIFY_B2B_ADMIN_TOKEN;

async function checkOrder(orderName: string) {
  // Search for order by name
  const url = `https://${SHOPIFY_B2B_STORE}/admin/api/2024-01/orders.json?name=${orderName}&status=any`;

  const response = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_B2B_TOKEN!,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    console.error(`Error fetching ${orderName}: ${response.status}`);
    return;
  }

  const data = await response.json();
  const orders = data.orders || [];

  if (orders.length === 0) {
    console.log(`${orderName}: NOT FOUND in Shopify`);
    return;
  }

  const order = orders[0];
  console.log(`\n${orderName}:`);
  console.log(`  Created: ${order.created_at}`);
  console.log(`  Fulfillment Status: ${order.fulfillment_status || 'unfulfilled'}`);
  console.log(`  Financial Status: ${order.financial_status}`);
  console.log(`  Cancelled: ${order.cancelled_at ? 'YES' : 'No'}`);

  if (order.fulfillments && order.fulfillments.length > 0) {
    console.log(`  Fulfillments:`);
    for (const f of order.fulfillments) {
      console.log(`    - ${f.created_at}: ${f.line_items.length} items`);
      for (const li of f.line_items) {
        console.log(`      ${li.sku}: ${li.quantity}`);
      }
    }
  } else {
    console.log(`  Fulfillments: NONE`);
  }

  // Show line items for unfulfilled
  if (!order.fulfillment_status || order.fulfillment_status === 'null') {
    console.log(`  Line Items (unfulfilled):`);
    for (const li of order.line_items || []) {
      console.log(`    ${li.sku}: ${li.quantity}`);
    }
  }
}

async function main() {
  // Check orders that are in CSV but not in Supabase
  const ordersToCheck = [
    'PO-11340',  // Big order with Wokm, Skil12, Rroastm
    'PO-11346',  // 21x Skil12, 6x Skil14
    'PO-11375',  // 70x Skil8, 61x Skil12
    'PO-11429',  // 100x Dual6
    'PO-11437',  // 120x Skil10
  ];

  console.log('Checking orders from CSV that are missing from Supabase...\n');

  for (const orderName of ordersToCheck) {
    await checkOrder(orderName);
    await new Promise(r => setTimeout(r, 500)); // Rate limit
  }
}

main();
