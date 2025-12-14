/**
 * NetSuite Version Check - Shows deployed code version
 */

import { NextResponse } from "next/server";
import { fetchWholesaleCustomers } from "@/lib/netsuite";

export const dynamic = "force-dynamic";

// Get the actual query from the function source
const queryPreview = fetchWholesaleCustomers.toString().includes("c.balance")
  ? "OLD (has balance field)"
  : "NEW (no balance field)";

export async function GET() {
  return NextResponse.json({
    version: "2025-12-14-v2",
    deployedAt: new Date().toISOString(),
    queryVersion: queryPreview,
    note: "If you see OLD, force redeploy is needed",
  });
}
