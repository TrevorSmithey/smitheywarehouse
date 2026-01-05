/**
 * Fix warehouse for orders fulfilled today
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const SHOPIFY_STORE = process.env.SHOPIFY_STORE_URL!;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function extractWarehouse(tags: string | null): string | null {
  if (!tags) return null;
  const tagList = tags.toLowerCase().split(',').map(t => t.trim());
  if (tagList.includes('smithey')) return 'smithey';
  if (tagList.includes('selery')) return 'selery';
  return null;
}

async function getShopifyTags(orderId: number): Promise<string | null> {
  const url = `https://${SHOPIFY_STORE}/admin/api/2024-01/orders/${orderId}.json?fields=id,name,tags`;
  try {
    const response = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_TOKEN,
        'Content-Type': 'application/json',
      },
    });
    if (response.ok) {
      const data = await response.json();
      return data.order?.tags || '';
    }
  } catch (err) {
    console.error(`Error fetching order ${orderId}:`, err);
  }
  return null;
}

async function fixTodayOrders() {
  // Get orders fulfilled today with null warehouse
  const { data: todayOrders, error: fetchError } = await supabase
    .from('orders')
    .select('id, order_name')
    .gte('fulfilled_at', '2026-01-02T00:00:00')
    .lte('fulfilled_at', '2026-01-02T23:59:59')
    .is('warehouse', null)
    .eq('canceled', false);

  if (fetchError) {
    console.error('Error fetching orders:', fetchError);
    return;
  }

  console.log(`Found ${todayOrders?.length || 0} orders fulfilled today with null warehouse`);

  if (!todayOrders || todayOrders.length === 0) {
    console.log('No orders to fix');
    return;
  }

  let updated = 0;
  let skipped = 0;

  for (const order of todayOrders) {
    const tags = await getShopifyTags(order.id);
    const warehouse = extractWarehouse(tags);

    if (warehouse) {
      const { error: updateError } = await supabase
        .from('orders')
        .update({ warehouse, updated_at: new Date().toISOString() })
        .eq('id', order.id);

      if (!updateError) {
        console.log(`${order.order_name}: "${(tags || '').substring(0, 50)}" -> ${warehouse} UPDATED`);
        updated++;
      } else {
        console.log(`${order.order_name}: Update failed - ${updateError.message}`);
        skipped++;
      }
    } else {
      console.log(`${order.order_name}: "${(tags || '').substring(0, 50)}" -> NO WAREHOUSE TAG`);
      skipped++;
    }

    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\nDone! Updated: ${updated}, Skipped: ${skipped}`);
}

fixTodayOrders()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
