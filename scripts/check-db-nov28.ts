import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function check() {
  console.log('=== DATABASE VALUES FOR NOV 28 ===\n');

  // Check daily_stats
  const { data: daily } = await supabase
    .from('daily_stats')
    .select('*')
    .eq('date', '2025-11-28');

  console.log('daily_stats for 2025-11-28:');
  console.log(daily);

  // Check annual_sales_tracking
  const { data: annual } = await supabase
    .from('annual_sales_tracking')
    .select('*')
    .eq('date', '2025-11-28');

  console.log('\nannual_sales_tracking for 2025-11-28:');
  console.log(annual);

  // Check sync logs to see when this was last synced
  const { data: logs } = await supabase
    .from('sync_logs')
    .select('*')
    .eq('sync_type', 'shopify_stats')
    .order('completed_at', { ascending: false })
    .limit(3);

  console.log('\nRecent shopify_stats sync logs:');
  logs?.forEach(log => {
    console.log(`  ${log.completed_at}: ${log.status}, ${log.records_synced} records`);
  });
}

check();
