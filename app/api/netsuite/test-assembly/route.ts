/**
 * Debug endpoint for testing Assembly Build queries
 */

import { NextResponse } from "next/server";
import { executeSuiteQL, hasNetSuiteCredentials } from "@/lib/netsuite";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasNetSuiteCredentials()) {
    return NextResponse.json({ error: "Missing NetSuite credentials" }, { status: 500 });
  }

  try {
    // Test 1: Check what transaction types exist
    const typesQuery = `
      SELECT DISTINCT t.type, COUNT(*) as cnt
      FROM transaction t
      WHERE t.trandate >= TO_DATE('2025-12-01', 'YYYY-MM-DD')
      GROUP BY t.type
      ORDER BY cnt DESC
    `;

    console.log("[DEBUG] Testing transaction types query...");
    const types = await executeSuiteQL<{ type: string; cnt: string }>(typesQuery);

    // Test 2: Try the Assembly Build query
    const assemblyQuery = `
      SELECT
        TO_CHAR(t.trandate, 'YYYY-MM-DD') as trandate,
        BUILTIN.DF(tl.item) as item_sku,
        SUM(tl.quantity) as quantity
      FROM transaction t
      JOIN transactionline tl ON tl.transaction = t.id
      WHERE t.type = 'AssyBld'
      AND tl.mainline = 'T'
      AND t.trandate >= TO_DATE('2025-12-01', 'YYYY-MM-DD')
      GROUP BY TO_CHAR(t.trandate, 'YYYY-MM-DD'), BUILTIN.DF(tl.item)
      ORDER BY trandate
    `;

    console.log("[DEBUG] Testing Assembly Build query...");
    const assemblies = await executeSuiteQL<{ trandate: string; item_sku: string; quantity: string }>(assemblyQuery);

    // Test 3: Try Work Order type instead
    const workOrderQuery = `
      SELECT
        TO_CHAR(t.trandate, 'YYYY-MM-DD') as trandate,
        BUILTIN.DF(tl.item) as item_sku,
        tl.quantity
      FROM transaction t
      JOIN transactionline tl ON tl.transaction = t.id
      WHERE t.type = 'WorkOrd'
      AND tl.mainline = 'T'
      AND t.trandate >= TO_DATE('2025-12-01', 'YYYY-MM-DD')
      ORDER BY trandate
      FETCH FIRST 10 ROWS ONLY
    `;

    console.log("[DEBUG] Testing Work Order query...");
    const workOrders = await executeSuiteQL<{ trandate: string; item_sku: string; quantity: string }>(workOrderQuery);

    // Test 4: Raw assembly query without grouping
    const rawQuery = `
      SELECT t.id, t.type, t.trandate, tl.item, tl.quantity, tl.mainline
      FROM transaction t
      JOIN transactionline tl ON tl.transaction = t.id
      WHERE t.type IN ('AssyBld', 'Build', 'Assembly')
      AND t.trandate >= TO_DATE('2025-12-01', 'YYYY-MM-DD')
      FETCH FIRST 10 ROWS ONLY
    `;

    console.log("[DEBUG] Testing raw assembly query...");
    const rawData = await executeSuiteQL(rawQuery);

    return NextResponse.json({
      success: true,
      transactionTypes: types.slice(0, 20),
      assemblyBuilds: assemblies.slice(0, 10),
      workOrders: workOrders.slice(0, 10),
      rawAssembly: rawData.slice(0, 10),
      message: `Found ${types.length} transaction types, ${assemblies.length} assembly builds, ${workOrders.length} work orders`,
    });
  } catch (error) {
    console.error("[DEBUG] Error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
