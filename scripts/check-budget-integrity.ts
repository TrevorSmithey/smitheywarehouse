import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function check() {
  // Get ALL Nov 2025 budgets
  const { data } = await supabase
    .from('budgets')
    .select('sku, channel, budget')
    .eq('year', 2025)
    .eq('month', 11);

  // Group by SKU
  const bysku: Record<string, Record<string, number>> = {};
  data?.forEach(d => {
    const key = d.sku.toLowerCase();
    if (!bysku[key]) bysku[key] = {};
    bysku[key][d.channel] = d.budget;
  });

  console.log('=== BUDGET INTEGRITY CHECK - NOV 2025 ===\n');

  console.log('SKUs where Total != Retail + Wholesale (diff > 1):');
  let totalDiff = 0;
  let mismatchCount = 0;
  Object.entries(bysku).forEach(([sku, channels]) => {
    const r = channels.retail || 0;
    const w = channels.wholesale || 0;
    const t = channels.total || 0;
    const diff = t - (r + w);
    if (Math.abs(diff) > 1) {
      console.log(`  ${sku}: total=${t}, r+w=${r + w}, diff=${diff}`);
      totalDiff += diff;
      mismatchCount++;
    }
  });
  console.log(`\nMismatches: ${mismatchCount}, Total difference: ${totalDiff}`);

  // Check for SKUs with total but missing retail/wholesale
  console.log('\nSKUs with total but NO retail OR wholesale breakdown:');
  let missingBreakdown = 0;
  Object.entries(bysku).forEach(([sku, channels]) => {
    if (channels.total && (!channels.retail || !channels.wholesale)) {
      console.log(`  ${sku}: total=${channels.total}, retail=${channels.retail || 'MISSING'}, wholesale=${channels.wholesale || 'MISSING'}`);
      missingBreakdown++;
    }
  });
  console.log(`\nSKUs missing breakdown: ${missingBreakdown}`);
}

check();
