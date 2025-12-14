/**
 * NetSuite Field Discovery API
 *
 * Queries NetSuite to discover all available customer fields including custom fields
 */

import { NextResponse } from "next/server";
import { executeSuiteQL, hasNetSuiteCredentials } from "@/lib/netsuite";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasNetSuiteCredentials()) {
    return NextResponse.json({ error: "Missing NetSuite credentials" }, { status: 500 });
  }

  try {
    // Query CustomField table for customer entity custom fields
    const customFields = await executeSuiteQL<{
      scriptid: string;
      fieldtype: string;
      label: string;
      description: string | null;
    }>(`
      SELECT
        cf.scriptid,
        cf.fieldtype,
        cf.label,
        cf.description
      FROM CustomField cf
      WHERE cf.appliesto = 'ENTITY'
      OR cf.scriptid LIKE 'custentity%'
      ORDER BY cf.scriptid
    `);

    // Also get a sample customer with all fields to see what's available
    const sampleCustomer = await executeSuiteQL<Record<string, unknown>>(`
      SELECT *
      FROM customer c
      WHERE c.isperson = 'F'
      AND c.id NOT IN (493, 2501)
      FETCH FIRST 1 ROWS ONLY
    `);

    // Get field names from sample customer
    const availableFields = sampleCustomer.length > 0
      ? Object.keys(sampleCustomer[0]).sort()
      : [];

    return NextResponse.json({
      customFields,
      availableFields,
      sampleCustomer: sampleCustomer[0] || null,
    });
  } catch (error) {
    console.error("[NETSUITE] Field discovery error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Discovery failed" },
      { status: 500 }
    );
  }
}
