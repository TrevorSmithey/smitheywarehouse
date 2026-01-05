import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const shop = process.env.SHOPIFY_STORE_URL;
const accessToken = process.env.SHOPIFY_ADMIN_TOKEN;

async function fix() {
  console.log('=== FIXING BLACK FRIDAY DATA ===\n');

  // Query ShopifyQL for the BF period
  const query = `FROM sales SHOW total_sales, orders SINCE 2025-11-20 UNTIL 2025-12-01 TIMESERIES day ORDER BY day`;

  console.log('Fetching fresh data from ShopifyQL...');
  const result = await runShopifyQL(query);

  if (!result?.rows) {
    console.log('No data returned');
    return;
  }

  console.log(`Got ${result.rows.length} days of data\n`);

  for (const row of result.rows) {
    const date = row.day;
    const revenue = parseFloat(row.total_sales) || 0;
    const orders = parseInt(row.orders, 10) || 0;
    const avgOrderValue = orders > 0 ? revenue / orders : 0;

    // Check current DB value
    const { data: current } = await supabase
      .from('daily_stats')
      .select('total_orders, total_revenue')
      .eq('date', date)
      .single();

    const currentRev = current?.total_revenue || 0;
    const currentOrders = current?.total_orders || 0;
    const revDiff = revenue - currentRev;
    const orderDiff = orders - currentOrders;

    if (Math.abs(revDiff) > 1 || Math.abs(orderDiff) > 0) {
      console.log(`${date}: DB has ${currentOrders} orders/$${currentRev.toLocaleString()}, Shopify has ${orders} orders/$${revenue.toLocaleString()}`);
      console.log(`  -> Diff: ${orderDiff > 0 ? '+' : ''}${orderDiff} orders, ${revDiff > 0 ? '+' : ''}$${revDiff.toLocaleString()}`);

      // Update daily_stats
      const { error: dailyError } = await supabase.from('daily_stats').upsert({
        date,
        total_orders: orders,
        total_revenue: Math.round(revenue * 100) / 100,
        avg_order_value: Math.round(avgOrderValue * 100) / 100,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'date' });

      if (dailyError) {
        console.log(`  ERROR updating daily_stats: ${dailyError.message}`);
      } else {
        console.log(`  ✓ Updated daily_stats`);
      }

      // Update annual_sales_tracking
      const year = new Date(date).getFullYear();
      const dayOfYear = getDayOfYear(date);
      const quarter = getQuarter(date);

      const { error: annualError } = await supabase.from('annual_sales_tracking').upsert({
        year,
        day_of_year: dayOfYear,
        date,
        quarter,
        orders,
        revenue: Math.round(revenue * 100) / 100,
        channel: 'd2c',
        synced_at: new Date().toISOString(),
      }, { onConflict: 'year,day_of_year,channel' });

      if (annualError) {
        console.log(`  ERROR updating annual_sales_tracking: ${annualError.message}`);
      } else {
        console.log(`  ✓ Updated annual_sales_tracking\n`);
      }
    } else {
      console.log(`${date}: OK (${orders} orders, $${revenue.toLocaleString()})`);
    }
  }

  console.log('\n=== DONE ===');
}

function getDayOfYear(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  const daysInMonth = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  if (isLeap) daysInMonth[2] = 29;
  let dayOfYear = day;
  for (let m = 1; m < month; m++) dayOfYear += daysInMonth[m];
  return dayOfYear;
}

function getQuarter(dateStr: string): number {
  const month = new Date(dateStr).getMonth();
  if (month <= 2) return 1;
  if (month <= 5) return 2;
  if (month <= 8) return 3;
  return 4;
}

async function runShopifyQL(query: string) {
  const url = `https://${shop}/admin/api/unstable/graphql.json`;
  const graphqlQuery = {
    query: `{ shopifyqlQuery(query: "${query.replace(/"/g, '\\"')}") { tableData { columns { name } rows } parseErrors } }`,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken! },
    body: JSON.stringify(graphqlQuery),
  });
  const json = await res.json();
  return json.data?.shopifyqlQuery?.tableData;
}

fix();
