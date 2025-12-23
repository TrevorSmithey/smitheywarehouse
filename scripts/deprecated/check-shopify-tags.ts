import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const SHOPIFY_STORE = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

async function getShopifyOrder(orderName: string) {
  const cleanName = orderName.replace('#', '');
  const url = `https://${SHOPIFY_STORE}/admin/api/2024-01/orders.json?name=${cleanName}&status=any`;

  const response = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN || '',
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) return null;

  const data = await response.json();
  return data.orders?.[0] || null;
}

async function check() {
  // Get recent orders with no warehouse from Supabase
  const { data: orders } = await supabase
    .from('orders')
    .select('order_name, created_at')
    .is('warehouse', null)
    .is('fulfillment_status', null)
    .eq('canceled', false)
    .eq('is_restoration', false)
    .order('created_at', { ascending: false })
    .limit(20);

  console.log('=== CHECKING SHOPIFY TAGS FOR ORDERS WITH NULL WAREHOUSE ===\n');

  if (!orders || orders.length === 0) {
    console.log('No orders found with null warehouse');
    return;
  }

  for (const o of orders) {
    const shopifyOrder = await getShopifyOrder(o.order_name);

    if (shopifyOrder) {
      const tags = shopifyOrder.tags || '(no tags)';
      const hasSmithey = tags.toLowerCase().includes('smithey');
      const hasSelery = tags.toLowerCase().includes('selery');
      const warehouse = hasSmithey ? 'smithey' : hasSelery ? 'selery' : 'NONE';

      console.log(`${o.order_name} | Shopify tags: "${tags}" | Should be: ${warehouse}`);
    } else {
      console.log(`${o.order_name} | NOT FOUND in Shopify`);
    }

    await new Promise(r => setTimeout(r, 200)); // Rate limit
  }
}

check();
