/**
 * Diagnostic script to analyze NetSuite customer data
 * Run with: npx tsx scripts/analyze-customers.ts
 */

import {
  executeSuiteQL,
  hasNetSuiteCredentials,
} from "../lib/netsuite";

interface CountResult {
  total?: string;
  count?: string;
}

interface CustomerSample {
  id: string;
  entityid: string;
  companyname: string;
  category: string | null;
  entitystatus: string | null;
  isinactive: string;
  firstsaledate: string | null;
  lastsaledate: string | null;
}

interface CategoryBreakdown {
  category: string | null;
  count: string;
}

interface StatusBreakdown {
  entitystatus: string | null;
  count: string;
}

async function main() {
  if (!hasNetSuiteCredentials()) {
    console.log("Missing NetSuite credentials");
    process.exit(1);
  }

  console.log("Analyzing NetSuite customer data...\n");

  // Query 1: Count all business customers (isperson='F')
  const countQuery = `
    SELECT COUNT(*) as total
    FROM customer c
    WHERE c.isperson = 'F'
    AND c.id NOT IN (493, 2501)
  `;

  console.log("1. Total business customers (isperson='F'):");
  const countResult = await executeSuiteQL<CountResult>(countQuery);
  console.log("   Total:", countResult[0]?.total || "unknown");

  // Query 2: Sample first 20 customers - look at their data
  console.log("\n2. Sample of first 20 customers:");
  const sampleQuery = `
    SELECT c.id, c.entityid, c.companyname, c.category, c.entitystatus, c.isinactive, c.firstsaledate, c.lastsaledate
    FROM customer c
    WHERE c.isperson = 'F'
    AND c.id NOT IN (493, 2501)
    ORDER BY c.id
    FETCH FIRST 20 ROWS ONLY
  `;
  const sampleResult = await executeSuiteQL<CustomerSample>(sampleQuery);
  sampleResult.forEach((c) => {
    console.log(`   ${c.id}: ${c.companyname} | cat: ${c.category} | status: ${c.entitystatus} | inactive: ${c.isinactive} | last sale: ${c.lastsaledate}`);
  });

  // Query 3: Count by category
  console.log("\n3. Breakdown by category:");
  const categoryQuery = `
    SELECT c.category, COUNT(*) as count
    FROM customer c
    WHERE c.isperson = 'F'
    AND c.id NOT IN (493, 2501)
    GROUP BY c.category
    ORDER BY COUNT(*) DESC
    FETCH FIRST 20 ROWS ONLY
  `;
  const categoryResult = await executeSuiteQL<CategoryBreakdown>(categoryQuery);
  categoryResult.forEach((r) => console.log(`   category "${r.category}": ${r.count}`));

  // Query 4: Count by entitystatus
  console.log("\n4. Breakdown by entity status:");
  const statusQuery = `
    SELECT c.entitystatus, COUNT(*) as count
    FROM customer c
    WHERE c.isperson = 'F'
    AND c.id NOT IN (493, 2501)
    GROUP BY c.entitystatus
    ORDER BY COUNT(*) DESC
    FETCH FIRST 20 ROWS ONLY
  `;
  const statusResult = await executeSuiteQL<StatusBreakdown>(statusQuery);
  statusResult.forEach((r) => console.log(`   status "${r.entitystatus}": ${r.count}`));

  // Query 5: Count customers WITH sales activity
  console.log("\n5. Customers with sales activity:");
  const activeQuery = `
    SELECT COUNT(*) as count
    FROM customer c
    WHERE c.isperson = 'F'
    AND c.id NOT IN (493, 2501)
    AND c.lastsaledate IS NOT NULL
  `;
  const activeResult = await executeSuiteQL<CountResult>(activeQuery);
  console.log("   Customers with lastsaledate:", activeResult[0]?.count || "unknown");

  // Query 6: Count customers who appear in wholesale transactions
  console.log("\n6. Customers with actual wholesale transactions (CashSale/CustInvc):");
  const transCustomersQuery = `
    SELECT COUNT(DISTINCT t.entity) as count
    FROM transaction t
    JOIN customer c ON t.entity = c.id
    WHERE c.isperson = 'F'
    AND c.id NOT IN (493, 2501)
    AND t.type IN ('CashSale', 'CustInvc')
  `;
  const transCustomersResult = await executeSuiteQL<CountResult>(transCustomersQuery);
  console.log("   Distinct customers with transactions:", transCustomersResult[0]?.count || "unknown");

  // Query 7: Count by isinactive status
  console.log("\n7. Active vs Inactive customers:");
  const inactiveQuery = `
    SELECT c.isinactive, COUNT(*) as count
    FROM customer c
    WHERE c.isperson = 'F'
    AND c.id NOT IN (493, 2501)
    GROUP BY c.isinactive
  `;
  const inactiveResult = await executeSuiteQL<{isinactive: string; count: string}>(inactiveQuery);
  inactiveResult.forEach((r) => console.log(`   isinactive="${r.isinactive}": ${r.count}`));
}

main().catch(console.error);
