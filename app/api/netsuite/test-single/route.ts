/**
 * NetSuite Single Query Test - Test one query at a time
 * Use ?test=1,2,3,4,5 to run specific test
 */

import { NextResponse } from "next/server";
import { executeSuiteQL, hasNetSuiteCredentials } from "@/lib/netsuite";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!hasNetSuiteCredentials()) {
    return NextResponse.json({ error: "Missing NetSuite credentials" }, { status: 500 });
  }

  const url = new URL(request.url);
  const testNum = url.searchParams.get("test") || "1";

  const queries: Record<string, { name: string; query: string }> = {
    "1": { name: "SELECT 1", query: "SELECT 1" },
    "2": { name: "10 customers simple", query: `
      SELECT id, entityid, companyname
      FROM customer
      WHERE isperson = 'F' AND id NOT IN (493, 2501)
      ORDER BY id FETCH FIRST 10 ROWS ONLY
    `},
    "3": { name: "50 customers no DF", query: `
      SELECT c.id, c.entityid, c.companyname, c.email, c.phone
      FROM customer c
      WHERE c.isperson = 'F' AND c.id NOT IN (493, 2501)
      ORDER BY c.id FETCH FIRST 50 ROWS ONLY
    `},
    "4": { name: "100 customers no DF", query: `
      SELECT c.id, c.entityid, c.companyname, c.email, c.phone
      FROM customer c
      WHERE c.isperson = 'F' AND c.id NOT IN (493, 2501)
      ORDER BY c.id FETCH FIRST 100 ROWS ONLY
    `},
    "5": { name: "50 customers full fields", query: `
      SELECT
        c.id, c.entityid, c.companyname, c.email, c.phone, c.altphone, c.fax, c.url,
        c.datecreated, c.lastmodifieddate, c.firstsaledate, c.lastsaledate,
        c.firstorderdate, c.lastorderdate, c.isinactive, c.parent,
        c.terms, c.category, c.entitystatus, c.salesrep, c.territory, c.currency,
        c.creditlimit, c.balance, c.overduebalance, c.consolbalance,
        c.unbilledorders, c.depositbalance, c.billaddress, c.shipaddress,
        c.defaultbillingaddress, c.defaultshippingaddress
      FROM customer c
      WHERE c.isperson = 'F' AND c.id NOT IN (493, 2501)
      ORDER BY c.id FETCH FIRST 50 ROWS ONLY
    `},
  };

  const test = queries[testNum];
  if (!test) {
    return NextResponse.json({ error: "Invalid test number. Use 1-5", available: Object.keys(queries) });
  }

  const start = Date.now();
  try {
    const data = await executeSuiteQL(test.query);
    return NextResponse.json({
      test: testNum,
      name: test.name,
      status: "success",
      time: Date.now() - start,
      count: data.length,
    });
  } catch (e) {
    return NextResponse.json({
      test: testNum,
      name: test.name,
      status: "failed",
      time: Date.now() - start,
      error: (e as Error).message,
    });
  }
}
