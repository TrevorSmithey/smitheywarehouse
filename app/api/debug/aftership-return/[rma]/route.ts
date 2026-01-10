/**
 * Debug endpoint to inspect AfterShip API response for a specific RMA
 *
 * Usage: GET /api/debug/aftership-return/PW0Y4GRR
 *
 * Compares list API response vs single-return API response
 * to diagnose why tracking_status_updated_at might be missing
 */

import { NextRequest, NextResponse } from "next/server";
import { createAftershipClient, type AftershipReturn } from "@/lib/aftership";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ rma: string }> }
) {
  try {
    const { rma } = await params;

    if (!rma) {
      return NextResponse.json({ error: "RMA number required" }, { status: 400 });
    }

    const client = createAftershipClient();
    const supabase = createServiceClient();

    // 1. Fetch via SINGLE return endpoint (what debug uses)
    const singleReturn = await client.getReturnByRma(rma);

    // 2. Fetch via LIST endpoint (what sync uses) - look for this RMA
    const { returns: listReturns } = await client.getReturns({ limit: 50 });
    const fromList = listReturns.find((r: AftershipReturn) => r.rma_number === rma);

    // 3. Get database record
    const { data: dbRecord } = await supabase
      .from("restorations")
      .select("id, rma_number, delivered_to_warehouse_at, return_tracking_status, updated_at")
      .eq("rma_number", rma)
      .maybeSingle();

    // Extract shipment keys to compare what fields each endpoint returns
    const singleShipment = singleReturn?.shipments?.[0];
    const listShipment = fromList?.shipments?.[0];

    return NextResponse.json({
      rma,
      comparison: {
        single_return_api: {
          tracking_status_updated_at: singleShipment?.tracking_status_updated_at || null,
          shipment_keys: singleShipment ? Object.keys(singleShipment) : [],
        },
        list_returns_api: {
          found_in_list: !!fromList,
          tracking_status_updated_at: listShipment?.tracking_status_updated_at || null,
          shipment_keys: listShipment ? Object.keys(listShipment) : [],
        },
        database: {
          delivered_to_warehouse_at: dbRecord?.delivered_to_warehouse_at || null,
        },
      },
      single_return_raw: singleReturn ? {
        id: singleReturn.id,
        shipments: singleReturn.shipments,
        receivings: singleReturn.receivings?.map(r => ({
          received_at: r.received_at,
          id: r.id,
        })),
      } : null,
      list_return_raw: fromList ? {
        id: fromList.id,
        shipments: fromList.shipments,
      } : null,
    });
  } catch (error) {
    console.error("[DEBUG AFTERSHIP] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
