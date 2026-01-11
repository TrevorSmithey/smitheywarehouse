/**
 * Test ID-based cursor pagination
 * Run with: npx tsx scripts/test-cursor-pagination.ts
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

  console.log("Testing ID-based cursor pagination...\n");

  const batchSize = 10;
  let lastId = 0;
  const batches: Customer[][] = [];

  for (let i = 0; i < 3; i++) {
    // ID-based pagination: WHERE id > lastId
    const query = `
      SELECT c.id, c.entityid, c.companyname
      FROM customer c
      WHERE c.isperson = 'F'
      AND c.id NOT IN (493, 2501)
      AND c.id > ${lastId}
      ORDER BY c.id
      FETCH FIRST ${batchSize} ROWS ONLY
    `;

    console.log(`Batch ${i + 1}: WHERE id > ${lastId}`);
    const result = await executeSuiteQL<Customer>(query);
    batches.push(result);

    if (result.length === 0) {
      console.log("  No more records");
      break;
    }

    // Get max ID from this batch for next iteration
    lastId = Math.max(...result.map(c => Number(c.id)));

    console.log(`  IDs: ${result.map(c => c.id).join(", ")}`);
    console.log(`  First: ${result[0]?.companyname}`);
    console.log(`  Last:  ${result[result.length - 1]?.companyname}`);
    console.log(`  Next cursor: id > ${lastId}`);
    console.log();
  }

  // Check for duplicates across batches
  const allIds = batches.flatMap(b => b.map(c => c.id));
  const uniqueIds = new Set(allIds);

  console.log("--- ANALYSIS ---");
  console.log(`Total records fetched: ${allIds.length}`);
  console.log(`Unique IDs: ${uniqueIds.size}`);

  if (uniqueIds.size === allIds.length) {
    console.log("✓ CURSOR PAGINATION WORKING: All IDs are unique");
  } else {
    console.log("✗ STILL BROKEN: Duplicate IDs found!");
  }

  // Verify ordering is correct (each batch should have higher IDs)
  const allIdsArray = Array.from(uniqueIds).map(Number).sort((a, b) => a - b);
  const fetchedIdsArray = allIds.map(Number);
  const isOrdered = fetchedIdsArray.every((id, i) => i === 0 || id > fetchedIdsArray[i - 1]);

  if (isOrdered) {
    console.log("✓ IDs are in correct ascending order");
  } else {
    console.log("✗ IDs are NOT in correct order");
  }
}

main().catch(console.error);
