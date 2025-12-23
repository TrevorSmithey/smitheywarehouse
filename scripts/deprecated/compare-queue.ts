import { config } from 'dotenv';
config({ path: '.env.local' });
import * as fs from 'fs';

const csvPath = '/Users/trevorfunderburk/Downloads/fulfillment_queue_orders.csv';

function parseCSV(content: string): Record<string, string>[] {
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (values[j] || '').trim();
    }
    rows.push(row);
  }

  return rows;
}

async function analyze() {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const rows = parseCSV(content);

  console.log('=== QUEUE COMPARISON ANALYSIS ===\n');

  // Extract order names from my export (column A)
  const supabaseOrders = new Set<string>();
  const supabaseOrderData: Record<string, Record<string, string>> = {};

  for (const row of rows) {
    const orderName = row.order_name?.trim();
    if (orderName) {
      supabaseOrders.add(orderName);
      supabaseOrderData[orderName] = row;
    }
  }

  // Extract Shopify order numbers from column G
  const shopifyOrders = new Set<string>();
  for (const row of rows) {
    const shopifyOrder = (row['Shopoify open'] || row['Shopify open'] || '').trim();
    if (shopifyOrder && shopifyOrder.startsWith('S')) {
      shopifyOrders.add(shopifyOrder);
    }
  }

  console.log(`Supabase queue (my export): ${supabaseOrders.size} orders`);
  console.log(`Shopify open (your paste): ${shopifyOrders.size} orders`);

  // Find differences
  const inSupabaseNotShopify: string[] = [];
  const inShopifyNotSupabase: string[] = [];
  const inBoth: string[] = [];

  for (const order of supabaseOrders) {
    if (shopifyOrders.has(order)) {
      inBoth.push(order);
    } else {
      inSupabaseNotShopify.push(order);
    }
  }

  for (const order of shopifyOrders) {
    if (!supabaseOrders.has(order)) {
      inShopifyNotSupabase.push(order);
    }
  }

  console.log(`\nMatching (in both): ${inBoth.length}`);
  console.log(`In Supabase but NOT in Shopify: ${inSupabaseNotShopify.length}`);
  console.log(`In Shopify but NOT in Supabase: ${inShopifyNotSupabase.length}`);

  // Analyze orders in Supabase but not Shopify
  if (inSupabaseNotShopify.length > 0) {
    console.log('\n=== IN SUPABASE BUT NOT SHOPIFY (should be removed from queue) ===\n');

    // Group by financial_status
    const byFinancial: Record<string, string[]> = {};
    for (const orderName of inSupabaseNotShopify) {
      const row = supabaseOrderData[orderName];
      const status = row?.financial_status || 'null';
      if (!byFinancial[status]) byFinancial[status] = [];
      byFinancial[status].push(orderName);
    }

    console.log('By financial_status:');
    for (const [status, orders] of Object.entries(byFinancial).sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${status}: ${orders.length}`);
    }

    // Show all orders
    console.log('\n--- Full list ---');
    for (const [status, orders] of Object.entries(byFinancial).sort((a, b) => b[1].length - a[1].length)) {
      console.log(`\n${status} (${orders.length}):`);
      for (const orderName of orders.sort()) {
        const row = supabaseOrderData[orderName];
        console.log(`  ${orderName} | ${row?.warehouse} | ${row?.created_at?.slice(0, 10)} | ${row?.fulfillment_status || 'unfulfilled'}`);
      }
    }
  }

  // Analyze orders in Shopify but not Supabase
  if (inShopifyNotSupabase.length > 0) {
    console.log('\n=== IN SHOPIFY BUT NOT SUPABASE (missing from our data) ===\n');
    console.log('Orders:', inShopifyNotSupabase.sort().join(', '));
  }
}

analyze();
