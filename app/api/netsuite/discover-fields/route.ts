/**
 * NetSuite Field Discovery API
 *
 * Queries NetSuite to discover all available customer fields including custom fields
 */

import { NextResponse } from "next/server";
import { executeSuiteQL, hasNetSuiteCredentials } from "@/lib/netsuite";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!hasNetSuiteCredentials()) {
    return NextResponse.json({ error: "Missing NetSuite credentials" }, { status: 500 });
  }

  try {
    // Get URL params for customer search
    const url = new URL(request.url);
    const customerSearch = url.searchParams.get("customer");

    // Build query - search by name if provided, otherwise get first wholesale customer
    const whereClause = customerSearch
      ? `WHERE c.isperson = 'F' AND c.id NOT IN (493, 2501) AND LOWER(c.companyname) LIKE '%${customerSearch.toLowerCase()}%'`
      : `WHERE c.isperson = 'F' AND c.id NOT IN (493, 2501)`;

    const sampleCustomer = await executeSuiteQL<Record<string, unknown>>(`
      SELECT *
      FROM customer c
      ${whereClause}
      FETCH FIRST 1 ROWS ONLY
    `);

    // Get field names from sample customer
    const availableFields = sampleCustomer.length > 0
      ? Object.keys(sampleCustomer[0]).sort()
      : [];

    // Identify custom fields (custentity_* prefix)
    const customFields = availableFields.filter(f => f.startsWith("custentity"));
    const standardFields = availableFields.filter(f => !f.startsWith("custentity"));

    return NextResponse.json({
      totalFields: availableFields.length,
      customFieldCount: customFields.length,
      standardFieldCount: standardFields.length,
      customFields,
      standardFields,
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
