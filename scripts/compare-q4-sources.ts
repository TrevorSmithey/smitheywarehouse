import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function compare() {
  console.log('=== Q4 2025 REVENUE SOURCE COMPARISON ===\n');

  // 1. Revenue Tracker D2C (annual_sales_tracking) - Q4 2025
  // Columns: year, day_of_year, date, quarter, orders, revenue, channel, synced_at
  const { data: revTracker, error: revErr } = await supabase
    .from('annual_sales_tracking')
    .select('date, orders, revenue')
    .eq('channel', 'd2c')
    .gte('date', '2025-10-01')
    .lte('date', '2025-12-31')
    .order('date');

  if (revErr) console.log('RevTracker Error:', revErr.message);

  const revTrackerTotal = revTracker?.reduce((sum, d) => sum + (parseFloat(d.revenue) || 0), 0) || 0;
  const revTrackerOrders = revTracker?.reduce((sum, d) => sum + (d.orders || 0), 0) || 0;

  console.log('REVENUE TRACKER (D2C / annual_sales_tracking):');
  console.log(`  Date range: ${revTracker?.[0]?.date} to ${revTracker?.[revTracker.length - 1]?.date}`);
  console.log(`  Days: ${revTracker?.length}`);
  console.log(`  Revenue: $${(revTrackerTotal / 1000000).toFixed(2)}M`);
  console.log(`  Orders: ${revTrackerOrders.toLocaleString()}`);

  // 2. Holiday Tracking (Excel data for Q4 Pace) - 2025
  // Columns: day_number, orders_2025, sales_2025, etc
  const { data: holiday, error: holErr } = await supabase
    .from('holiday_tracking')
    .select('day_number, orders_2025, sales_2025')
    .order('day_number');

  if (holErr) console.log('Holiday Error:', holErr.message);

  // Filter for rows with 2025 data
  const holiday2025 = holiday?.filter(h => h.orders_2025 !== null) || [];
  const holidayTotal = holiday2025.reduce((sum, d) => sum + (parseFloat(d.sales_2025) || 0), 0);
  const holidayOrders = holiday2025.reduce((sum, d) => sum + (d.orders_2025 || 0), 0);
  const maxExcelDay = holiday2025.reduce((max, d) => Math.max(max, d.day_number), 0);

  console.log('\nQ4 PACE - EXCEL (holiday_tracking 2025):');
  console.log(`  Days covered: 1 to ${maxExcelDay}`);
  console.log(`  Days with data: ${holiday2025.length}`);
  console.log(`  Revenue: $${(holidayTotal / 1000000).toFixed(2)}M`);
  console.log(`  Orders: ${holidayOrders.toLocaleString()}`);

  // 3. Daily Stats (Live data that supplements Excel)
  // Columns: date, total_orders, total_revenue
  const { data: dailyStats, error: dailyErr } = await supabase
    .from('daily_stats')
    .select('date, total_orders, total_revenue')
    .gte('date', '2025-10-01')
    .lte('date', '2025-12-31')
    .order('date');

  if (dailyErr) console.log('DailyStats Error:', dailyErr.message);

  const dailyStatsTotal = dailyStats?.reduce((sum, d) => sum + (parseFloat(d.total_revenue) || 0), 0) || 0;
  const dailyStatsOrders = dailyStats?.reduce((sum, d) => sum + (d.total_orders || 0), 0) || 0;

  console.log('\nDAILY STATS (Shopify live sync):');
  console.log(`  Date range: ${dailyStats?.[0]?.date} to ${dailyStats?.[dailyStats.length - 1]?.date}`);
  console.log(`  Days count: ${dailyStats?.length}`);
  console.log(`  Revenue: $${(dailyStatsTotal / 1000000).toFixed(2)}M`);
  console.log(`  Orders: ${dailyStatsOrders.toLocaleString()}`);

  // Convert day_number to date: day 1 = Oct 1 = 2025-10-01
  const cutoffDate = new Date('2025-09-30');
  cutoffDate.setDate(cutoffDate.getDate() + maxExcelDay);
  const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

  // Live portion: days after cutoff
  const liveStats = dailyStats?.filter(d => d.date > cutoffDateStr) || [];
  const liveTotal = liveStats.reduce((sum, d) => sum + (parseFloat(d.total_revenue) || 0), 0);
  const liveOrders = liveStats.reduce((sum, d) => sum + (d.total_orders || 0), 0);

  console.log('\nQ4 PACE COMBINED CALCULATION:');
  console.log(`  Excel cutoff date: ${cutoffDateStr} (day ${maxExcelDay})`);
  console.log(`  Excel portion: $${(holidayTotal / 1000000).toFixed(2)}M (${holidayOrders.toLocaleString()} orders)`);
  console.log(`  Live portion (${liveStats.length} days after cutoff): $${(liveTotal / 1000000).toFixed(2)}M (${liveOrders.toLocaleString()} orders)`);
  console.log(`  Q4 Pace Total: $${((holidayTotal + liveTotal) / 1000000).toFixed(2)}M (${(holidayOrders + liveOrders).toLocaleString()} orders)`);

  // Build lookup maps
  const dailyByDate: Record<string, { revenue: number; orders: number }> = {};
  dailyStats?.forEach(d => {
    dailyByDate[d.date] = { revenue: parseFloat(d.total_revenue) || 0, orders: d.total_orders };
  });

  const revByDate: Record<string, { revenue: number; orders: number }> = {};
  revTracker?.forEach(d => {
    revByDate[d.date] = { revenue: parseFloat(d.revenue) || 0, orders: d.orders };
  });

  // Compare the two Shopify sources: annual_sales_tracking vs daily_stats
  console.log('\n=== SHOPIFY SOURCES: annual_sales_tracking vs daily_stats ===');
  console.log('(Both should be from Shopify API, should match)');
  const totalDiff = dailyStatsTotal - revTrackerTotal;
  console.log(`Daily Stats Total: $${(dailyStatsTotal / 1000000).toFixed(2)}M (${dailyStatsOrders.toLocaleString()} orders)`);
  console.log(`annual_sales_tracking D2C: $${(revTrackerTotal / 1000000).toFixed(2)}M (${revTrackerOrders.toLocaleString()} orders)`);
  console.log(`Difference: $${(totalDiff / 1000).toFixed(0)}K (${dailyStatsOrders - revTrackerOrders} orders)`);

  // Sample day comparison between daily_stats and annual_sales_tracking
  console.log('\nSample days (Oct 1-7):');
  for (let i = 1; i <= 7; i++) {
    const dateStr = `2025-10-0${i}`;
    const ds = dailyByDate[dateStr];
    const ast = revByDate[dateStr];
    console.log(`  ${dateStr}: daily_stats=$${ds?.revenue?.toLocaleString() || 'N/A'} annual_sales=$${ast?.revenue?.toLocaleString() || 'N/A'}`);
  }

  // Excel vs Shopify comparison
  console.log('\n=== EXCEL vs SHOPIFY COMPARISON ===');
  console.log('Comparing holiday_tracking (Excel) to daily_stats (Shopify) for same day_numbers:');

  let totalExcelShopifyDiff = 0;
  holiday2025.slice(0, 10).forEach(h => {
    const dayNum = h.day_number;
    // Convert day_number to date (day 1 = Oct 1)
    const date = new Date('2025-09-30');
    date.setDate(date.getDate() + dayNum);
    const dateStr = date.toISOString().split('T')[0];

    const shopify = dailyByDate[dateStr];
    const excelRev = parseFloat(h.sales_2025) || 0;
    const shopifyRev = shopify?.revenue || 0;
    const diff = excelRev - shopifyRev;
    totalExcelShopifyDiff += diff;
    console.log(`  Day ${dayNum} (${dateStr}): Excel=$${excelRev.toLocaleString()} Shopify=$${shopifyRev.toLocaleString()} Diff=$${diff.toLocaleString()}`);
  });

  // Total Excel vs Shopify for the Excel date range
  const shopifyForExcelRange = dailyStats?.filter(d => d.date >= '2025-10-01' && d.date <= cutoffDateStr) || [];
  const shopifyRangeTotal = shopifyForExcelRange.reduce((sum, d) => sum + (parseFloat(d.total_revenue) || 0), 0);

  console.log(`\nExcel total (days 1-${maxExcelDay}): $${(holidayTotal / 1000000).toFixed(2)}M`);
  console.log(`Shopify (daily_stats) same range: $${(shopifyRangeTotal / 1000000).toFixed(2)}M`);
  console.log(`Difference: $${((holidayTotal - shopifyRangeTotal) / 1000).toFixed(0)}K`);

  // KEY FINDING
  console.log('\n' + '='.repeat(60));
  console.log('KEY FINDING:');
  console.log('='.repeat(60));
  const q4PaceTotal = holidayTotal + liveTotal;
  const revTrackerRetailTotal = revTrackerTotal;
  console.log(`\nQ4 Pace Tab (Excel + Live):     $${(q4PaceTotal / 1000000).toFixed(2)}M`);
  console.log(`Revenue Tracker (Retail/D2C):   $${(revTrackerRetailTotal / 1000000).toFixed(2)}M`);
  console.log(`Difference:                     $${((q4PaceTotal - revTrackerRetailTotal) / 1000).toFixed(0)}K`);

  console.log('\nRoot cause: Excel data (holiday_tracking) differs from Shopify API data (annual_sales_tracking)');
  console.log('The Excel file is manually uploaded and may have different totals than Shopify API.');
}

compare();
