import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function dayByDay() {
  // Get all Excel data with 2025 values
  const { data: holiday } = await supabase
    .from('holiday_tracking')
    .select('day_number, date_2025, orders_2025, sales_2025')
    .order('day_number');

  // Get all daily_stats for Q4 2025
  const { data: dailyStats } = await supabase
    .from('daily_stats')
    .select('date, total_orders, total_revenue')
    .gte('date', '2025-10-01')
    .lte('date', '2025-12-31')
    .order('date');

  const dailyByDate: Record<string, { orders: number; revenue: number }> = {};
  dailyStats?.forEach(d => {
    dailyByDate[d.date] = { orders: d.total_orders, revenue: parseFloat(d.total_revenue) || 0 };
  });

  console.log('=== DAY-BY-DAY REVENUE COMPARISON (Excel vs Shopify) ===\n');
  console.log('Days where |diff| > $100:\n');

  let totalExcel = 0;
  let totalShopify = 0;
  let significantDiffs = 0;

  const holiday2025 = holiday?.filter(h => h.orders_2025 !== null) || [];

  for (const h of holiday2025) {
    const dateStr = h.date_2025;
    const excelRev = parseFloat(h.sales_2025) || 0;
    const shopifyRev = dailyByDate[dateStr]?.revenue || 0;
    const diff = excelRev - shopifyRev;

    totalExcel += excelRev;
    totalShopify += shopifyRev;

    if (Math.abs(diff) > 100) {
      significantDiffs++;
      console.log(`Day ${h.day_number} (${dateStr}): Excel=$${excelRev.toLocaleString()} Shopify=$${shopifyRev.toLocaleString()} Diff=$${diff.toLocaleString()}`);
    }
  }

  console.log(`\nDays with significant difference: ${significantDiffs}`);
  console.log(`\nTotal Excel: $${totalExcel.toLocaleString()}`);
  console.log(`Total Shopify: $${totalShopify.toLocaleString()}`);
  console.log(`Sum of diffs: $${(totalExcel - totalShopify).toLocaleString()}`);

  // Now check if Shopify has MORE days than Excel
  console.log('\n=== DAYS IN SHOPIFY BUT NOT IN EXCEL (Oct 1 - Dec 20) ===');
  const excelDates = new Set(holiday2025.map(h => h.date_2025));

  const shopifyInRange = dailyStats?.filter(d => d.date >= '2025-10-01' && d.date <= '2025-12-20') || [];
  let missingFromExcel = 0;
  let missingRevenue = 0;

  for (const d of shopifyInRange) {
    if (!excelDates.has(d.date)) {
      missingFromExcel++;
      missingRevenue += parseFloat(d.total_revenue) || 0;
      console.log(`${d.date}: $${parseFloat(d.total_revenue).toLocaleString()} (NOT in Excel)`);
    }
  }

  console.log(`\nShopify days not in Excel: ${missingFromExcel}`);
  console.log(`Revenue in Shopify not in Excel: $${missingRevenue.toLocaleString()}`);

  // Check total Shopify for the EXACT date range
  const shopifyExactRange = dailyStats?.filter(d => d.date >= '2025-10-01' && d.date <= '2025-12-20') || [];
  const shopifyExactTotal = shopifyExactRange.reduce((sum, d) => sum + (parseFloat(d.total_revenue) || 0), 0);
  console.log(`\nShopify total (Oct 1 - Dec 20): $${shopifyExactTotal.toLocaleString()}`);
  console.log(`Shopify days in range: ${shopifyExactRange.length}`);
  console.log(`Excel days: ${holiday2025.length}`);

  // What if Excel has a different number of days?
  console.log('\n=== EXPLANATION ===');
  console.log(`Excel has ${holiday2025.length} days of data`);
  console.log(`Shopify (Oct 1 - Dec 20) has ${shopifyExactRange.length} days`);
  console.log(`Day count diff: ${holiday2025.length - shopifyExactRange.length}`);

  if (holiday2025.length !== shopifyExactRange.length) {
    console.log('\n*** THE $600K GAP IS FROM A DATE RANGE MISMATCH ***');
  }
}

dayByDay();
