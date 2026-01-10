/**
 * Customer Detail API
 * GET: Returns detailed customer data for the customer detail view
 * PATCH: Updates customer status flags (is_manually_churned, is_corporate_gifting)
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth/server";
import type {
  CustomerDetailResponse,
  CustomerOrderingPattern,
  CustomerRevenueTrend,
  CustomerProductMix,
  CustomerOrderHistory,
  WholesaleCustomer,
  CustomerSegment,
  CustomerHealthStatus,
} from "@/lib/types";
import { checkRateLimit, rateLimitedResponse, RATE_LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Helper to determine customer segment based on revenue
function getCustomerSegment(totalRevenue: number): CustomerSegment {
  if (totalRevenue >= 50000) return "major";
  if (totalRevenue >= 20000) return "large";
  if (totalRevenue >= 10000) return "mid";
  if (totalRevenue >= 5000) return "small";
  if (totalRevenue >= 2000) return "starter";
  return "minimal";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Auth check - requires admin session
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

  const { id } = await params;

  // Rate limiting
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  const rateLimitResult = checkRateLimit(`customer-detail:${ip}`, RATE_LIMITS.API);
  if (!rateLimitResult.success) {
    return rateLimitedResponse(rateLimitResult);
  }

  try {
    const supabase = createServiceClient();
    const customerId = parseInt(id, 10);

    if (isNaN(customerId)) {
      return NextResponse.json(
        { error: "Invalid customer ID" },
        { status: 400 }
      );
    }

    // Fetch customer data
    const { data: customerData, error: customerError } = await supabase
      .from("ns_wholesale_customers")
      .select("*")
      .eq("ns_customer_id", customerId)
      .single();

    if (customerError || !customerData) {
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 404 }
      );
    }

    // Get order intervals using single-customer RPC (DB-filtered, returns 1 row not 748)
    const { data: intervalData } = await supabase.rpc(
      "get_single_customer_order_intervals",
      { target_customer_id: customerId }
    );

    // First row is the customer's data (or null if < 2 orders)
    const customerIntervalData = intervalData?.[0] || null;

    // Compute ordering pattern
    const now = new Date();
    const lastSaleDate = customerData.last_sale_date
      ? new Date(customerData.last_sale_date)
      : null;
    const firstSaleDate = customerData.first_sale_date
      ? new Date(customerData.first_sale_date)
      : null;

    const daysSinceLastOrder = lastSaleDate
      ? Math.floor((now.getTime() - lastSaleDate.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    const customerTenureYears = firstSaleDate
      ? Math.round((now.getTime() - firstSaleDate.getTime()) / (1000 * 60 * 60 * 24 * 365) * 10) / 10
      : null;

    // Get interval stats from RPC result
    // Median = user-facing "typical interval"
    // P75 = internal threshold for overdue detection (more conservative than median)
    const avgOrderIntervalDays: number | null = customerIntervalData?.median_interval
      ? Math.round(parseFloat(customerIntervalData.median_interval))
      : null;
    const intervalRangeHigh: number | null = customerIntervalData?.p75_interval
      ? Math.round(parseFloat(customerIntervalData.p75_interval))
      : null;

    // Calculate overdue ratio and expected order date
    // Use p75 (75th percentile) for expected order window - more realistic than median
    let overdueRatio: number | null = null;
    let expectedOrderDate: string | null = null;

    const referenceInterval = intervalRangeHigh || avgOrderIntervalDays;
    if (referenceInterval && referenceInterval > 0 && lastSaleDate) {
      const expectedDate = new Date(lastSaleDate);
      expectedDate.setDate(expectedDate.getDate() + referenceInterval);
      expectedOrderDate = expectedDate.toISOString().split("T")[0];

      if (daysSinceLastOrder !== null) {
        overdueRatio = Math.round((daysSinceLastOrder / referenceInterval) * 10) / 10;
      }
    }

    const orderingPattern: CustomerOrderingPattern = {
      avg_order_interval_days: avgOrderIntervalDays,
      interval_range_high: intervalRangeHigh, // P75 used internally for overdue detection
      days_since_last_order: daysSinceLastOrder,
      last_order_date: customerData.last_sale_date,
      first_order_date: customerData.first_sale_date,
      customer_tenure_years: customerTenureYears,
      overdue_ratio: overdueRatio,
      expected_order_date: expectedOrderDate,
    };

    // Get T12 revenue (trailing 12 months) and prior T12 (13-24 months ago)
    // This is always current regardless of where we are in the calendar year
    const t12StartDate = new Date(now);
    t12StartDate.setFullYear(t12StartDate.getFullYear() - 1);
    const t12StartStr = t12StartDate.toISOString().split("T")[0];

    const priorT12StartDate = new Date(now);
    priorT12StartDate.setFullYear(priorT12StartDate.getFullYear() - 2);
    const priorT12StartStr = priorT12StartDate.toISOString().split("T")[0];
    const priorT12EndStr = t12StartStr; // Prior T12 ends where current T12 starts

    const { data: t12Transactions } = await supabase
      .from("ns_wholesale_transactions")
      .select("tran_date, foreign_total")
      .eq("ns_customer_id", customerId)
      .gte("tran_date", t12StartStr)
      .lte("tran_date", now.toISOString().split("T")[0]);

    const { data: priorT12Transactions } = await supabase
      .from("ns_wholesale_transactions")
      .select("tran_date, foreign_total")
      .eq("ns_customer_id", customerId)
      .gte("tran_date", priorT12StartStr)
      .lt("tran_date", priorT12EndStr);

    const t12Revenue = (t12Transactions || []).reduce(
      (sum, t) => sum + (t.foreign_total || 0),
      0
    );
    const priorT12Revenue = (priorT12Transactions || []).reduce(
      (sum, t) => sum + (t.foreign_total || 0),
      0
    );

    const yoyChangePct = priorT12Revenue > 0
      ? Math.round(((t12Revenue - priorT12Revenue) / priorT12Revenue) * 100)
      : null;

    const orderCount = customerData.lifetime_orders || 0;
    const totalRevenue = parseFloat(customerData.lifetime_revenue) || 0;
    const avgOrderValue = orderCount > 0 ? Math.round(totalRevenue / orderCount) : null;

    const revenueTrend: CustomerRevenueTrend = {
      t12_revenue: t12Revenue,
      prior_t12_revenue: priorT12Revenue,
      yoy_change_pct: yoyChangePct,
      avg_order_value: avgOrderValue,
      total_revenue: totalRevenue,
      order_count: orderCount,
    };

    // Get product mix (top SKUs purchased)
    // NOTE: NetSuite stores quantities as NEGATIVE for sales (inventory out)
    // Filter to 'Assembly' items which are actual products with prices
    // InvtPart items are components with NULL amounts
    const { data: productMixData } = await supabase
      .from("ns_wholesale_line_items")
      .select(`
        sku,
        item_type,
        quantity,
        net_amount,
        ns_wholesale_transactions!inner(ns_customer_id, tran_date)
      `)
      .eq("ns_wholesale_transactions.ns_customer_id", customerId)
      .eq("item_type", "Assembly")
      .not("sku", "is", null)
      .not("net_amount", "is", null);

    // Aggregate by SKU
    const skuMap = new Map<string, {
      sku: string;
      item_type: string | null;
      total_units: number;
      total_revenue: number;
      last_purchased: string | null;
    }>();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (productMixData || []).forEach((item: any) => {
      const existing = skuMap.get(item.sku);
      // ns_wholesale_transactions is returned as array from join - get first element's tran_date
      const tranDate = Array.isArray(item.ns_wholesale_transactions)
        ? item.ns_wholesale_transactions[0]?.tran_date
        : item.ns_wholesale_transactions?.tran_date;

      // Use Math.abs() because NetSuite stores sold quantities as negative
      const quantity = Math.abs(item.quantity || 0);
      const revenue = Math.abs(parseFloat(item.net_amount) || 0);

      if (existing) {
        existing.total_units += quantity;
        existing.total_revenue += revenue;
        if (tranDate && (!existing.last_purchased || tranDate > existing.last_purchased)) {
          existing.last_purchased = tranDate;
        }
      } else {
        skuMap.set(item.sku, {
          sku: item.sku,
          item_type: item.item_type,
          total_units: quantity,
          total_revenue: revenue,
          last_purchased: tranDate || null,
        });
      }
    });

    // Sort by revenue and take top 20
    const productMix: CustomerProductMix[] = Array.from(skuMap.values())
      .sort((a, b) => b.total_revenue - a.total_revenue)
      .slice(0, 20);

    // Get order history (recent 20 orders)
    const { data: orderHistoryData } = await supabase
      .from("ns_wholesale_transactions")
      .select("ns_transaction_id, tran_id, tran_date, foreign_total, status")
      .eq("ns_customer_id", customerId)
      .order("tran_date", { ascending: false })
      .limit(20);

    const orderHistory: CustomerOrderHistory[] = (orderHistoryData || []).map((t) => ({
      ns_transaction_id: t.ns_transaction_id,
      tran_id: t.tran_id,
      tran_date: t.tran_date,
      foreign_total: t.foreign_total || 0,
      status: t.status,
    }));

    // Use DB-computed health_status for consistency with wholesale dashboard
    // The compute_customer_metrics() RPC computes this correctly
    const healthStatus = (customerData.health_status as CustomerHealthStatus) || "churned";

    const segment = getCustomerSegment(totalRevenue);

    const customer: WholesaleCustomer = {
      ns_customer_id: customerData.ns_customer_id,
      entity_id: customerData.entity_id || "",
      company_name: customerData.company_name || "Unknown",
      email: customerData.email,
      phone: customerData.phone,
      first_sale_date: customerData.first_sale_date,
      last_sale_date: customerData.last_sale_date,
      total_revenue: totalRevenue,
      ytd_revenue: t12Revenue, // Using T12 for this field (used in dashboard sorting)
      order_count: orderCount,
      health_status: healthStatus,
      segment,
      avg_order_value: avgOrderValue || 0,
      days_since_last_order: daysSinceLastOrder,
      revenue_trend: yoyChangePct || 0,
      order_trend: 0, // Would need additional calculation
      is_corporate_gifting: customerData.is_corporate_gifting || false,
      is_manually_churned: customerData.is_manually_churned || false,
    };

    const response: CustomerDetailResponse = {
      customer,
      orderingPattern,
      revenueTrend,
      productMix,
      orderHistory,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching customer detail:", error);
    return NextResponse.json(
      { error: "Failed to fetch customer detail" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Auth check - requires admin session
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

  const { id } = await params;

  // Rate limiting
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  const rateLimitResult = checkRateLimit(`customer-update:${ip}`, RATE_LIMITS.API);
  if (!rateLimitResult.success) {
    return rateLimitedResponse(rateLimitResult);
  }

  try {
    const supabase = createServiceClient();
    const customerId = parseInt(id, 10);

    if (isNaN(customerId)) {
      return NextResponse.json(
        { error: "Invalid customer ID" },
        { status: 400 }
      );
    }

    const body = await request.json();

    // Validate allowed fields
    const allowedFields = ["is_manually_churned", "is_corporate_gifting"];
    const updateData: Record<string, boolean> = {};

    for (const field of allowedFields) {
      if (field in body && typeof body[field] === "boolean") {
        updateData[field] = body[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    // Update customer
    const { data, error } = await supabase
      .from("ns_wholesale_customers")
      .update(updateData)
      .eq("ns_customer_id", customerId)
      .select()
      .single();

    if (error) {
      console.error("Error updating customer:", error);
      return NextResponse.json(
        { error: "Failed to update customer" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      customer: {
        ns_customer_id: data.ns_customer_id,
        company_name: data.company_name,
        is_manually_churned: data.is_manually_churned,
        is_corporate_gifting: data.is_corporate_gifting,
      },
    });
  } catch (error) {
    console.error("Error updating customer:", error);
    return NextResponse.json(
      { error: "Failed to update customer" },
      { status: 500 }
    );
  }
}
