/**
 * Test NetSuite SuiteQL pagination behavior
 * Run with: npx tsx scripts/test-pagination.ts
 */

import {
  executeSuiteQL,
  hasNetSuiteCredentials,
} from "../lib/netsuite";

interface Customer {
  id: string;
  entityid: string;
  companyname: string;
}

async function main() {
  if (!hasNetSuiteCredentials()) {
    console.log("Missing NetSuite credentials");
    process.exit(1);
  }

  console.log("Testing SuiteQL pagination behavior...\n");

  // Test: Fetch 3 batches with OFFSET and compare IDs
  const batchSize = 10;
  const batches: Customer[][] = [];

  for (let i = 0; i < 3; i++) {
    const offset = i * batchSize;
    const query = `
      SELECT c.id, c.entityid, c.companyname
      FROM customer c
      WHERE c.isperson = 'F'
      AND c.id NOT IN (493, 2501)
      ORDER BY c.id
      OFFSET ${offset} ROWS FETCH NEXT ${batchSize} ROWS ONLY
    `;

    console.log(`Batch ${i + 1}: OFFSET ${offset}`);
    const result = await executeSuiteQL<Customer>(query);
    batches.push(result);

    console.log(`  IDs: ${result.map(c => c.id).join(", ")}`);
    console.log(`  First: ${result[0]?.companyname}`);
    console.log(`  Last:  ${result[result.length - 1]?.companyname}`);
    console.log();
  }

  // Check for duplicates across batches
  const allIds = batches.flatMap(b => b.map(c => c.id));
  const uniqueIds = new Set(allIds);

  console.log("--- ANALYSIS ---");
  console.log(`Total records fetched: ${allIds.length}`);
  console.log(`Unique IDs: ${uniqueIds.size}`);

  if (uniqueIds.size === allIds.length) {
    console.log("✓ PAGINATION WORKING: All IDs are unique");
  } else {
    console.log("✗ PAGINATION BROKEN: Duplicate IDs found!");
    console.log("  The same records are being returned on multiple batches.");
  }

  // Also test: What does batch 100 return? (should be empty if only 1027 customers)
  console.log("\n--- TEST: Batch beyond total count ---");
  const farQuery = `
    SELECT c.id, c.entityid, c.companyname
    FROM customer c
    WHERE c.isperson = 'F'
    AND c.id NOT IN (493, 2501)
    ORDER BY c.id
    OFFSET 2000 ROWS FETCH NEXT 10 ROWS ONLY
  `;
  console.log("Query with OFFSET 2000 (should return 0 if only 1027 customers):");
  const farResult = await executeSuiteQL<Customer>(farQuery);
  console.log(`  Returned: ${farResult.length} records`);
  if (farResult.length > 0) {
    console.log("  IDs:", farResult.map(c => c.id).join(", "));
    console.log("  ✗ PAGINATION BROKEN: Returned data when should be empty!");
  } else {
    console.log("  ✓ Correctly returned 0 records");
  }
}

main().catch(console.error);
