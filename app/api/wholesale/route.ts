/**
 * Wholesale Analytics API
 * Returns wholesale customer and transaction data from NetSuite for Sales tab dashboard
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import type {
  WholesaleResponse,
  WholesaleMonthlyStats,
  WholesaleCustomer,
  WholesaleAtRiskCustomer,
  WholesaleGrowthOpportunity,
  WholesaleNeverOrderedCustomer,
  WholesaleOrderingAnomaly,
  OrderingAnomalySeverity,
  WholesaleTransaction,
  WholesaleSkuStats,
  WholesaleStats,
  WholesaleNewCustomerAcquisition,
  WholesaleRevenueByType,
  CustomerHealthStatus,
  CustomerSegment,
} from "@/lib/types";
import { checkRateLimit, rateLimitedResponse, RATE_LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Customer IDs to exclude from wholesale analytics
// These are D2C/retail aggregates that pollute B2B data
const EXCLUDED_CUSTOMER_IDS = [
  2501, // "Smithey Shopify Customer" - D2C retail aggregate, not a real wholesale customer
];

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
  // Rate limiting
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  const rateLimitResult = checkRateLimit(`wholesale:${ip}`, RATE_LIMITS.API);
  if (!rateLimitResult.success) {
    return rateLimitedResponse(rateLimitResult);
  }

  try {
    const supabase = createServiceClient();
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
      prevTransactionsResult,
      skuResult,
    ] = await Promise.all([
      // Monthly aggregated stats (last 24 months for YoY)
      supabase.rpc("get_wholesale_monthly_stats"),
      // All customers with their transaction stats (excluding D2C aggregates)
      supabase
        .from("ns_wholesale_customers")
        .select("*")
        .not("ns_customer_id", "in", `(${EXCLUDED_CUSTOMER_IDS.join(",")})`)
        .order("lifetime_revenue", { ascending: false }),
      // Transactions in current period with customer name join (excluding D2C)
      supabase
        .from("ns_wholesale_transactions")
        .select("*, ns_wholesale_customers(company_name)")
        .not("ns_customer_id", "in", `(${EXCLUDED_CUSTOMER_IDS.join(",")})`)
        .gte("tran_date", formatDate(rangeStart))
        .lte("tran_date", formatDate(rangeEnd))
        .order("tran_date", { ascending: false }),
      // Previous period transactions for comparison (excluding D2C)
      supabase
        .from("ns_wholesale_transactions")
        .select("ns_customer_id, foreign_total")
        .not("ns_customer_id", "in", `(${EXCLUDED_CUSTOMER_IDS.join(",")})`)
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

    // Log RPC result for debugging
    if (monthlyResult.error) {
      console.error("[WHOLESALE API] Monthly RPC error:", monthlyResult.error);
    }

    if (monthlyResult.data && Array.isArray(monthlyResult.data) && monthlyResult.data.length > 0) {
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

    // At-risk customers (includes churned - UI can filter them)
    const atRiskCustomers: WholesaleAtRiskCustomer[] = customers
      .filter((c) => c.health_status === "at_risk" || c.health_status === "churning" || c.health_status === "churned")
      .sort((a, b) => b.total_revenue - a.total_revenue)
      .slice(0, 30)
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
        is_churned: (c.days_since_last_order || 0) >= 365,
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

    // ========================================================================
    // ORDERING ANOMALIES - The intelligent way to detect at-risk customers
    // Instead of fixed thresholds, we analyze each customer's own pattern
    // ========================================================================
    const orderingAnomalies: WholesaleOrderingAnomaly[] = [];

    for (const c of customersResult.data || []) {
      const orderCount = c.lifetime_orders || 0;
      const totalRevenue = parseFloat(c.lifetime_revenue) || 0;
      const daysSinceLastOrder = c.days_since_last_order;
      const firstOrderDate = c.first_order_date ? new Date(c.first_order_date) : null;
      const lastOrderDate = c.last_order_date ? new Date(c.last_order_date) : null;

      // Skip customers without enough data to establish a RELIABLE pattern
      // Need at least 4 orders - with only 2-3 orders, the "interval" could be noise
      // (e.g., a split shipment over 2 days doesn't mean they order every 2 days)
      if (orderCount < 4 || !firstOrderDate || !lastOrderDate || daysSinceLastOrder === null) {
        continue;
      }

      // Calculate their average order interval (days between orders)
      const daysBetweenFirstAndLast = Math.floor(
        (lastOrderDate.getTime() - firstOrderDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      const avgOrderIntervalDays = daysBetweenFirstAndLast / (orderCount - 1);

      // Skip if average interval is too short (< 14 days) or too long (> 180 days)
      // < 14 days: likely noise from split shipments, not a real pattern
      // > 180 days: too infrequent to establish meaningful expectations
      if (avgOrderIntervalDays < 14 || avgOrderIntervalDays > 180) {
        continue;
      }

      // Calculate when we expected their next order
      const expectedOrderDate = new Date(lastOrderDate.getTime() + avgOrderIntervalDays * 24 * 60 * 60 * 1000);
      const daysOverdue = Math.floor(
        (now.getTime() - expectedOrderDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Calculate overdue ratio (how late they are relative to their pattern)
      // >1 means they're past their expected order date
      const overdueRatio = daysSinceLastOrder / avgOrderIntervalDays;

      // Only include customers who are at least 20% overdue (ratio > 1.2)
      if (overdueRatio <= 1.2) {
        continue;
      }

      const segment = (c.segment as CustomerSegment) || getCustomerSegment(totalRevenue);

      orderingAnomalies.push({
        ns_customer_id: parseInt(c.ns_customer_id) || 0,
        company_name: c.company_name || `Customer ${c.ns_customer_id}`,
        segment,
        total_revenue: totalRevenue,
        order_count: orderCount,
        avg_order_interval_days: Math.round(avgOrderIntervalDays),
        last_order_date: c.last_order_date,
        days_since_last_order: daysSinceLastOrder,
        expected_order_date: expectedOrderDate.toISOString().split("T")[0],
        days_overdue: daysOverdue,
        overdue_ratio: Math.round(overdueRatio * 100) / 100, // Round to 2 decimal places
        severity: getAnomalySeverity(overdueRatio),
        is_churned: daysSinceLastOrder >= 365,
      });
    }

    // Sort by severity (critical first), then by revenue (highest value at risk first)
    orderingAnomalies.sort((a, b) => {
      const severityOrder: Record<OrderingAnomalySeverity, number> = { critical: 0, warning: 1, watch: 2 };
      if (severityOrder[a.severity] !== severityOrder[b.severity]) {
        return severityOrder[a.severity] - severityOrder[b.severity];
      }
      return b.total_revenue - a.total_revenue;
    });

    // Never ordered customers - sales opportunities
    // These are accounts in NetSuite that have never placed an order
    // DB schema: date_created is the NetSuite creation date (when customer was created in NS)
    const neverOrderedCustomers: WholesaleNeverOrderedCustomer[] = (customersResult.data || [])
      .filter((c) => (c.lifetime_orders || 0) === 0)
      .sort((a, b) => {
        // Sort by date_created (newest first) - these are the hottest leads
        const aDate = a.date_created ? new Date(a.date_created).getTime() : 0;
        const bDate = b.date_created ? new Date(b.date_created).getTime() : 0;
        return bDate - aDate;
      })
      .map((c) => ({
        ns_customer_id: parseInt(c.ns_customer_id) || 0,
        entity_id: c.ns_customer_id?.toString() || "",
        company_name: c.company_name || `Customer ${c.ns_customer_id}`,
        email: null, // Not in current schema
        phone: null, // Not in current schema
        date_created: c.date_created,
        days_since_created: c.date_created
          ? Math.floor((now.getTime() - new Date(c.date_created).getTime()) / (1000 * 60 * 60 * 24))
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

    // Customers grouped by health status for drill-down views (sorted by revenue)
    const customersByHealth = {
      thriving: customers.filter((c) => c.health_status === "thriving").sort((a, b) => b.total_revenue - a.total_revenue),
      stable: customers.filter((c) => c.health_status === "stable").sort((a, b) => b.total_revenue - a.total_revenue),
      declining: customers.filter((c) => c.health_status === "declining").sort((a, b) => b.total_revenue - a.total_revenue),
      at_risk: customers.filter((c) => c.health_status === "at_risk").sort((a, b) => b.total_revenue - a.total_revenue),
      churning: customers.filter((c) => c.health_status === "churning").sort((a, b) => b.total_revenue - a.total_revenue),
      churned: customers.filter((c) => c.health_status === "churned").sort((a, b) => b.total_revenue - a.total_revenue),
      new: customers.filter((c) => c.health_status === "new").sort((a, b) => b.total_revenue - a.total_revenue),
      one_time: customers.filter((c) => c.health_status === "one_time").sort((a, b) => b.total_revenue - a.total_revenue),
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

    // ========================================================================
    // REVENUE BY BUSINESS TYPE (Corporate vs Standard B2B)
    // Uses the 'category' field from NetSuite to identify corporate customers
    // ========================================================================

    // Build a map of customer_id -> category from the raw customers data
    const customerCategoryMap = new Map<number, string>();
    for (const c of customersResult.data || []) {
      customerCategoryMap.set(parseInt(c.ns_customer_id), c.category || "");
    }

    // Calculate revenue breakdown by type for current period
    let corporateRevenue = 0;
    let corporateOrderCount = 0;
    const corporateCustomerIds = new Set<number>();
    let standardB2BRevenue = 0;
    let standardB2BOrderCount = 0;
    const standardB2BCustomerIds = new Set<number>();

    for (const t of transactionsResult.data || []) {
      const category = customerCategoryMap.get(t.ns_customer_id);
      const revenue = parseFloat(t.foreign_total) || 0;

      if (category === "Corporate") {
        corporateRevenue += revenue;
        corporateOrderCount++;
        corporateCustomerIds.add(t.ns_customer_id);
      } else {
        standardB2BRevenue += revenue;
        standardB2BOrderCount++;
        standardB2BCustomerIds.add(t.ns_customer_id);
      }
    }

    const totalRevenueForPct = corporateRevenue + standardB2BRevenue;
    const revenueByType: WholesaleRevenueByType = {
      corporate: {
        revenue: Math.round(corporateRevenue * 100) / 100,
        customer_count: corporateCustomerIds.size,
        order_count: corporateOrderCount,
        revenue_pct: totalRevenueForPct > 0
          ? Math.round((corporateRevenue / totalRevenueForPct) * 1000) / 10
          : 0,
      },
      standard_b2b: {
        revenue: Math.round(standardB2BRevenue * 100) / 100,
        customer_count: standardB2BCustomerIds.size,
        order_count: standardB2BOrderCount,
        revenue_pct: totalRevenueForPct > 0
          ? Math.round((standardB2BRevenue / totalRevenueForPct) * 1000) / 10
          : 0,
      },
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
      revenue_by_type: revenueByType,
    };

    // New customers - first-time buyers in last 90 days
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const newCustomers: WholesaleCustomer[] = customers
      .filter((c) => {
        if (!c.first_sale_date || c.order_count === 0) return false;
        const firstOrder = new Date(c.first_sale_date);
        return firstOrder >= ninetyDaysAgo;
      })
      .sort((a, b) => {
        // Sort by first order date (most recent first)
        const aDate = a.first_sale_date ? new Date(a.first_sale_date).getTime() : 0;
        const bDate = b.first_sale_date ? new Date(b.first_sale_date).getTime() : 0;
        return bDate - aDate;
      })
      .slice(0, 25);

    // Churned customers - 365+ days since last order, excludes major/corporate accounts
    const churnedCustomers: WholesaleCustomer[] = customers
      .filter((c) =>
        c.health_status === "churned" &&
        c.segment !== "major" && // Exclude corporate accounts like Crate & Barrel
        c.order_count > 0 // Must have ordered at some point
      )
      .sort((a, b) => b.total_revenue - a.total_revenue) // Highest value first - these are win-back opportunities
      .slice(0, 30);

    // ========================================================================
    // NEW CUSTOMER ACQUISITION YoY COMPARISON
    // Compare new customers acquired YTD vs same period last year
    // IMPORTANT: We derive "first order date" from the transactions table,
    // NOT from ns_wholesale_customers.first_order_date (which is incomplete)
    // ========================================================================
    let newCustomerAcquisition: WholesaleNewCustomerAcquisition | null = null;
    const partialErrors: { section: string; message: string }[] = [];

    try {
      // Current YTD period
      const currentYearStart = new Date(now.getFullYear(), 0, 1);
      const currentYearEnd = now;

      // Same period last year (Jan 1 to same day/month last year)
      const priorYearStart = new Date(now.getFullYear() - 1, 0, 1);
      const priorYearEnd = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());

      // Get customer names lookup from customers table
      const customerNamesMap = new Map<number, string>();
      for (const c of customersResult.data || []) {
        customerNamesMap.set(parseInt(c.ns_customer_id), c.company_name || `Customer ${c.ns_customer_id}`);
      }

      // Get ALL transactions to find each customer's first order date AND total revenue per period
      // (this is the source of truth, not the customers table)
      const { data: allTxns } = await supabase
        .from("ns_wholesale_transactions")
        .select("ns_customer_id, foreign_total, tran_date")
        .not("ns_customer_id", "in", `(${EXCLUDED_CUSTOMER_IDS.join(",")})`)
        .order("tran_date", { ascending: true });

      // Build map of each customer's first transaction ever (for determining "new" status)
      const customerFirstTxn = new Map<number, { date: string }>();
      // Build map of each customer's total revenue in current YTD period
      const customerCurrentYTDRevenue = new Map<number, number>();
      // Build map of each customer's total revenue in prior YTD period
      const customerPriorYTDRevenue = new Map<number, number>();

      for (const txn of allTxns || []) {
        const txnDate = new Date(txn.tran_date);
        const revenue = parseFloat(txn.foreign_total) || 0;

        // Track first transaction date (for "new" status)
        if (!customerFirstTxn.has(txn.ns_customer_id)) {
          customerFirstTxn.set(txn.ns_customer_id, { date: txn.tran_date });
        }

        // Accumulate current YTD revenue
        if (txnDate >= currentYearStart && txnDate <= currentYearEnd) {
          customerCurrentYTDRevenue.set(
            txn.ns_customer_id,
            (customerCurrentYTDRevenue.get(txn.ns_customer_id) || 0) + revenue
          );
        }

        // Accumulate prior YTD revenue
        if (txnDate >= priorYearStart && txnDate <= priorYearEnd) {
          customerPriorYTDRevenue.set(
            txn.ns_customer_id,
            (customerPriorYTDRevenue.get(txn.ns_customer_id) || 0) + revenue
          );
        }
      }

      // Find NEW customers in current YTD (first transaction ever is in 2025 YTD)
      // Revenue = their TOTAL YTD revenue, not just first order
      const currentNewCustomers = new Map<number, { revenue: number; firstOrderDate: string; companyName: string }>();
      for (const [customerId, firstTxn] of customerFirstTxn) {
        const firstDate = new Date(firstTxn.date);
        if (firstDate >= currentYearStart && firstDate <= currentYearEnd) {
          currentNewCustomers.set(customerId, {
            revenue: customerCurrentYTDRevenue.get(customerId) || 0,
            firstOrderDate: firstTxn.date,
            companyName: customerNamesMap.get(customerId) || `Customer ${customerId}`,
          });
        }
      }

      const currentNewCustomerCount = currentNewCustomers.size;
      const currentTotalRevenue = Array.from(currentNewCustomers.values())
        .reduce((sum, o) => sum + o.revenue, 0);
      const currentAvgOrderValue = currentNewCustomerCount > 0
        ? currentTotalRevenue / currentNewCustomerCount
        : 0;

      // Find NEW customers in prior YTD (first transaction ever is in 2024 YTD)
      // Revenue = their TOTAL prior YTD revenue, not just first order
      const priorNewCustomers = new Map<number, { revenue: number; firstOrderDate: string; companyName: string }>();
      for (const [customerId, firstTxn] of customerFirstTxn) {
        const firstDate = new Date(firstTxn.date);
        if (firstDate >= priorYearStart && firstDate <= priorYearEnd) {
          priorNewCustomers.set(customerId, {
            revenue: customerPriorYTDRevenue.get(customerId) || 0,
            firstOrderDate: firstTxn.date,
            companyName: customerNamesMap.get(customerId) || `Customer ${customerId}`,
          });
        }
      }

      const priorNewCustomerCount = priorNewCustomers.size;
      const priorTotalRevenue = Array.from(priorNewCustomers.values())
        .reduce((sum, o) => sum + o.revenue, 0);
      const priorAvgOrderValue = priorNewCustomerCount > 0
        ? priorTotalRevenue / priorNewCustomerCount
        : 0;

      // Detect outliers: orders > 3x the combined average
      const combinedAvg = (currentTotalRevenue + priorTotalRevenue) /
        Math.max(1, currentNewCustomerCount + priorNewCustomerCount);
      const outlierThreshold = combinedAvg * 3;

      const outliers: WholesaleNewCustomerAcquisition["outliers"] = [];
      let currentAdjustedRevenue = currentTotalRevenue;
      let priorAdjustedRevenue = priorTotalRevenue;

      // Find current period outliers (using total YTD revenue, not just first order)
      for (const [customerId, customer] of currentNewCustomers) {
        if (customer.revenue > outlierThreshold && outlierThreshold > 0) {
          outliers.push({
            ns_customer_id: customerId,
            company_name: customer.companyName,
            revenue: customer.revenue,
            orderDate: customer.firstOrderDate,
            period: "current",
            reason: `>${Math.round(customer.revenue / combinedAvg)}x average new customer revenue ($${combinedAvg.toLocaleString("en-US", { maximumFractionDigits: 0 })} avg)`,
          });
          currentAdjustedRevenue -= customer.revenue;
        }
      }

      // Find prior period outliers (using total YTD revenue, not just first order)
      for (const [customerId, customer] of priorNewCustomers) {
        if (customer.revenue > outlierThreshold && outlierThreshold > 0) {
          outliers.push({
            ns_customer_id: customerId,
            company_name: customer.companyName,
            revenue: customer.revenue,
            orderDate: customer.firstOrderDate,
            period: "prior",
            reason: `>${Math.round(customer.revenue / combinedAvg)}x average new customer revenue ($${combinedAvg.toLocaleString("en-US", { maximumFractionDigits: 0 })} avg)`,
          });
          priorAdjustedRevenue -= customer.revenue;
        }
      }

      // Calculate YoY comparison
      const customerCountDelta = currentNewCustomerCount - priorNewCustomerCount;
      const customerCountDeltaPct = priorNewCustomerCount > 0
        ? (customerCountDelta / priorNewCustomerCount) * 100
        : currentNewCustomerCount > 0 ? 100 : 0;
      const revenueDelta = currentTotalRevenue - priorTotalRevenue;
      const revenueDeltaPct = priorTotalRevenue > 0
        ? (revenueDelta / priorTotalRevenue) * 100
        : currentTotalRevenue > 0 ? 100 : 0;

      // Adjusted comparison (excluding outliers)
      const adjustedRevenueDelta = currentAdjustedRevenue - priorAdjustedRevenue;
      const adjustedRevenueDeltaPct = priorAdjustedRevenue > 0
        ? (adjustedRevenueDelta / priorAdjustedRevenue) * 100
        : currentAdjustedRevenue > 0 ? 100 : 0;

      newCustomerAcquisition = {
        currentPeriod: {
          startDate: formatDate(currentYearStart),
          endDate: formatDate(currentYearEnd),
          newCustomerCount: currentNewCustomerCount,
          totalRevenue: Math.round(currentTotalRevenue),
          avgOrderValue: Math.round(currentAvgOrderValue),
        },
        priorPeriod: {
          startDate: formatDate(priorYearStart),
          endDate: formatDate(priorYearEnd),
          newCustomerCount: priorNewCustomerCount,
          totalRevenue: Math.round(priorTotalRevenue),
          avgOrderValue: Math.round(priorAvgOrderValue),
        },
        yoyComparison: {
          customerCountDelta,
          customerCountDeltaPct: Math.round(customerCountDeltaPct * 10) / 10,
          revenueDelta: Math.round(revenueDelta),
          revenueDeltaPct: Math.round(revenueDeltaPct * 10) / 10,
        },
        outliers: outliers.sort((a, b) => b.revenue - a.revenue),
        adjustedComparison: {
          currentRevenue: Math.round(currentAdjustedRevenue),
          priorRevenue: Math.round(priorAdjustedRevenue),
          revenueDelta: Math.round(adjustedRevenueDelta),
          revenueDeltaPct: Math.round(adjustedRevenueDeltaPct * 10) / 10,
          outliersExcluded: outliers.length,
        },
      };
    } catch (error) {
      console.error("[WHOLESALE API] Error calculating new customer acquisition:", error);
      partialErrors.push({
        section: "newCustomerAcquisition",
        message: error instanceof Error ? error.message : "Failed to calculate YoY acquisition data",
      });
      // newCustomerAcquisition remains null on error
    }

    // Build response
    const response: WholesaleResponse = {
      monthly: monthly.sort((a, b) => a.month.localeCompare(b.month)),
      stats,
      topCustomers,
      atRiskCustomers,
      growthOpportunities,
      neverOrderedCustomers,
      orderingAnomalies,
      newCustomers,
      churnedCustomers,
      recentTransactions,
      topSkus,
      newCustomerAcquisition,
      customersByHealth,
      lastSynced: new Date().toISOString(),
      ...(partialErrors.length > 0 ? { partialErrors } : {}),
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

// Helper to determine ordering anomaly severity based on overdue ratio
// This is the intelligent way - based on each customer's own behavior pattern
function getAnomalySeverity(overdueRatio: number): OrderingAnomalySeverity {
  if (overdueRatio >= 2.0) return "critical"; // 2x+ late relative to their pattern
  if (overdueRatio >= 1.5) return "warning";  // 1.5x late
  return "watch";                              // 1.2x+ late
}
