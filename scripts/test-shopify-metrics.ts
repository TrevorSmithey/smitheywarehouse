/* eslint-disable @typescript-eslint/no-explicit-any */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const shop = process.env.SHOPIFY_STORE_URL;
const accessToken = process.env.SHOPIFY_ADMIN_TOKEN;

async function testMetrics() {
  console.log('=== TESTING SHOPIFYQL METRICS FOR BLACK FRIDAY ===\n');

  // Query multiple metrics to compare
  const queries = [
    {
      name: 'Current query (total_sales)',
      query: `FROM sales SHOW total_sales, orders SINCE 2025-11-28 UNTIL 2025-11-28`,
    },
    {
      name: 'Gross sales',
      query: `FROM sales SHOW gross_sales, orders SINCE 2025-11-28 UNTIL 2025-11-28`,
    },
    {
      name: 'Net sales',
      query: `FROM sales SHOW net_sales, orders SINCE 2025-11-28 UNTIL 2025-11-28`,
    },
    {
      name: 'All metrics together',
      query: `FROM sales SHOW gross_sales, net_sales, total_sales, orders, discounts, returns SINCE 2025-11-28 UNTIL 2025-11-28`,
    },
    {
      name: 'By Sales Channel',
      query: `FROM sales SHOW total_sales, orders BY channel SINCE 2025-11-28 UNTIL 2025-11-28`,
    },
  ];

  for (const q of queries) {
    console.log(`\n--- ${q.name} ---`);
    console.log(`Query: ${q.query}`);
    try {
      const result = await runShopifyQL(q.query);
      if (result?.rows) {
        console.log('Columns:', result.columns?.map((c: any) => c.name).join(', '));
        result.rows.forEach((row: any, i: number) => {
          console.log(`Row ${i}:`, row);
        });
      } else {
        console.log('No rows returned');
      }
    } catch (err) {
      console.log('Error:', err instanceof Error ? err.message : err);
    }
  }
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

  if (json.errors) {
    throw new Error(json.errors.map((e: any) => e.message).join(', '));
  }

  const parseErrors = json.data?.shopifyqlQuery?.parseErrors;
  if (parseErrors && parseErrors.length > 0) {
    throw new Error(`Parse errors: ${parseErrors}`);
  }

  return json.data?.shopifyqlQuery?.tableData;
}

testMetrics();
