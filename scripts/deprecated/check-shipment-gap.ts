import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

async function check() {
  // How many shipments do we have?
  const { count: shipmentCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });

  // How many fulfilled orders do we have?
  const { count: fulfilledCount } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('fulfillment_status', 'fulfilled');

  // How many orders have fulfilled_at set?
  const { count: fulfilledAtCount } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .not('fulfilled_at', 'is', null);

  // Recent fulfilled orders
  const { data: recentFulfilled } = await supabase
    .from('orders')
    .select('order_name, fulfilled_at, created_at')
    .eq('fulfillment_status', 'fulfilled')
    .order('fulfilled_at', { ascending: false })
    .limit(10);

  console.log('=== SHIPMENT & FULFILLMENT DATA GAP ===\n');
  console.log(`Total shipments in DB: ${shipmentCount}`);
  console.log(`Orders marked fulfilled: ${fulfilledCount}`);
  console.log(`Orders with fulfilled_at: ${fulfilledAtCount}`);

  if (recentFulfilled && recentFulfilled.length > 0) {
    console.log('\nMost recent fulfilled orders:');
    for (const o of recentFulfilled) {
      console.log(`  ${o.order_name} | fulfilled: ${o.fulfilled_at?.slice(0, 10)} | created: ${o.created_at?.slice(0, 10)}`);
    }
  }

  // Check for orders that should have tracking but don't
  const { data: fulfilledNoShipment } = await supabase
    .from('orders')
    .select('id, order_name')
    .eq('fulfillment_status', 'fulfilled')
    .limit(100);

  if (fulfilledNoShipment) {
    let missingShipments = 0;
    for (const order of fulfilledNoShipment) {
      const { count } = await supabase
        .from('shipments')
        .select('*', { count: 'exact', head: true })
        .eq('order_id', order.id);

      if (!count || count === 0) {
        missingShipments++;
      }
    }
    console.log(`\nFulfilled orders missing shipment records: ${missingShipments}/${fulfilledNoShipment.length} sampled`);
  }
}

check();
