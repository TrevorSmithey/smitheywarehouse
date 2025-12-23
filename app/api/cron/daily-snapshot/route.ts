import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock";
import { WAREHOUSE_IDS } from "@/lib/constants";

const LOCK_NAME = "daily-snapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes

/**
 * Daily Snapshot Cron
 *
 * Runs once daily to capture operational metrics for historical analysis.
 * Populates:
 * - daily_operations_snapshot (backlog, throughput, lead times)
 * - component_inventory_history (component stock levels)
 * - lead_time_history (lead time trends by warehouse)
 *
 * Schedule: Once daily at 11 PM EST (after business day)
 */
export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  const startTime = Date.now();
  const supabase = createServiceClient();

  const lock = await acquireCronLock(supabase, LOCK_NAME);
  if (!lock.acquired) {
    console.warn(`[DAILY SNAPSHOT] Skipping - another snapshot is in progress`);
    return NextResponse.json(
      { success: false, error: "Another snapshot is in progress", skipped: true },
      { status: 409 }
    );
  }

  try {
    const today = new Date().toISOString().split("T")[0];
    console.log(`[DAILY SNAPSHOT] Starting snapshot for ${today}`);

    // Check if snapshot already exists for today
    const { data: existing } = await supabase
      .from("daily_operations_snapshot")
      .select("id")
      .eq("snapshot_date", today)
      .limit(1);

    if (existing?.length) {
      console.log(`[DAILY SNAPSHOT] Snapshot already exists for ${today}, skipping`);
      return NextResponse.json({
        success: true,
        skipped: true,
        message: `Snapshot already exists for ${today}`,
      });
    }

    // ============================================
    // 1. Calculate Backlog (unfulfilled orders)
    // ============================================
    const { data: backlogData } = await supabase
      .from("orders")
      .select(`
        id,
        line_items!inner(quantity, fulfilled_quantity)
      `)
      .or("fulfillment_status.is.null,fulfillment_status.eq.partial")
      .eq("canceled", false);

    let backlogOrders = 0;
    let backlogUnits = 0;

    if (backlogData) {
      backlogOrders = backlogData.length;
      for (const order of backlogData) {
        const items = order.line_items as Array<{ quantity: number; fulfilled_quantity: number }>;
        for (const item of items) {
          const unfulfilled = item.quantity - (item.fulfilled_quantity || 0);
          if (unfulfilled > 0) backlogUnits += unfulfilled;
        }
      }
    }

    console.log(`[DAILY SNAPSHOT] Backlog: ${backlogOrders} orders, ${backlogUnits} units`);

    // ============================================
    // 2. Orders/Units Shipped Today
    // ============================================
    const todayStart = `${today}T00:00:00Z`;
    const todayEnd = `${today}T23:59:59Z`;

    const { data: shippedData } = await supabase
      .from("shipments")
      .select("order_id")
      .gte("shipped_at", todayStart)
      .lte("shipped_at", todayEnd);

    const ordersShipped = new Set(shippedData?.map((s) => s.order_id)).size;

    // Get line items for shipped orders today
    const { data: fulfilledItems } = await supabase
      .from("line_items")
      .select("quantity, orders!inner(fulfilled_at)")
      .gte("orders.fulfilled_at", todayStart)
      .lte("orders.fulfilled_at", todayEnd);

    const unitsShipped = (fulfilledItems || []).reduce(
      (sum: number, item: { quantity: number }) => sum + item.quantity,
      0
    );

    console.log(`[DAILY SNAPSHOT] Shipped today: ${ordersShipped} orders, ${unitsShipped} units`);

    // ============================================
    // 3. Average Lead Time (orders fulfilled today)
    // ============================================
    const { data: leadTimeOrders } = await supabase
      .from("orders")
      .select("created_at, fulfilled_at")
      .gte("fulfilled_at", todayStart)
      .lte("fulfilled_at", todayEnd)
      .not("fulfilled_at", "is", null);

    let avgLeadTimeHours: number | null = null;

    if (leadTimeOrders && leadTimeOrders.length > 0) {
      const totalHours = leadTimeOrders.reduce((sum, order) => {
        const created = new Date(order.created_at).getTime();
        const fulfilled = new Date(order.fulfilled_at!).getTime();
        return sum + (fulfilled - created) / (1000 * 60 * 60);
      }, 0);
      avgLeadTimeHours = Math.round((totalHours / leadTimeOrders.length) * 100) / 100;
    }

    console.log(`[DAILY SNAPSHOT] Avg lead time: ${avgLeadTimeHours ?? "N/A"} hours`);

    // ============================================
    // 4. Assembly Completed Today
    // ============================================
    const { data: assemblyData } = await supabase
      .from("assembly_daily")
      .select("total_assembled")
      .eq("assembly_date", today)
      .single();

    const assemblyCompleted = assemblyData?.total_assembled || 0;

    console.log(`[DAILY SNAPSHOT] Assembly completed: ${assemblyCompleted} units`);

    // ============================================
    // 5. Inventory Totals
    // ============================================
    const { data: inventoryData } = await supabase
      .from("inventory")
      .select("warehouse_id, on_hand");

    let inventoryPipefitter = 0;
    let inventoryHobson = 0;
    let inventorySelery = 0;

    if (inventoryData) {
      for (const row of inventoryData) {
        if (row.warehouse_id === WAREHOUSE_IDS.pipefitter) {
          inventoryPipefitter += row.on_hand || 0;
        } else if (row.warehouse_id === WAREHOUSE_IDS.hobson) {
          inventoryHobson += row.on_hand || 0;
        } else if (row.warehouse_id === WAREHOUSE_IDS.selery) {
          inventorySelery += row.on_hand || 0;
        }
      }
    }

    const inventoryTotal = inventoryPipefitter + inventoryHobson + inventorySelery;

    console.log(`[DAILY SNAPSHOT] Inventory: ${inventoryTotal} total (PF: ${inventoryPipefitter}, H: ${inventoryHobson}, S: ${inventorySelery})`);

    // ============================================
    // 6. Stuck Shipments (no scan in 48+ hours)
    // ============================================
    const { count: stuckShipments } = await supabase
      .from("shipments")
      .select("*", { count: "exact", head: true })
      .eq("status", "in_transit")
      .gte("days_without_scan", 2);

    console.log(`[DAILY SNAPSHOT] Stuck shipments: ${stuckShipments || 0}`);

    // ============================================
    // 7. Save Operations Snapshot
    // ============================================
    const { error: opsError } = await supabase.from("daily_operations_snapshot").insert({
      snapshot_date: today,
      backlog_orders: backlogOrders,
      backlog_units: backlogUnits,
      orders_shipped: ordersShipped,
      units_shipped: unitsShipped,
      avg_lead_time_hours: avgLeadTimeHours,
      assembly_completed: assemblyCompleted,
      inventory_total: inventoryTotal,
      inventory_pipefitter: inventoryPipefitter,
      inventory_hobson: inventoryHobson,
      inventory_selery: inventorySelery,
      stuck_shipments: stuckShipments || 0,
    });

    if (opsError) {
      console.error(`[DAILY SNAPSHOT] Error saving operations snapshot:`, opsError);
    } else {
      console.log(`[DAILY SNAPSHOT] Saved operations snapshot`);
    }

    // ============================================
    // 8. Component Inventory History
    // ============================================
    // Get all component SKUs from bill_of_materials
    const { data: bomComponents } = await supabase
      .from("bill_of_materials")
      .select("component_sku")
      .order("component_sku");

    const componentSkus = [...new Set(bomComponents?.map((b) => b.component_sku) || [])];

    if (componentSkus.length > 0) {
      // Get current inventory for these components (sum across warehouses)
      const { data: componentInventory } = await supabase
        .from("inventory")
        .select("sku, on_hand")
        .in("sku", componentSkus);

      // Aggregate by SKU
      const inventoryByComponent = new Map<string, number>();
      for (const row of componentInventory || []) {
        const current = inventoryByComponent.get(row.sku) || 0;
        inventoryByComponent.set(row.sku, current + (row.on_hand || 0));
      }

      // Get on-order quantities
      const { data: onOrderData } = await supabase
        .from("component_orders")
        .select("component_sku, quantity_ordered, quantity_received")
        .in("status", ["ordered", "in_transit", "partial"]);

      const onOrderByComponent = new Map<string, number>();
      for (const row of onOrderData || []) {
        const remaining = row.quantity_ordered - (row.quantity_received || 0);
        const current = onOrderByComponent.get(row.component_sku) || 0;
        onOrderByComponent.set(row.component_sku, current + remaining);
      }

      // Create history records
      const componentHistoryRecords = componentSkus.map((sku) => ({
        snapshot_date: today,
        component_sku: sku,
        on_hand: inventoryByComponent.get(sku) || 0,
        on_order: onOrderByComponent.get(sku) || 0,
        days_of_supply: null, // Could compute later based on consumption
      }));

      const { error: compError } = await supabase
        .from("component_inventory_history")
        .upsert(componentHistoryRecords, { onConflict: "snapshot_date,component_sku" });

      if (compError) {
        console.error(`[DAILY SNAPSHOT] Error saving component history:`, compError);
      } else {
        console.log(`[DAILY SNAPSHOT] Saved ${componentHistoryRecords.length} component inventory records`);
      }
    }

    // ============================================
    // 9. Lead Time History (by warehouse)
    // ============================================
    // Calculate lead times for orders fulfilled in the last 7 days (more data = better stats)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: recentOrders } = await supabase
      .from("orders")
      .select("created_at, fulfilled_at, warehouse")
      .gte("fulfilled_at", sevenDaysAgo)
      .not("fulfilled_at", "is", null);

    if (recentOrders && recentOrders.length > 0) {
      // Calculate lead times
      const leadTimes = recentOrders.map((order) => {
        const created = new Date(order.created_at).getTime();
        const fulfilled = new Date(order.fulfilled_at!).getTime();
        return {
          hours: (fulfilled - created) / (1000 * 60 * 60),
          warehouse: order.warehouse || "unknown",
        };
      });

      // Group by warehouse + overall
      const byWarehouse: Record<string, number[]> = { __all__: [] };
      for (const lt of leadTimes) {
        byWarehouse.__all__.push(lt.hours);
        if (!byWarehouse[lt.warehouse]) byWarehouse[lt.warehouse] = [];
        byWarehouse[lt.warehouse].push(lt.hours);
      }

      // Calculate stats for each group
      const leadTimeRecords: Array<{
        snapshot_date: string;
        warehouse: string | null;
        avg_lead_time_hours: number;
        p50_lead_time_hours: number;
        p90_lead_time_hours: number;
        orders_measured: number;
      }> = [];

      for (const [warehouse, times] of Object.entries(byWarehouse)) {
        if (times.length === 0) continue;

        const sorted = [...times].sort((a, b) => a - b);
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        const p50 = sorted[Math.floor(sorted.length * 0.5)];
        const p90 = sorted[Math.floor(sorted.length * 0.9)];

        leadTimeRecords.push({
          snapshot_date: today,
          warehouse: warehouse === "__all__" ? null : warehouse,
          avg_lead_time_hours: Math.round(avg * 100) / 100,
          p50_lead_time_hours: Math.round(p50 * 100) / 100,
          p90_lead_time_hours: Math.round(p90 * 100) / 100,
          orders_measured: times.length,
        });
      }

      // Delete existing records for today, then insert fresh
      // (COALESCE unique index doesn't work with standard upsert)
      await supabase
        .from("lead_time_history")
        .delete()
        .eq("snapshot_date", today);

      const { error: ltError } = await supabase
        .from("lead_time_history")
        .insert(leadTimeRecords);

      if (ltError) {
        console.error(`[DAILY SNAPSHOT] Error saving lead time history:`, ltError);
      } else {
        console.log(`[DAILY SNAPSHOT] Saved ${leadTimeRecords.length} lead time records`);
      }
    }

    // ============================================
    // 10. Log sync result
    // ============================================
    const elapsed = Date.now() - startTime;

    await supabase.from("sync_logs").insert({
      sync_type: "daily-snapshot",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      status: "success",
      records_synced: 1,
      details: {
        backlog_orders: backlogOrders,
        backlog_units: backlogUnits,
        orders_shipped: ordersShipped,
        units_shipped: unitsShipped,
        avg_lead_time_hours: avgLeadTimeHours,
        assembly_completed: assemblyCompleted,
        inventory_total: inventoryTotal,
        component_skus_tracked: componentSkus.length,
      },
      duration_ms: elapsed,
    });

    const elapsedSec = (elapsed / 1000).toFixed(1);
    console.log(`[DAILY SNAPSHOT] Complete in ${elapsedSec}s`);

    return NextResponse.json({
      success: true,
      snapshot_date: today,
      elapsed: `${elapsedSec}s`,
      metrics: {
        backlog_orders: backlogOrders,
        backlog_units: backlogUnits,
        orders_shipped: ordersShipped,
        units_shipped: unitsShipped,
        avg_lead_time_hours: avgLeadTimeHours,
        assembly_completed: assemblyCompleted,
        inventory_total: inventoryTotal,
        stuck_shipments: stuckShipments || 0,
        component_skus_tracked: componentSkus.length,
      },
    });
  } catch (error) {
    console.error("[DAILY SNAPSHOT] Failed:", error);

    const elapsed = Date.now() - startTime;
    await supabase.from("sync_logs").insert({
      sync_type: "daily-snapshot",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      status: "failed",
      error_message: error instanceof Error ? error.message : "Unknown error",
      duration_ms: elapsed,
    });

    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Snapshot failed" },
      { status: 500 }
    );
  } finally {
    await releaseCronLock(supabase, LOCK_NAME);
  }
}
