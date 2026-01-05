import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

/**
 * The 1-day offset: User's Excel aligns Black Friday to Black Friday YoY
 * This means Excel Day N corresponds to a DIFFERENT calendar date than a naive calculation
 *
 * Let's figure out the actual mapping
 */
async function findDiff() {
  // Get all Excel data with 2025 values
  const { data: holiday } = await supabase
    .from('holiday_tracking')
    .select('day_number, date_2024, date_2025, orders_2024, orders_2025, sales_2024, sales_2025')
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

  console.log('=== FINDING THE DAY-BY-DAY DISCREPANCY ===\n');

  // Check what date_2025 actually contains in the Excel
  console.log('Sample of Excel date_2025 column:');
  holiday?.slice(0, 5).forEach(h => {
    console.log(`  Day ${h.day_number}: date_2025="${h.date_2025}" date_2024="${h.date_2024}"`);
  });

  console.log('\n=== COMPARING Excel date_2025 vs naive day calculation ===\n');

  let totalDiffDays = 0;
  let totalExcel = 0;
  let totalShopifyNaive = 0;
  let totalShopifyExcelDate = 0;

  const mismatches: string[] = [];

  const holiday2025 = holiday?.filter(h => h.orders_2025 !== null) || [];

  for (const h of holiday2025) {
    const dayNum = h.day_number;
    const excelDate = h.date_2025; // What Excel says the date is

    // Naive calculation: day 1 = Oct 1
    const naiveDate = new Date('2025-09-30');
    naiveDate.setDate(naiveDate.getDate() + dayNum);
    const naiveDateStr = naiveDate.toISOString().split('T')[0];

    const excelRev = parseFloat(h.sales_2025) || 0;
    const shopifyNaive = dailyByDate[naiveDateStr];
    const shopifyExcelDate = excelDate ? dailyByDate[excelDate] : null;

    totalExcel += excelRev;
    totalShopifyNaive += shopifyNaive?.revenue || 0;
    totalShopifyExcelDate += shopifyExcelDate?.revenue || 0;

    // Check if Excel date differs from naive calculation
    if (excelDate && excelDate !== naiveDateStr) {
      totalDiffDays++;
      if (totalDiffDays <= 10) {
        mismatches.push(`Day ${dayNum}: Excel says "${excelDate}", naive calc says "${naiveDateStr}"`);
      }
    }

    // Check if revenue differs when comparing by naive date
    const revDiff = excelRev - (shopifyNaive?.revenue || 0);
    if (Math.abs(revDiff) > 1 && dayNum <= 20) {
      console.log(`Day ${dayNum} (naive=${naiveDateStr}): Excel=$${excelRev.toLocaleString()} vs Shopify=$${shopifyNaive?.revenue?.toLocaleString() || 'N/A'}, Diff=$${revDiff.toLocaleString()}`);
    }
  }

  if (mismatches.length > 0) {
    console.log('\n=== DATE MAPPING MISMATCHES ===');
    mismatches.forEach(m => console.log(m));
    if (totalDiffDays > 10) {
      console.log(`... and ${totalDiffDays - 10} more days with different dates`);
    }
  } else {
    console.log('No date mapping mismatches found (Excel date_2025 matches naive calculation)');
  }

  console.log('\n=== TOTALS BY COMPARISON METHOD ===');
  console.log(`Excel total: $${(totalExcel / 1e6).toFixed(2)}M`);
  console.log(`Shopify (naive day->date): $${(totalShopifyNaive / 1e6).toFixed(2)}M`);
  console.log(`Shopify (using Excel date): $${(totalShopifyExcelDate / 1e6).toFixed(2)}M`);
  console.log(`\nDiff (Excel - Shopify naive): $${((totalExcel - totalShopifyNaive) / 1000).toFixed(0)}K`);
  console.log(`Diff (Excel - Shopify by Excel date): $${((totalExcel - totalShopifyExcelDate) / 1000).toFixed(0)}K`);

  // Now let's look at the Q4 Pace calculation logic more carefully
  // It uses daily_stats for days AFTER the Excel cutoff
  const maxExcelDay = holiday2025.reduce((max, h) => Math.max(max, h.day_number), 0);
  const maxExcelDate = holiday2025.find(h => h.day_number === maxExcelDay)?.date_2025;

  console.log(`\n=== Q4 PACE LIVE PORTION ANALYSIS ===`);
  console.log(`Max Excel day: ${maxExcelDay}, Excel's date: ${maxExcelDate}`);

  // The API uses naive day->date conversion for cutoff
  const naiveCutoff = new Date('2025-09-30');
  naiveCutoff.setDate(naiveCutoff.getDate() + maxExcelDay);
  const naiveCutoffStr = naiveCutoff.toISOString().split('T')[0];
  console.log(`API naive cutoff date: ${naiveCutoffStr}`);

  // Live days AFTER cutoff
  const liveAfterNaive = dailyStats?.filter(d => d.date > naiveCutoffStr) || [];
  const liveAfterExcel = maxExcelDate ? dailyStats?.filter(d => d.date > maxExcelDate) : [];

  console.log(`\nLive days after NAIVE cutoff (${naiveCutoffStr}): ${liveAfterNaive.length} days`);
  console.log(`Live days after EXCEL date (${maxExcelDate}): ${liveAfterExcel?.length || 0} days`);

  const liveNaiveTotal = liveAfterNaive.reduce((sum, d) => sum + (parseFloat(d.total_revenue) || 0), 0);
  const liveExcelTotal = (liveAfterExcel || []).reduce((sum, d) => sum + (parseFloat(d.total_revenue) || 0), 0);

  console.log(`\nLive revenue (naive cutoff): $${(liveNaiveTotal / 1e6).toFixed(2)}M`);
  console.log(`Live revenue (Excel date cutoff): $${(liveExcelTotal / 1e6).toFixed(2)}M`);

  // Calculate what Q4 Pace SHOULD be if using Excel dates correctly
  console.log(`\n=== CORRECTED Q4 PACE CALCULATION ===`);
  console.log(`Excel portion: $${(totalExcel / 1e6).toFixed(2)}M`);
  console.log(`+ Live (after Excel date): $${(liveExcelTotal / 1e6).toFixed(2)}M`);
  console.log(`= Total: $${((totalExcel + liveExcelTotal) / 1e6).toFixed(2)}M`);

  // But what the API currently does:
  console.log(`\n=== CURRENT Q4 PACE (may have overlap/gap) ===`);
  console.log(`Excel portion: $${(totalExcel / 1e6).toFixed(2)}M`);
  console.log(`+ Live (after naive cutoff): $${(liveNaiveTotal / 1e6).toFixed(2)}M`);
  console.log(`= Total: $${((totalExcel + liveNaiveTotal) / 1e6).toFixed(2)}M`);
}

findDiff();
