/**
 * NetSuite Version Check - Shows deployed code version
 */

import { NextResponse, NextRequest } from "next/server";
import { fetchWholesaleCustomers } from "@/lib/netsuite";
import { requireAdmin } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

// Get the actual query from the function source
const queryPreview = fetchWholesaleCustomers.toString().includes("c.balance")
  ? "OLD (has balance field)"
  : "NEW (no balance field)";

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  return NextResponse.json({
    version: "2025-12-14-v2",
    deployedAt: new Date().toISOString(),
    queryVersion: queryPreview,
    note: "If you see OLD, force redeploy is needed",
  });
}
