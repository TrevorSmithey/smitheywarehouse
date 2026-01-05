/**
 * Backfill warehouse field from Shopify tags for orders with null warehouse
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const SHOPIFY_STORE = process.env.SHOPIFY_STORE_URL!;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function extractWarehouse(tags: string): string | null {
  if (!tags) return null;
  const tagList = tags.toLowerCase().split(',').map(t => t.trim());
  if (tagList.includes('smithey')) return 'smithey';
  if (tagList.includes('selery')) return 'selery';
  return null;
}

async function backfillWarehouse() {
  // Get orders with null warehouse - newest first so we fix today's orders
  const { data: nullWarehouseOrders, error: fetchError } = await supabase
    .from('orders')
    .select('id, order_name')
    .is('warehouse', null)
    .gte('created_at', '2026-01-01')
    .order('created_at', { ascending: false })
    .limit(100);

  if (fetchError) {
    console.error('Error fetching orders:', fetchError);
    return;
  }

  console.log(`Found ${nullWarehouseOrders?.length || 0} orders with null warehouse`);

  if (!nullWarehouseOrders || nullWarehouseOrders.length === 0) {
    console.log('No orders to backfill');
    return;
  }

  let updated = 0;
  let skipped = 0;

  for (const order of nullWarehouseOrders) {
    const url = `https://${SHOPIFY_STORE}/admin/api/2024-01/orders/${order.id}.json?fields=id,name,tags`;

    try {
      const response = await fetch(url, {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_TOKEN,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.log(`Failed to fetch ${order.order_name}: ${response.status}`);
        skipped++;
        continue;
      }

      const data = await response.json();
      const tags = data.order?.tags || '';
      const warehouse = extractWarehouse(tags);

      console.log(`${order.order_name}: tags="${tags.substring(0, 60)}" -> warehouse=${warehouse}`);

      if (warehouse) {
        const { error: updateError } = await supabase
          .from('orders')
          .update({ warehouse, updated_at: new Date().toISOString() })
          .eq('id', order.id);

        if (updateError) {
          console.log(`  Update failed: ${updateError.message}`);
          skipped++;
        } else {
          console.log(`  Updated!`);
          updated++;
        }
      } else {
        console.log(`  No warehouse tag found, skipping`);
        skipped++;
      }

      // Rate limit - 2 requests per second
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.error(`Error processing ${order.order_name}:`, err);
      skipped++;
    }
  }

  console.log(`\nDone! Updated: ${updated}, Skipped: ${skipped}`);
}

backfillWarehouse()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
