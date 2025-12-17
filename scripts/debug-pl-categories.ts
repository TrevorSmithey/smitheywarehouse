/**
 * Debug P&L Categories - Find what's in "Other"
 */
import { executeSuiteQL } from "../lib/netsuite";

async function debugCategories() {
  console.log("Checking what items are falling into 'Other' category...\n");

  // Query to see item names that don't match our patterns
  const query = `
    SELECT
      BUILTIN.DF(tl.item) as item_name,
      SUM(tl.netamount) as total
    FROM transactionline tl
    JOIN transaction t ON tl.transaction = t.id
    WHERE t.posting = 'T'
    AND t.trandate >= TO_DATE('2025-06-01', 'YYYY-MM-DD')
    AND t.trandate <= TO_DATE('2025-06-30', 'YYYY-MM-DD')
    AND t.type IN ('CashSale', 'CustInvc')
    AND tl.mainline = 'F'
    AND tl.item IS NOT NULL
    AND UPPER(BUILTIN.DF(tl.item)) NOT LIKE 'SMITH-CI-%'
    AND UPPER(BUILTIN.DF(tl.item)) NOT LIKE '%-CI-%'
    AND UPPER(BUILTIN.DF(tl.item)) NOT LIKE 'SMITH-CS-%'
    AND UPPER(BUILTIN.DF(tl.item)) NOT LIKE '%-CS-%'
    AND UPPER(BUILTIN.DF(tl.item)) NOT LIKE '%GLID%'
    AND UPPER(BUILTIN.DF(tl.item)) NOT LIKE 'SMITH-AC-%'
    AND UPPER(BUILTIN.DF(tl.item)) NOT LIKE 'SMITH-ENG%'
    GROUP BY BUILTIN.DF(tl.item)
    ORDER BY SUM(tl.netamount) DESC
  `;

  const results = await executeSuiteQL<{ item_name: string; total: string }>(query);

  console.log("Items NOT matching any category pattern (June 2025):");
  console.log("=".repeat(70));

  let totalOther = 0;
  for (const row of results.slice(0, 30)) {
    const amount = parseFloat(row.total) || 0;
    totalOther += Math.abs(amount);
    const name = row.item_name || "UNKNOWN";
    console.log(name.substring(0, 45).padEnd(45), amount.toLocaleString("en-US", { style: "currency", currency: "USD" }));
  }

  console.log("=".repeat(70));
  console.log("Total 'Other' (top 30):", totalOther.toLocaleString("en-US", { style: "currency", currency: "USD" }));
  console.log("\nTotal rows in Other:", results.length);
}

debugCategories().catch(console.error);
