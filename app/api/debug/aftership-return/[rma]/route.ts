/**
 * Debug endpoint to inspect AfterShip API response for a specific RMA
 *
 * Usage: GET /api/debug/aftership-return/PW0Y4GRR
 */

import { NextRequest, NextResponse } from "next/server";
import { createAftershipClient } from "@/lib/aftership";
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

    // Fetch from AfterShip API
    const aftershipReturn = await client.getReturnByRma(rma);

    if (!aftershipReturn) {
      return NextResponse.json({ error: "Return not found in AfterShip" }, { status: 404 });
    }

    // Get database record
    const { data: dbRecord } = await supabase
      .from("restorations")
      .select("id, rma_number, delivered_to_warehouse_at, return_tracking_status, updated_at")
      .eq("rma_number", rma)
      .maybeSingle();

    const primaryShipment = aftershipReturn.shipments?.[0];

    return NextResponse.json({
      rma,
      aftership: {
        id: aftershipReturn.id,
        order_number: aftershipReturn.order?.order_number,
        tracking_number: primaryShipment?.tracking_number,
        tracking_status: primaryShipment?.tracking_status,
        tracking_status_updated_at: primaryShipment?.tracking_status_updated_at,
        shipment_created_at: primaryShipment?.created_at,
        receivings: aftershipReturn.receivings?.map(r => ({
          received_at: r.received_at,
          id: r.id,
        })),
      },
      database: dbRecord ? {
        id: dbRecord.id,
        delivered_to_warehouse_at: dbRecord.delivered_to_warehouse_at,
        return_tracking_status: dbRecord.return_tracking_status,
        updated_at: dbRecord.updated_at,
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
