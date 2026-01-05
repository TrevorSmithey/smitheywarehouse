import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function check() {
  console.log('=== DATE RANGE BUG VERIFICATION ===\n');

  // What the API SHOULD use for "last_month" (November 2025)
  const correctStart = '2025-11-01T00:00:00.000Z';
  const correctEnd = '2025-12-01T00:00:00.000Z';

  // What the API ACTUALLY uses (Nov 1 → NOW)
  const buggyEnd = new Date().toISOString();  // Today!

  console.log('CORRECT date range: Nov 1 → Dec 1 (end of Nov)');
  console.log('BUGGY date range: Nov 1 →', buggyEnd, '(TODAY!)\n');

  // Query with CORRECT dates
  const { data: correctData } = await supabase.rpc('get_budget_actuals_v2', {
    p_start_date: correctStart,
    p_end_date: correctEnd,
  });
  const chef8Correct = correctData?.find((r: any) => r.sku.toLowerCase() === 'smith-ci-skil8');

  // Query with BUGGY dates (what the API does)
  const { data: buggyData } = await supabase.rpc('get_budget_actuals_v2', {
    p_start_date: correctStart,
    p_end_date: buggyEnd,
  });
  const chef8Buggy = buggyData?.find((r: any) => r.sku.toLowerCase() === 'smith-ci-skil8');

  console.log('8CHEF with CORRECT dates (Nov only):');
  console.log(`  Retail: ${chef8Correct?.retail_qty}, B2B: ${chef8Correct?.wholesale_qty}, Total: ${chef8Correct?.total_qty}`);

  console.log('\n8CHEF with BUGGY dates (Nov + Dec so far):');
  console.log(`  Retail: ${chef8Buggy?.retail_qty}, B2B: ${chef8Buggy?.wholesale_qty}, Total: ${chef8Buggy?.total_qty}`);

  console.log('\n=== CONCLUSION ===');
  console.log('UI shows 7,378 because it\'s including December sales!');
  console.log(`Difference: ${(chef8Buggy?.total_qty || 0) - (chef8Correct?.total_qty || 0)} extra units from Dec`);
}

check();
