/**
 * Wholesale Analytics API
 * Returns wholesale customer and transaction data from NetSuite for Sales tab dashboard
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type {
  WholesaleResponse,
  WholesaleMonthlyStats,
  WholesaleCustomer,
  WholesaleAtRiskCustomer,
  WholesaleGrowthOpportunity,
  WholesaleNeverOrderedCustomer,
  WholesaleTransaction,
  WholesaleSkuStats,
  WholesaleStats,
  CustomerHealthStatus,
  CustomerSegment,
} from "@/lib/types";

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

// Helper to determine health status based on activity
function getHealthStatus(
  daysSinceLastOrder: number | null,
  orderCount: number,
  revenueTrend: number
): CustomerHealthStatus {
  // Never placed an order - sales opportunity
  if (orderCount === 0) return "never_ordered";
  // Has orders but no last_sale_date is a data issue, treat as new
  if (daysSinceLastOrder === null) return "new";
  if (orderCount === 1) return "one_time";
  if (daysSinceLastOrder > 365) return "churned";
  if (daysSinceLastOrder > 180) return "churning";
  if (daysSinceLastOrder > 120) return "at_risk";
  if (revenueTrend < -0.2) return "declining";
  if (revenueTrend > 0.1) return "thriving";
  return "stable";
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const period = searchParams.get("period") || "ytd";

    // Calculate date range based on period
    const now = new Date();
    let rangeStart: Date;
    let rangeEnd: Date = now;
    let prevRangeStart: Date;
    let prevRangeEnd: Date;

    switch (period) {
      case "mtd":
        rangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
        prevRangeStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        prevRangeEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
        break;
      case "last_month":
        rangeStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        rangeEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
        prevRangeStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
        prevRangeEnd = new Date(now.getFullYear(), now.getMonth() - 1, 0, 23, 59, 59);
        break;
      case "qtd":
        const currentQuarter = Math.floor(now.getMonth() / 3);
        rangeStart = new Date(now.getFullYear(), currentQuarter * 3, 1);
        const prevQuarter = currentQuarter === 0 ? 3 : currentQuarter - 1;
        const prevQuarterYear = currentQuarter === 0 ? now.getFullYear() - 1 : now.getFullYear();
        prevRangeStart = new Date(prevQuarterYear, prevQuarter * 3, 1);
        prevRangeEnd = new Date(now.getFullYear(), currentQuarter * 3, 0, 23, 59, 59);
        break;
      case "ytd":
        rangeStart = new Date(now.getFullYear(), 0, 1);
        prevRangeStart = new Date(now.getFullYear() - 1, 0, 1);
        prevRangeEnd = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate(), 23, 59, 59);
        break;
      case "30d":
        rangeStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        prevRangeStart = new Date(rangeStart.getTime() - 30 * 24 * 60 * 60 * 1000);
        prevRangeEnd = new Date(rangeStart.getTime() - 1);
        break;
      case "90d":
        rangeStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        prevRangeStart = new Date(rangeStart.getTime() - 90 * 24 * 60 * 60 * 1000);
        prevRangeEnd = new Date(rangeStart.getTime() - 1);
        break;
      case "12m":
        rangeStart = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
        prevRangeStart = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
        prevRangeEnd = new Date(rangeStart.getTime() - 1);
        break;
      default:
        rangeStart = new Date(now.getFullYear(), 0, 1);
        prevRangeStart = new Date(now.getFullYear() - 1, 0, 1);
        prevRangeEnd = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate(), 23, 59, 59);
    }

    // Format dates for SQL
    const formatDate = (d: Date) => d.toISOString().split("T")[0];

    // Execute all queries in parallel
    const [
      monthlyResult,
      customersResult,
      transactionsResult,
      lineItemsResult,
      prevTransactionsResult,
      skuResult,
    ] = await Promise.all([
      // Monthly aggregated stats (last 24 months for YoY)
      supabase.rpc("get_wholesale_monthly_stats"),
      // All customers with their transaction stats
      supabase
        .from("ns_wholesale_customers")
        .select("*")
        .order("lifetime_revenue", { ascending: false }),
      // Transactions in current period with customer name join
      supabase
        .from("ns_wholesale_transactions")
        .select("*, ns_wholesale_customers(company_name)")
        .gte("tran_date", formatDate(rangeStart))
        .lte("tran_date", formatDate(rangeEnd))
        .order("tran_date", { ascending: false }),
      // Line items in current period (for SKU analysis)
      supabase
        .from("ns_wholesale_line_items")
        .select("*, ns_wholesale_transactions!inner(tran_date)")
        .gte("ns_wholesale_transactions.tran_date", formatDate(rangeStart))
        .lte("ns_wholesale_transactions.tran_date", formatDate(rangeEnd)),
      // Previous period transactions for comparison
      supabase
        .from("ns_wholesale_transactions")
        .select("ns_customer_id, foreign_total")
        .gte("tran_date", formatDate(prevRangeStart))
        .lte("tran_date", formatDate(prevRangeEnd)),
      // Top SKUs from view
      supabase
        .from("ns_wholesale_sku_summary")
        .select("*")
        .order("total_revenue", { ascending: false })
        .limit(50),
    ]);

    // Build monthly stats from raw data if RPC doesn't exist
    let monthly: WholesaleMonthlyStats[] = [];
    if (monthlyResult.data) {
      monthly = monthlyResult.data.map((m: Record<string, unknown>) => ({
        month: m.month as string,
        transaction_count: Number(m.transaction_count) || 0,
        unique_customers: Number(m.unique_customers) || 0,
        total_units: Number(m.total_units) || 0,
        total_revenue: Number(m.total_revenue) || 0,
        avg_order_value: Number(m.avg_order_value) || 0,
        yoy_revenue_change: Number(m.yoy_revenue_change) || null,
        yoy_customer_change: Number(m.yoy_customer_change) || null,
      }));
    } else {
      // Fallback: aggregate from ns_wholesale_monthly view
      const { data: viewData } = await supabase
        .from("ns_wholesale_monthly")
        .select("*")
        .order("month", { ascending: false })
        .limit(24);

      if (viewData) {
        // Group by month (view has transaction_type dimension)
        const byMonth = new Map<string, WholesaleMonthlyStats>();
        for (const row of viewData) {
          const monthKey = row.month;
          const existing = byMonth.get(monthKey) || {
            month: monthKey,
            transaction_count: 0,
            unique_customers: 0,
            total_units: 0,
            total_revenue: 0,
            avg_order_value: 0,
            yoy_revenue_change: null,
            yoy_customer_change: null,
          };
          existing.transaction_count += Number(row.transaction_count) || 0;
          existing.total_units += Number(row.total_units) || 0;
          existing.total_revenue += Number(row.total_revenue) || 0;
          // unique_customers is approximate when combining types
          existing.unique_customers = Math.max(existing.unique_customers, Number(row.unique_customers) || 0);
          byMonth.set(monthKey, existing);
        }
        monthly = Array.from(byMonth.values()).map((m) => ({
          ...m,
          avg_order_value: m.transaction_count > 0 ? m.total_revenue / m.transaction_count : 0,
        }));

        // Calculate YoY changes
        for (const m of monthly) {
          const lastYear = monthly.find((prev) => {
            const [y, mo] = m.month.split("-").map(Number);
            const [py, pmo] = prev.month.split("-").map(Number);
            return py === y - 1 && pmo === mo;
          });
          if (lastYear && lastYear.total_revenue > 0) {
            m.yoy_revenue_change = ((m.total_revenue - lastYear.total_revenue) / lastYear.total_revenue) * 100;
          }
          if (lastYear && lastYear.unique_customers > 0) {
            m.yoy_customer_change =
              ((m.unique_customers - lastYear.unique_customers) / lastYear.unique_customers) * 100;
          }
        }
      }
    }

    // Process customers - the DB already computes health_status, segment, etc.
    const customers: WholesaleCustomer[] = (customersResult.data || []).map((c) => {
      // Map DB columns to our type
      // DB schema: ns_customer_id, company_name, lifetime_revenue, lifetime_orders,
      //            avg_order_value, ytd_revenue, ytd_orders, prior_year_revenue,
      //            first_order_date, last_order_date, days_since_last_order,
      //            segment, health_status, yoy_revenue_change_pct, is_at_risk, etc.

      const orderCount = c.lifetime_orders || 0;
      const totalRevenue = parseFloat(c.lifetime_revenue) || 0;
      const yoyChange = c.yoy_revenue_change_pct ? parseFloat(c.yoy_revenue_change_pct) / 100 : 0;

      // Use DB-computed health_status but handle never_ordered case
      let healthStatus = c.health_status as CustomerHealthStatus;
      if (orderCount === 0) {
        healthStatus = "never_ordered";
      }

      // Use DB-computed segment or compute if not present
      const segment = (c.segment as CustomerSegment) || getCustomerSegment(totalRevenue);

      return {
        ns_customer_id: parseInt(c.ns_customer_id) || 0,
        entity_id: c.ns_customer_id?.toString() || "",
        company_name: c.company_name || `Customer ${c.ns_customer_id}`,
        email: null, // Not in current schema
        phone: null, // Not in current schema
        first_sale_date: c.first_order_date,
        last_sale_date: c.last_order_date,
        total_revenue: totalRevenue,
        order_count: orderCount,
        health_status: healthStatus,
        segment: segment,
        avg_order_value: parseFloat(c.avg_order_value) || 0,
        days_since_last_order: c.days_since_last_order,
        revenue_trend: yoyChange,
        order_trend: 0, // Not computed in DB
      };
    });

    // Top customers (active in period)
    const topCustomers = customers
      .filter((c) => c.total_revenue > 0)
      .sort((a, b) => b.total_revenue - a.total_revenue)
      .slice(0, 25);

    // At-risk customers
    const atRiskCustomers: WholesaleAtRiskCustomer[] = customers
      .filter((c) => c.health_status === "at_risk" || c.health_status === "churning")
      .sort((a, b) => b.total_revenue - a.total_revenue)
      .slice(0, 20)
      .map((c) => ({
        ns_customer_id: c.ns_customer_id,
        company_name: c.company_name,
        segment: c.segment,
        total_revenue: c.total_revenue,
        last_order_date: c.last_sale_date,
        days_since_last_order: c.days_since_last_order || 0,
        order_count: c.order_count,
        avg_order_value: c.avg_order_value,
        risk_score: c.days_since_last_order ? Math.min(100, Math.round(c.days_since_last_order / 3.65)) : 0,
        recommended_action: c.days_since_last_order && c.days_since_last_order > 180 ? "Re-engagement campaign" : "Check-in call",
      }));

    // Growth opportunities (customers with positive trends)
    const growthOpportunities: WholesaleGrowthOpportunity[] = customers
      .filter(
        (c) =>
          c.revenue_trend > 0.1 &&
          c.health_status !== "churned" &&
          c.health_status !== "churning"
      )
      .sort((a, b) => b.revenue_trend - a.revenue_trend)
      .slice(0, 15)
      .map((c) => ({
        ns_customer_id: c.ns_customer_id,
        company_name: c.company_name,
        segment: c.segment,
        current_revenue: c.total_revenue,
        growth_potential: c.total_revenue * c.revenue_trend,
        revenue_trend: c.revenue_trend,
        order_trend: c.order_trend,
        opportunity_type: getOpportunityType(c),
      }));

    // Never ordered customers - sales opportunities
    // These are accounts in NetSuite that have never placed an order
    // Current DB schema uses lifetime_orders, created_at instead of order_count, date_created
    const neverOrderedCustomers: WholesaleNeverOrderedCustomer[] = (customersResult.data || [])
      .filter((c) => (c.lifetime_orders || 0) === 0)
      .sort((a, b) => {
        // Sort by created_at (newest first) - these are the hottest leads
        const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bDate - aDate;
      })
      .slice(0, 50)
      .map((c) => ({
        ns_customer_id: parseInt(c.ns_customer_id) || 0,
        entity_id: c.ns_customer_id?.toString() || "",
        company_name: c.company_name || `Customer ${c.ns_customer_id}`,
        email: null, // Not in current schema
        phone: null, // Not in current schema
        date_created: c.created_at,
        days_since_created: c.created_at
          ? Math.floor((now.getTime() - new Date(c.created_at).getTime()) / (1000 * 60 * 60 * 24))
          : null,
        category: null, // Not in current schema
        is_inactive: false, // Not in current schema
      }));

    // Recent transactions with company names from join
    const recentTransactions: WholesaleTransaction[] = (transactionsResult.data || [])
      .slice(0, 50)
      .map((t) => ({
        ns_transaction_id: t.ns_transaction_id,
        tran_id: t.tran_id,
        transaction_type: t.transaction_type,
        tran_date: t.tran_date,
        ns_customer_id: t.ns_customer_id,
        company_name: t.ns_wholesale_customers?.company_name || `Customer ${t.ns_customer_id}`,
        foreign_total: parseFloat(t.foreign_total) || 0,
        status: t.status,
      }));

    // Process SKU stats from view
    const topSkus: WholesaleSkuStats[] = (skuResult.data || []).slice(0, 30).map((s) => ({
      sku: s.sku,
      item_type: s.item_type,
      order_count: s.order_count || 0,
      total_units: Math.abs(s.total_units) || 0,
      total_revenue: Math.abs(parseFloat(s.total_revenue)) || 0,
      first_sold: s.first_sold,
      last_sold: s.last_sold,
      avg_units_per_order:
        s.order_count > 0 ? Math.abs(s.total_units) / s.order_count : 0,
    }));

    // Calculate summary stats
    const currentPeriodRevenue = (transactionsResult.data || []).reduce(
      (sum, t) => sum + (parseFloat(t.foreign_total) || 0),
      0
    );
    const prevPeriodRevenue = (prevTransactionsResult.data || []).reduce(
      (sum, t) => sum + (parseFloat(t.foreign_total) || 0),
      0
    );

    const currentPeriodCustomers = new Set(
      (transactionsResult.data || []).map((t) => t.ns_customer_id)
    ).size;
    const prevPeriodCustomers = new Set(
      (prevTransactionsResult.data || []).map((t) => t.ns_customer_id)
    ).size;

    const currentPeriodOrders = (transactionsResult.data || []).length;
    const prevPeriodOrders = (prevTransactionsResult.data || []).length;

    // Health distribution
    const healthDistribution = {
      thriving: customers.filter((c) => c.health_status === "thriving").length,
      stable: customers.filter((c) => c.health_status === "stable").length,
      declining: customers.filter((c) => c.health_status === "declining").length,
      at_risk: customers.filter((c) => c.health_status === "at_risk").length,
      churning: customers.filter((c) => c.health_status === "churning").length,
      churned: customers.filter((c) => c.health_status === "churned").length,
      new: customers.filter((c) => c.health_status === "new").length,
      one_time: customers.filter((c) => c.health_status === "one_time").length,
      never_ordered: customers.filter((c) => c.health_status === "never_ordered").length,
    };

    // Segment distribution
    const segmentDistribution = {
      major: customers.filter((c) => c.segment === "major").length,
      large: customers.filter((c) => c.segment === "large").length,
      mid: customers.filter((c) => c.segment === "mid").length,
      small: customers.filter((c) => c.segment === "small").length,
      starter: customers.filter((c) => c.segment === "starter").length,
      minimal: customers.filter((c) => c.segment === "minimal").length,
    };

    const stats: WholesaleStats = {
      total_revenue: currentPeriodRevenue,
      total_orders: currentPeriodOrders,
      total_customers: customers.length,
      active_customers: currentPeriodCustomers,
      avg_order_value: currentPeriodOrders > 0 ? currentPeriodRevenue / currentPeriodOrders : 0,
      revenue_delta: currentPeriodRevenue - prevPeriodRevenue,
      revenue_delta_pct:
        prevPeriodRevenue > 0
          ? ((currentPeriodRevenue - prevPeriodRevenue) / prevPeriodRevenue) * 100
          : 0,
      orders_delta: currentPeriodOrders - prevPeriodOrders,
      orders_delta_pct:
        prevPeriodOrders > 0
          ? ((currentPeriodOrders - prevPeriodOrders) / prevPeriodOrders) * 100
          : 0,
      customers_delta: currentPeriodCustomers - prevPeriodCustomers,
      customers_delta_pct:
        prevPeriodCustomers > 0
          ? ((currentPeriodCustomers - prevPeriodCustomers) / prevPeriodCustomers) * 100
          : 0,
      health_distribution: healthDistribution,
      segment_distribution: segmentDistribution,
    };

    // Build response
    const response: WholesaleResponse = {
      monthly: monthly.sort((a, b) => a.month.localeCompare(b.month)),
      stats,
      topCustomers,
      atRiskCustomers,
      growthOpportunities,
      neverOrderedCustomers,
      recentTransactions,
      topSkus,
      lastSynced: new Date().toISOString(),
    };

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    console.error("[WHOLESALE API] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch wholesale data" },
      { status: 500 }
    );
  }
}

// Helper to calculate risk score (0-100)
function calculateRiskScore(customer: WholesaleCustomer): number {
  let score = 0;

  // Days since last order (max 40 points)
  if (customer.days_since_last_order !== null) {
    if (customer.days_since_last_order > 365) score += 40;
    else if (customer.days_since_last_order > 180) score += 30;
    else if (customer.days_since_last_order > 120) score += 20;
    else if (customer.days_since_last_order > 90) score += 10;
  }

  // Revenue trend (max 30 points)
  if (customer.revenue_trend < -0.5) score += 30;
  else if (customer.revenue_trend < -0.3) score += 20;
  else if (customer.revenue_trend < -0.1) score += 10;

  // Order trend (max 20 points)
  if (customer.order_trend < -0.5) score += 20;
  else if (customer.order_trend < -0.3) score += 15;
  else if (customer.order_trend < -0.1) score += 10;

  // Value at risk based on segment (max 10 points)
  if (customer.segment === "major") score += 10;
  else if (customer.segment === "large") score += 8;
  else if (customer.segment === "mid") score += 6;

  return Math.min(100, score);
}

// Helper to get recommended action for at-risk customers
function getRecommendedAction(customer: WholesaleCustomer): string {
  if (customer.days_since_last_order && customer.days_since_last_order > 365) {
    return "Win-back campaign - offer special pricing";
  }
  if (customer.days_since_last_order && customer.days_since_last_order > 180) {
    return "Direct outreach from sales rep";
  }
  if (customer.revenue_trend < -0.3) {
    return "Review account - check for competitor activity";
  }
  if (customer.order_trend < -0.3) {
    return "Schedule check-in call to understand needs";
  }
  return "Monitor closely for next order";
}

// Helper to determine opportunity type
function getOpportunityType(
  customer: WholesaleCustomer
): "upsell" | "cross_sell" | "volume_increase" | "new_category" {
  if (customer.segment === "starter" || customer.segment === "small") {
    return "volume_increase";
  }
  if (customer.order_trend > customer.revenue_trend) {
    return "upsell";
  }
  if (customer.revenue_trend > 0.3) {
    return "cross_sell";
  }
  return "new_category";
}
