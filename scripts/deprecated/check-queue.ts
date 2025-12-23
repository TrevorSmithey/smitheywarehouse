import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

async function check() {
  console.log('=== FULFILLMENT QUEUE ANALYSIS ===\n');

  // Total unfulfilled (what dashboard currently shows)
  const { count: totalUnfulfilled } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .is('fulfillment_status', null)
    .eq('canceled', false)
    .eq('is_restoration', false)
    .not('warehouse', 'is', null);

  // Breakdown by financial_status
  const financialStatuses = ['paid', 'pending', 'authorized', 'refunded', 'voided', 'partially_refunded', 'partially_paid'];

  console.log('Unfulfilled orders by financial_status:');
  let paidCount = 0;
  let nonPaidCount = 0;

  for (const status of financialStatuses) {
    const { count } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .is('fulfillment_status', null)
      .eq('canceled', false)
      .eq('is_restoration', false)
      .not('warehouse', 'is', null)
      .eq('financial_status', status);

    if (count && count > 0) {
      console.log(`  ${status}: ${count}`);
      if (status === 'paid' || status === 'partially_paid') {
        paidCount += count;
      } else {
        nonPaidCount += count;
      }
    }
  }

  // Check for null financial_status
  const { count: nullFinancial } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .is('fulfillment_status', null)
    .eq('canceled', false)
    .eq('is_restoration', false)
    .not('warehouse', 'is', null)
    .is('financial_status', null);

  if (nullFinancial && nullFinancial > 0) {
    console.log(`  (null): ${nullFinancial}`);
  }

  console.log('\n=== SUMMARY ===\n');
  console.log(`  Total unfulfilled (current): ${totalUnfulfilled}`);
  console.log(`  Paid/partially_paid orders: ${paidCount}`);
  console.log(`  Refunded/voided/other: ${nonPaidCount}`);
  console.log(`  Null financial status: ${nullFinancial || 0}`);

  console.log('\n  → Dashboard should only show PAID orders as needing fulfillment');
  console.log(`  → Correct queue count: ~${paidCount} (not ${totalUnfulfilled})`);

  // Sample refunded but "unfulfilled" orders
  const { data: refundedSample } = await supabase
    .from('orders')
    .select('order_name, created_at, warehouse, financial_status')
    .is('fulfillment_status', null)
    .eq('canceled', false)
    .eq('is_restoration', false)
    .not('warehouse', 'is', null)
    .eq('financial_status', 'refunded')
    .order('created_at', { ascending: false })
    .limit(10);

  if (refundedSample && refundedSample.length > 0) {
    console.log('\n=== SAMPLE REFUNDED BUT "UNFULFILLED" ===\n');
    for (const o of refundedSample) {
      console.log(`  ${o.order_name} | ${o.warehouse} | ${o.created_at?.slice(0, 10)}`);
    }
  }
}

check();
