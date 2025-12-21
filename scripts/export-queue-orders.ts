import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

async function exportOrders() {
  console.log('Fetching all orders in fulfillment queue...\n');

  // Get unfulfilled orders (fulfillment_status = null)
  const { data: unfulfilled, error: err1 } = await supabase
    .from('orders')
    .select('order_name, warehouse, created_at, financial_status, fulfillment_status')
    .is('fulfillment_status', null)
    .eq('canceled', false)
    .eq('is_restoration', false)
    .not('warehouse', 'is', null)
    .order('created_at', { ascending: false });

  if (err1) {
    console.error('Error fetching unfulfilled:', err1);
    return;
  }

  // Get partial orders (fulfillment_status = 'partial')
  const { data: partial, error: err2 } = await supabase
    .from('orders')
    .select('order_name, warehouse, created_at, financial_status, fulfillment_status')
    .eq('fulfillment_status', 'partial')
    .eq('canceled', false)
    .eq('is_restoration', false)
    .not('warehouse', 'is', null)
    .order('created_at', { ascending: false });

  if (err2) {
    console.error('Error fetching partial:', err2);
    return;
  }

  const allOrders = [...(unfulfilled || []), ...(partial || [])];

  console.log(`Found ${unfulfilled?.length || 0} unfulfilled + ${partial?.length || 0} partial = ${allOrders.length} total\n`);

  // Create CSV
  const csvLines = ['order_name,warehouse,created_at,financial_status,fulfillment_status'];

  for (const o of allOrders) {
    const created = o.created_at ? o.created_at.slice(0, 19) : '';
    const financial = o.financial_status || 'null';
    const fulfillment = o.fulfillment_status || 'unfulfilled';
    csvLines.push(`${o.order_name},${o.warehouse},${created},${financial},${fulfillment}`);
  }

  const csvContent = csvLines.join('\n');
  const outputPath = '/Users/trevorfunderburk/Desktop/fulfillment_queue_orders.csv';

  fs.writeFileSync(outputPath, csvContent);
  console.log(`Exported to: ${outputPath}`);

  // Summary
  const byStatus: Record<string, number> = {};
  for (const o of allOrders) {
    const key = o.financial_status || 'null';
    byStatus[key] = (byStatus[key] || 0) + 1;
  }

  console.log('\nBreakdown by financial_status:');
  for (const [status, count] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status}: ${count}`);
  }
}

exportOrders();
