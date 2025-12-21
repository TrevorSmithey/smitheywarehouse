import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

async function check() {
  // Check line_items coverage
  const { count: totalOrders } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true });

  const { count: totalLineItems } = await supabase
    .from('line_items')
    .select('*', { count: 'exact', head: true });

  console.log('=== LINE ITEMS COVERAGE ===');
  console.log('Total orders:', totalOrders);
  console.log('Total line item records:', totalLineItems);

  // Check for orders missing line items from recent 50
  const { data: recentOrders } = await supabase
    .from('orders')
    .select('id, order_name')
    .order('created_at', { ascending: false })
    .limit(50);

  let missingLineItems = 0;
  if (recentOrders) {
    for (const o of recentOrders) {
      const { count } = await supabase
        .from('line_items')
        .select('*', { count: 'exact', head: true })
        .eq('order_id', o.id);

      if (count === null || count === 0) {
        missingLineItems++;
      }
    }
  }

  console.log('Recent 50 orders missing line items:', missingLineItems);

  // Check today's orders specifically
  const today = new Date().toISOString().slice(0, 10);

  // Total today orders
  const { count: todayCount } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', today);

  // Today orders with null warehouse
  const { count: todayNullWarehouse } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', today)
    .is('warehouse', null);

  // Today orders with warehouse assigned
  const { count: todayWithWarehouse } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', today)
    .not('warehouse', 'is', null);

  console.log('\n=== TODAY\'S ORDERS (' + today + ') ===');
  console.log('Total orders today:', todayCount);
  console.log('With warehouse assigned:', todayWithWarehouse);
  console.log('With NULL warehouse:', todayNullWarehouse);
  console.log('Warehouse assignment rate:', Math.round((todayWithWarehouse || 0) / ((todayCount || 1)) * 100) + '%');

  // Show a sample of null warehouse orders
  const { data: nullWarehouseSample } = await supabase
    .from('orders')
    .select('order_name, created_at')
    .gte('created_at', today)
    .is('warehouse', null)
    .order('created_at', { ascending: false })
    .limit(10);

  if (nullWarehouseSample && nullWarehouseSample.length > 0) {
    console.log('\nSample orders with null warehouse:');
    for (const o of nullWarehouseSample) {
      console.log('  ' + o.order_name + ' created at ' + o.created_at?.slice(11, 19));
    }
  }
}

check();
