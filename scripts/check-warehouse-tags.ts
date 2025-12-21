import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

async function check() {
  // Get orders with no warehouse
  const { data: orders, error } = await supabase
    .from('orders')
    .select('order_name, warehouse, tags, created_at, fulfillment_status')
    .is('warehouse', null)
    .is('fulfillment_status', null)
    .eq('canceled', false)
    .eq('is_restoration', false)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`=== ORDERS WITH NO WAREHOUSE (${orders?.length}) ===\n`);

  if (orders) {
    for (const o of orders) {
      console.log(`${o.order_name} | ${o.created_at?.slice(0, 16)} | tags: "${o.tags || '(none)'}"`);
    }
  }

  // Count total orders with null warehouse that are unfulfilled
  const { count } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .is('warehouse', null)
    .is('fulfillment_status', null)
    .eq('canceled', false)
    .eq('is_restoration', false);

  console.log(`\nTotal unfulfilled orders with no warehouse: ${count}`);
}

check();
