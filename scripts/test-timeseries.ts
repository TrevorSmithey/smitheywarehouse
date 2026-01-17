/* eslint-disable @typescript-eslint/no-explicit-any */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const shop = process.env.SHOPIFY_STORE_URL;
const accessToken = process.env.SHOPIFY_ADMIN_TOKEN;

async function test() {
  console.log('=== TESTING TIMESERIES vs NON-TIMESERIES ===\n');

  // WITHOUT TIMESERIES (what I tested above - returns correct $1.32M)
  console.log('--- WITHOUT TIMESERIES ---');
  const q1 = `FROM sales SHOW total_sales, orders SINCE 2025-11-28 UNTIL 2025-11-28`;
  console.log('Query:', q1);
  const r1 = await runShopifyQL(q1);
  console.log('Result:', r1?.rows?.[0]);

  // WITH TIMESERIES (what cron uses)
  console.log('\n--- WITH TIMESERIES (like cron) ---');
  const q2 = `FROM sales SHOW total_sales, orders SINCE 2025-11-28 UNTIL 2025-11-28 TIMESERIES day ORDER BY day`;
  console.log('Query:', q2);
  const r2 = await runShopifyQL(q2);
  console.log('Result:', r2?.rows?.[0]);

  // Test with the exact cron query format for a range including Nov 28
  console.log('\n--- EXACT CRON QUERY FORMAT (range) ---');
  const q3 = `FROM sales SHOW total_sales, orders SINCE 2025-11-25 UNTIL 2025-11-30 TIMESERIES day ORDER BY day`;
  console.log('Query:', q3);
  const r3 = await runShopifyQL(q3);
  console.log('All rows:');
  r3?.rows?.forEach((row: any) => {
    console.log(`  ${row.day}: orders=${row.orders}, total_sales=${row.total_sales}`);
  });
}

async function runShopifyQL(query: string) {
  const url = `https://${shop}/admin/api/unstable/graphql.json`;

  const graphqlQuery = {
    query: `
      {
        shopifyqlQuery(query: "${query.replace(/"/g, '\\"')}") {
          tableData {
            columns { name dataType }
            rows
          }
          parseErrors
        }
      }
    `,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken!,
    },
    body: JSON.stringify(graphqlQuery),
  });

  const json = await res.json();
  return json.data?.shopifyqlQuery?.tableData;
}

test();
