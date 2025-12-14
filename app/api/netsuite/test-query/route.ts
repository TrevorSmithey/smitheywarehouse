/**
 * NetSuite Query Test - Debug endpoint
 */

import { NextResponse } from "next/server";
import { executeSuiteQL, hasNetSuiteCredentials } from "@/lib/netsuite";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  if (!hasNetSuiteCredentials()) {
    return NextResponse.json({ error: "Missing NetSuite credentials" }, { status: 500 });
  }

  const results: { query: string; status: string; time: number; count?: number; error?: string }[] = [];

  // Test 1: Simple SELECT 1
  const start1 = Date.now();
  try {
    const data = await executeSuiteQL("SELECT 1");
    results.push({ query: "SELECT 1", status: "success", time: Date.now() - start1, count: data.length });
  } catch (e) {
    results.push({ query: "SELECT 1", status: "failed", time: Date.now() - start1, error: (e as Error).message });
  }

  // Test 2: Simple customer query (10 rows)
  const start2 = Date.now();
  try {
    const data = await executeSuiteQL(`
      SELECT id, entityid, companyname
      FROM customer
      WHERE isperson = 'F' AND id NOT IN (493, 2501)
      ORDER BY id FETCH FIRST 10 ROWS ONLY
    `);
    results.push({ query: "10 customers (simple)", status: "success", time: Date.now() - start2, count: data.length });
  } catch (e) {
    results.push({ query: "10 customers (simple)", status: "failed", time: Date.now() - start2, error: (e as Error).message });
  }

  // Test 3: Customer query with BUILTIN.DF (10 rows)
  const start3 = Date.now();
  try {
    const data = await executeSuiteQL(`
      SELECT id, entityid, companyname, BUILTIN.DF(terms) as terms, BUILTIN.DF(category) as category
      FROM customer
      WHERE isperson = 'F' AND id NOT IN (493, 2501)
      ORDER BY id FETCH FIRST 10 ROWS ONLY
    `);
    results.push({ query: "10 customers (with DF)", status: "success", time: Date.now() - start3, count: data.length });
  } catch (e) {
    results.push({ query: "10 customers (with DF)", status: "failed", time: Date.now() - start3, error: (e as Error).message });
  }

  // Test 4: Simplified customer query (50 rows, no BUILTIN.DF)
  const start4 = Date.now();
  try {
    const data = await executeSuiteQL(`
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
      ORDER BY c.id
      FETCH FIRST 50 ROWS ONLY
    `);
    results.push({ query: "50 customers (no DF)", status: "success", time: Date.now() - start4, count: data.length });
  } catch (e) {
    results.push({ query: "50 customers (no DF)", status: "failed", time: Date.now() - start4, error: (e as Error).message });
  }

  // Test 5: 200 customers (the actual batch size)
  const start5 = Date.now();
  try {
    const data = await executeSuiteQL(`
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
      ORDER BY c.id
      FETCH FIRST 200 ROWS ONLY
    `);
    results.push({ query: "200 customers (batch size)", status: "success", time: Date.now() - start5, count: data.length });
  } catch (e) {
    results.push({ query: "200 customers (batch size)", status: "failed", time: Date.now() - start5, error: (e as Error).message });
  }

  return NextResponse.json({
    message: "NetSuite Query Tests",
    results,
    totalTime: results.reduce((sum, r) => sum + r.time, 0),
  });
}
