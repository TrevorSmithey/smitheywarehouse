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

// Hardcoded customer IDs to exclude from wholesale analytics
// These are D2C/retail aggregates that pollute B2B data
const HARDCODED_EXCLUDED_IDS = [
  2501, // "Smithey Shopify Customer" - D2C retail aggregate, not a real wholesale customer
];

// Type-safe customer ID parser - handles both string and number from DB
// Supabase can return numeric columns as strings in some edge cases
function parseCustomerId(id: unknown): number {
  if (typeof id === "number") return id;
  if (typeof id === "string") return Number(id) || 0;
  return 0;
}

// Helper to build exclusion list combining hardcoded IDs and DB-flagged test accounts
async function getExcludedCustomerIds(supabase: ReturnType<typeof createServiceClient>): Promise<number[]> {
  const { data: excludedFromDB, error } = await supabase
    .from("ns_wholesale_customers")
    .select("ns_customer_id")
    .eq("is_excluded", true);

  if (error) {
    console.warn("[WHOLESALE] Failed to fetch excluded customers from DB, using hardcoded list only:", error.message);
  }

  const dbExcludedIds = (excludedFromDB || []).map((c) => c.ns_customer_id);
  return [...new Set([...HARDCODED_EXCLUDED_IDS, ...dbExcludedIds])];
}

// Helper to determine customer segment based on revenue
function getCustomerSegment(totalRevenue: number): CustomerSegment {
  if (totalRevenue >= 50000) return "major";
  if (totalRevenue >= 20000) return "large";
  if (totalRevenue >= 10000) return "mid";
  if (totalRevenue >= 5000) return "small";
  if (totalRevenue >= 2000) return "starter";
  return "minimal";
}

// NOTE: health_status is now computed directly in the database by compute_customer_metrics()
// The RPC correctly aggregates transaction data and computes health status based on:
// - first_sale_date (from transactions)
// - lifetime_orders (computed from transactions)
// - days_since_last_order (computed from last_sale_date)
// - ytd_revenue and prior_year_revenue (for trend analysis)
// This eliminates API-side workarounds and ensures single source of truth.

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

    // Build exclusion list (combines hardcoded IDs + DB-flagged test accounts)
    const EXCLUDED_CUSTOMER_IDS = await getExcludedCustomerIds(supabase);

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
        corporate_revenue: 0, // Will be calculated below
        regular_revenue: 0, // Will be calculated below
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
            corporate_revenue: 0, // Will be calculated below
            regular_revenue: 0, // Will be calculated below
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

    // Calculate monthly corporate vs regular revenue breakdown
    // Build customer category map for revenue breakdown
    const customerCategoryMapForMonthly = new Map<number, string>();
    for (const c of customersResult.data || []) {
      customerCategoryMapForMonthly.set(parseCustomerId(c.ns_customer_id), c.category || "");
    }

    // Query all transactions from the last 24 months for monthly breakdown
    const monthlyBreakdownStart = new Date();
    monthlyBreakdownStart.setMonth(monthlyBreakdownStart.getMonth() - 24);
    const { data: monthlyTxns } = await supabase
      .from("ns_wholesale_transactions")
      .select("ns_customer_id, foreign_total, tran_date")
      .not("ns_customer_id", "in", `(${EXCLUDED_CUSTOMER_IDS.join(",")})`)
      .gte("tran_date", monthlyBreakdownStart.toISOString().split("T")[0]);

    // Group transactions by month and calculate corporate vs regular revenue
    const monthlyRevenueBreakdown = new Map<string, { corporate: number; regular: number }>();
    for (const txn of monthlyTxns || []) {
      if (!txn.tran_date) continue;
      // Use YYYY-MM format to match RPC output (primary path)
      const monthKey = txn.tran_date.substring(0, 7); // YYYY-MM format
      const revenue = parseFloat(txn.foreign_total) || 0;
      // Add parseInt to handle potential string type from Supabase
      const category = customerCategoryMapForMonthly.get(parseCustomerId(txn.ns_customer_id));
      const isCorporate = category === "Corporate" || category === "4";

      const existing = monthlyRevenueBreakdown.get(monthKey) || { corporate: 0, regular: 0 };
      if (isCorporate) {
        existing.corporate += revenue;
      } else {
        existing.regular += revenue;
      }
      monthlyRevenueBreakdown.set(monthKey, existing);
    }

    // Merge corporate/regular revenue into monthly stats
    for (const m of monthly) {
      // Normalize month key: RPC returns YYYY-MM, view returns YYYY-MM-01
      const normalizedMonth = m.month.substring(0, 7); // Always use YYYY-MM for lookup
      const breakdown = monthlyRevenueBreakdown.get(normalizedMonth) || { corporate: 0, regular: 0 };
      m.corporate_revenue = Math.round(breakdown.corporate * 100) / 100;
      m.regular_revenue = Math.round(breakdown.regular * 100) / 100;
    }

    // Process customers - the DB already computes health_status, segment, etc.
    const customers: WholesaleCustomer[] = (customersResult.data || []).map((c) => {
      // Map DB columns to our type
      // DB schema: ns_customer_id, company_name, lifetime_revenue, lifetime_orders,
      //            avg_order_value, ytd_revenue, ytd_orders, prior_year_revenue,
      //            first_order_date, last_order_date, days_since_last_order,
      //            segment, health_status, yoy_revenue_change_pct, is_at_risk, etc.

      const totalRevenue = parseFloat(c.lifetime_revenue) || 0;
      const yoyChange = c.yoy_revenue_change_pct ? parseFloat(c.yoy_revenue_change_pct) / 100 : 0;

      // Use last_sale_date (current from transaction sync) NOT last_order_date (stale)
      // last_sale_date is computed from transactions, last_order_date is from old customer sync
      const lastSaleDate = c.last_sale_date ? new Date(c.last_sale_date) : null;
      const daysSinceLastOrder = lastSaleDate
        ? Math.floor((Date.now() - lastSaleDate.getTime()) / (1000 * 60 * 60 * 24))
        : null;

      // Use first_sale_date to identify "new" customers (first order within 90 days)
      const firstSaleDate = c.first_sale_date ? new Date(c.first_sale_date) : null;
      const daysSinceFirstOrder = firstSaleDate
        ? Math.floor((Date.now() - firstSaleDate.getTime()) / (1000 * 60 * 60 * 24))
        : null;

      // Use DB-computed values - compute_customer_metrics() now correctly computes these from transactions
      const orderCount = c.lifetime_orders || 0;

      // Use DB-computed health_status directly - compute_customer_metrics() computes this correctly
      // from aggregated transaction data (lifetime_orders, ytd_revenue, etc.)
      const healthStatus = (c.health_status as CustomerHealthStatus) || "churned";

      // Use DB-computed segment or compute if not present
      const segment = (c.segment as CustomerSegment) || getCustomerSegment(totalRevenue);

      return {
        ns_customer_id: parseCustomerId(c.ns_customer_id),
        entity_id: c.ns_customer_id?.toString() || "",
        company_name: c.company_name || `Customer ${c.ns_customer_id}`,
        email: null, // Not in current schema
        phone: null, // Not in current schema
        first_sale_date: c.first_sale_date || c.first_order_date, // Prefer transaction-derived date
        last_sale_date: c.last_sale_date, // Use current transaction-derived date
        total_revenue: totalRevenue,
        ytd_revenue: parseFloat(c.ytd_revenue) || 0,
        order_count: orderCount,
        health_status: healthStatus,
        segment: segment,
        avg_order_value: parseFloat(c.avg_order_value) || 0,
        days_since_last_order: daysSinceLastOrder, // Computed dynamically, not from stale DB column
        revenue_trend: yoyChange,
        order_trend: 0, // Not computed in DB
        is_corporate_gifting: c.is_corporate === true, // Uses DB computed column
      };
    });

    // All B2B accounts (excludes corporate gifting only)
    // This is our full recurring book of business - ALL approved B2B accounts
    const allB2BAccounts = customers.filter((c) => !c.is_corporate_gifting);

    // B2B customers with orders (for health metrics, at-risk, growth, etc.)
    // Never-ordered accounts (order_count=0) are sales opportunities shown separately
    const b2bCustomers = allB2BAccounts.filter((c) => c.order_count > 0);

    // Top customers (active in period)
    const topCustomers = customers
      .filter((c) => c.total_revenue > 0)
      .sort((a, b) => b.total_revenue - a.total_revenue)
      .slice(0, 25);

    // At-risk customers (includes churned - UI can filter them) - B2B ONLY
    const atRiskCustomers: WholesaleAtRiskCustomer[] = b2bCustomers
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
        is_corporate_gifting: c.is_corporate_gifting,
      }));

    // Growth opportunities (customers with positive trends) - B2B ONLY
    const growthOpportunities: WholesaleGrowthOpportunity[] = b2bCustomers
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
    // ORDERING ANOMALIES - B2B Wholesale only
    // Excludes corporate gifting (rare repeat customers)
    // Uses median intervals + coefficient of variation for robustness
    // ========================================================================

    // Query transaction-level data to calculate actual intervals per customer
    const { data: intervalData } = await supabase.rpc("get_customer_order_intervals", {
      min_order_count: 4,
    });

    const orderingAnomalies: WholesaleOrderingAnomaly[] = [];

    // Build a map of interval stats from RPC call
    const intervalMap = new Map<number, {
      medianInterval: number;
      meanInterval: number;
      stdDev: number;
    }>();

    if (intervalData) {
      for (const row of intervalData) {
        intervalMap.set(row.ns_customer_id, {
          medianInterval: row.median_interval || 0,
          meanInterval: row.mean_interval || 0,
          stdDev: row.std_dev || 0,
        });
      }
    }

    for (const c of customersResult.data || []) {
      const orderCount = c.lifetime_orders || 0;
      const totalRevenue = parseFloat(c.lifetime_revenue) || 0;
      // Use last_sale_date (current from transaction sync) NOT last_order_date (stale from customer sync)
      const lastSaleDate = c.last_sale_date ? new Date(c.last_sale_date) : null;
      const daysSinceLastOrder = lastSaleDate
        ? Math.floor((now.getTime() - lastSaleDate.getTime()) / (1000 * 60 * 60 * 24))
        : null;
      // Use first_sale_date (current from transaction sync) NOT first_order_date (stale)
      const firstOrderDate = c.first_sale_date ? new Date(c.first_sale_date) : null;
      const lastOrderDate = lastSaleDate; // Use the current date for interval calculations
      const isCorporate = c.is_corporate === true; // Uses DB computed column
      const customerId = parseCustomerId(c.ns_customer_id);

      // Skip corporate gifting - rare repeat customers, not useful for anomaly detection
      if (isCorporate) {
        continue;
      }

      // Skip manually churned customers - user has explicitly marked them as churned
      if (c.is_manually_churned === true) {
        continue;
      }

      // Skip customers without enough data
      if (orderCount < 4 || !firstOrderDate || !lastOrderDate || daysSinceLastOrder === null) {
        continue;
      }

      // Get interval stats (from RPC or fallback to simple calculation)
      let medianInterval: number;
      let coefficientOfVariation: number;

      const stats = intervalMap.get(customerId);
      if (stats && stats.medianInterval > 0) {
        medianInterval = stats.medianInterval;
        // Coefficient of variation = stdDev / mean (lower = more consistent)
        coefficientOfVariation = stats.meanInterval > 0 ? stats.stdDev / stats.meanInterval : 999;
      } else {
        // Fallback to simple mean calculation
        const daysBetweenFirstAndLast = Math.floor(
          (lastOrderDate.getTime() - firstOrderDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        medianInterval = daysBetweenFirstAndLast / (orderCount - 1);
        coefficientOfVariation = 0.5; // Assume moderate variability for fallback
      }

      // Skip if interval is too short (split shipments) or too long (infrequent)
      if (medianInterval < 14 || medianInterval > 180) {
        continue;
      }

      // Skip highly erratic patterns (CV > 1.5 means std dev is 150% of mean)
      // These customers don't have a predictable pattern we can use
      if (coefficientOfVariation > 1.5) {
        continue;
      }

      // Calculate overdue metrics
      const expectedOrderDate = new Date(lastOrderDate.getTime() + medianInterval * 24 * 60 * 60 * 1000);
      const daysOverdue = Math.floor(
        (now.getTime() - expectedOrderDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      const overdueRatio = daysSinceLastOrder / medianInterval;

      // Only include customers who are >20% overdue
      if (overdueRatio <= 1.2) {
        continue;
      }

      const segment = (c.segment as CustomerSegment) || getCustomerSegment(totalRevenue);

      orderingAnomalies.push({
        ns_customer_id: customerId,
        company_name: c.company_name || `Customer ${c.ns_customer_id}`,
        segment,
        total_revenue: totalRevenue,
        order_count: orderCount,
        avg_order_interval_days: Math.round(medianInterval),
        last_order_date: c.last_sale_date, // Use current data from transaction sync
        days_since_last_order: daysSinceLastOrder,
        expected_order_date: expectedOrderDate.toISOString().split("T")[0],
        days_overdue: daysOverdue,
        overdue_ratio: Math.round(overdueRatio * 100) / 100,
        severity: getAnomalySeverity(overdueRatio),
        is_churned: daysSinceLastOrder >= 365,
        is_corporate_gifting: false, // Always false now since we skip corporate
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

    // Never ordered customers - B2B sales opportunities only
    // These are accounts in NetSuite that have never placed an order
    // DB schema: date_created is the NetSuite creation date (when customer was created in NS)
    // Excludes corporate gifting customers - they're one-time buyers, not B2B prospects
    // lifetime_orders is now correctly computed from transactions by compute_customer_metrics()
    const neverOrderedCustomers: WholesaleNeverOrderedCustomer[] = (customersResult.data || [])
      .filter((c) => (c.lifetime_orders || 0) === 0 && c.is_corporate !== true)
      .sort((a, b) => {
        // Sort by date_created (newest first) - these are the hottest leads
        const aDate = a.date_created ? new Date(a.date_created).getTime() : 0;
        const bDate = b.date_created ? new Date(b.date_created).getTime() : 0;
        return bDate - aDate;
      })
      .map((c) => ({
        ns_customer_id: parseCustomerId(c.ns_customer_id),
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

    // Health distribution - B2B ONLY (excludes corporate gifting)
    // Corporate gifting customers inflate "new" and "one_time" categories incorrectly
    const healthDistribution = {
      thriving: b2bCustomers.filter((c) => c.health_status === "thriving").length,
      stable: b2bCustomers.filter((c) => c.health_status === "stable").length,
      declining: b2bCustomers.filter((c) => c.health_status === "declining").length,
      at_risk: b2bCustomers.filter((c) => c.health_status === "at_risk").length,
      churning: b2bCustomers.filter((c) => c.health_status === "churning").length,
      churned: b2bCustomers.filter((c) => c.health_status === "churned").length,
      new: b2bCustomers.filter((c) => c.health_status === "new").length,
      one_time: b2bCustomers.filter((c) => c.health_status === "one_time").length,
    };

    // Customers grouped by health status for drill-down views (sorted by revenue) - B2B ONLY
    const customersByHealth = {
      thriving: b2bCustomers.filter((c) => c.health_status === "thriving").sort((a, b) => b.total_revenue - a.total_revenue),
      stable: b2bCustomers.filter((c) => c.health_status === "stable").sort((a, b) => b.total_revenue - a.total_revenue),
      declining: b2bCustomers.filter((c) => c.health_status === "declining").sort((a, b) => b.total_revenue - a.total_revenue),
      at_risk: b2bCustomers.filter((c) => c.health_status === "at_risk").sort((a, b) => b.total_revenue - a.total_revenue),
      churning: b2bCustomers.filter((c) => c.health_status === "churning").sort((a, b) => b.total_revenue - a.total_revenue),
      churned: b2bCustomers.filter((c) => c.health_status === "churned").sort((a, b) => b.total_revenue - a.total_revenue),
      new: b2bCustomers.filter((c) => c.health_status === "new").sort((a, b) => b.total_revenue - a.total_revenue),
      one_time: b2bCustomers.filter((c) => c.health_status === "one_time").sort((a, b) => b.total_revenue - a.total_revenue),
    };

    // Segment distribution - B2B ONLY
    const segmentDistribution = {
      major: b2bCustomers.filter((c) => c.segment === "major").length,
      large: b2bCustomers.filter((c) => c.segment === "large").length,
      mid: b2bCustomers.filter((c) => c.segment === "mid").length,
      small: b2bCustomers.filter((c) => c.segment === "small").length,
      starter: b2bCustomers.filter((c) => c.segment === "starter").length,
      minimal: b2bCustomers.filter((c) => c.segment === "minimal").length,
    };

    // ========================================================================
    // REVENUE BY BUSINESS TYPE (Corporate vs Standard B2B)
    // Uses the 'category' field from NetSuite to identify corporate customers
    // ========================================================================

    // Build a map of customer_id -> category from the raw customers data
    const customerCategoryMap = new Map<number, string>();
    for (const c of customersResult.data || []) {
      customerCategoryMap.set(parseCustomerId(c.ns_customer_id), c.category || "");
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

      if (category === "Corporate" || category === "4") {
        corporateRevenue += revenue;
        corporateOrderCount++;
        corporateCustomerIds.add(t.ns_customer_id);
      } else {
        standardB2BRevenue += revenue;
        standardB2BOrderCount++;
        standardB2BCustomerIds.add(t.ns_customer_id);
      }
    }

    // Calculate previous period B2B-only metrics for AOV YoY comparison
    // EXCLUDES corporate gifting - same logic as current period
    let prevStandardB2BRevenue = 0;
    let prevStandardB2BOrderCount = 0;
    for (const t of prevTransactionsResult.data || []) {
      const category = customerCategoryMap.get(t.ns_customer_id);
      const revenue = parseFloat(t.foreign_total) || 0;
      // Skip corporate customers
      if (category !== "Corporate" && category !== "4") {
        prevStandardB2BRevenue += revenue;
        prevStandardB2BOrderCount++;
      }
    }

    // Calculate B2B-only AOV (excludes corporate)
    const currentB2BAOV = standardB2BOrderCount > 0 ? standardB2BRevenue / standardB2BOrderCount : 0;
    const prevB2BAOV = prevStandardB2BOrderCount > 0 ? prevStandardB2BRevenue / prevStandardB2BOrderCount : 0;

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
      total_customers: allB2BAccounts.length, // All approved B2B accounts (excludes corporate)
      active_customers: currentPeriodCustomers,
      // AOV uses B2B-only data (excludes corporate) for accurate comparison
      avg_order_value: currentB2BAOV,
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
      // AOV YoY comparison (B2B-only, excludes corporate)
      avg_order_value_delta: currentB2BAOV - prevB2BAOV,
      avg_order_value_delta_pct:
        prevB2BAOV > 0
          ? ((currentB2BAOV - prevB2BAOV) / prevB2BAOV) * 100
          : 0,
      prev_avg_order_value: prevB2BAOV,
      health_distribution: healthDistribution,
      segment_distribution: segmentDistribution,
      revenue_by_type: revenueByType,
    };

    // Corporate customers - ALL corporate gifting accounts (including $0 revenue)
    // Sorted by YTD revenue descending
    const corporateCustomers: WholesaleCustomer[] = customers
      .filter((c) => c.is_corporate_gifting) // Uses DB computed column
      .sort((a, b) => b.ytd_revenue - a.ytd_revenue);

    // Churned customers - 365+ days since last order - B2B ONLY
    // Returns ALL churned customers (no limit) - UI handles scrolling
    const churnedCustomers: WholesaleCustomer[] = b2bCustomers
      .filter((c) =>
        c.health_status === "churned" &&
        c.segment !== "major" && // Exclude major accounts like Crate & Barrel
        c.order_count > 0 // Must have ordered at some point
      )
      .sort((a, b) => b.total_revenue - a.total_revenue); // Highest value first - these are win-back opportunities

    // ========================================================================
    // NEW CUSTOMER ACQUISITION - TRAILING 365 DAYS (T365)
    // Compare new customers acquired in last 365 days vs prior 365 days (period-over-period)
    // IMPORTANT: We derive "first order date" from the transactions table,
    // NOT from ns_wholesale_customers.first_order_date (which is incomplete)
    // EXCLUDES: Corporate gifting customers (not recurring B2B accounts)
    // ========================================================================
    let newCustomerAcquisition: WholesaleNewCustomerAcquisition | null = null;
    const partialErrors: { section: string; message: string }[] = [];
    // Set to track T365 (trailing 365 days) new customer IDs (populated inside try block, used for table after)
    const t365NewCustomerIds = new Set<number>();
    // Map to store transaction-derived first order dates for new customers
    // This ensures we use ACTUAL first order dates, not stale/null DB values
    const t365NewCustomerFirstOrders = new Map<number, string>();

    // Build set of corporate customer IDs to exclude from YoY calculation
    // Uses DB computed column `is_corporate` (non-recurring gifting accounts, not part of B2B book)
    const corporateGiftingIds = new Set<number>();
    for (const c of customersResult.data || []) {
      if (c.is_corporate === true) {
        corporateGiftingIds.add(parseCustomerId(c.ns_customer_id));
      }
    }

    try {
      // Current T365 period (trailing 365 days / 1 year)
      const t365End = now;
      const t365Start = new Date(now);
      t365Start.setDate(t365Start.getDate() - 365);
      t365Start.setHours(0, 0, 0, 0); // Start of day 365 days ago

      // Prior T365 period (365-730 days ago, for period-over-period comparison)
      const priorT365End = new Date(t365Start);
      priorT365End.setMilliseconds(-1); // Just before t365Start
      const priorT365Start = new Date(priorT365End);
      priorT365Start.setDate(priorT365Start.getDate() - 365);
      priorT365Start.setHours(0, 0, 0, 0);

      // Get customer names lookup from customers table
      const customerNamesMap = new Map<number, string>();
      for (const c of customersResult.data || []) {
        customerNamesMap.set(parseCustomerId(c.ns_customer_id), c.company_name || `Customer ${c.ns_customer_id}`);
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
      // Build map of each customer's total revenue in current T365 period (last 365 days)
      const customerCurrentT365Revenue = new Map<number, number>();
      // Build map of each customer's total revenue in prior T365 period (365-730 days ago)
      const customerPriorT365Revenue = new Map<number, number>();

      for (const txn of allTxns || []) {
        // Skip corporate gifting customers - they're not part of recurring B2B book of business
        if (corporateGiftingIds.has(txn.ns_customer_id)) {
          continue;
        }

        const txnDate = new Date(txn.tran_date);
        const revenue = parseFloat(txn.foreign_total) || 0;

        // Track first transaction date (for "new" status)
        if (!customerFirstTxn.has(txn.ns_customer_id)) {
          customerFirstTxn.set(txn.ns_customer_id, { date: txn.tran_date });
        }

        // Accumulate current T365 revenue (last 365 days)
        if (txnDate >= t365Start && txnDate <= t365End) {
          customerCurrentT365Revenue.set(
            txn.ns_customer_id,
            (customerCurrentT365Revenue.get(txn.ns_customer_id) || 0) + revenue
          );
        }

        // Accumulate prior T365 revenue (365-730 days ago)
        if (txnDate >= priorT365Start && txnDate <= priorT365End) {
          customerPriorT365Revenue.set(
            txn.ns_customer_id,
            (customerPriorT365Revenue.get(txn.ns_customer_id) || 0) + revenue
          );
        }
      }

      // Find NEW customers in current T365 (first transaction ever is in the last 365 days)
      // Revenue = their TOTAL T365 revenue, not just first order
      const currentNewCustomers = new Map<number, { revenue: number; firstOrderDate: string; companyName: string }>();
      for (const [customerId, firstTxn] of customerFirstTxn) {
        const firstDate = new Date(firstTxn.date);
        if (firstDate >= t365Start && firstDate <= t365End) {
          currentNewCustomers.set(customerId, {
            revenue: customerCurrentT365Revenue.get(customerId) || 0,
            firstOrderDate: firstTxn.date,
            companyName: customerNamesMap.get(customerId) || `Customer ${customerId}`,
          });
          // Populate external Set/Map for newCustomers table (outside try block)
          t365NewCustomerIds.add(customerId);
          t365NewCustomerFirstOrders.set(customerId, firstTxn.date);
        }
      }

      const currentNewCustomerCount = currentNewCustomers.size;
      const currentTotalRevenue = Array.from(currentNewCustomers.values())
        .reduce((sum, o) => sum + o.revenue, 0);
      const currentAvgOrderValue = currentNewCustomerCount > 0
        ? currentTotalRevenue / currentNewCustomerCount
        : 0;

      // Find NEW customers in prior T365 (first transaction ever is 365-730 days ago)
      // Revenue = their TOTAL prior T365 revenue, not just first order
      const priorNewCustomers = new Map<number, { revenue: number; firstOrderDate: string; companyName: string }>();
      for (const [customerId, firstTxn] of customerFirstTxn) {
        const firstDate = new Date(firstTxn.date);
        if (firstDate >= priorT365Start && firstDate <= priorT365End) {
          priorNewCustomers.set(customerId, {
            revenue: customerPriorT365Revenue.get(customerId) || 0,
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
          startDate: formatDate(t365Start),
          endDate: formatDate(t365End),
          newCustomerCount: currentNewCustomerCount,
          totalRevenue: Math.round(currentTotalRevenue),
          avgOrderValue: Math.round(currentAvgOrderValue),
        },
        priorPeriod: {
          startDate: formatDate(priorT365Start),
          endDate: formatDate(priorT365End),
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

    // Warn if transaction-derived first order dates are unavailable
    // This means we'll fall back to potentially stale/null DB values for first_sale_date
    if (t365NewCustomerFirstOrders.size === 0 && t365NewCustomerIds.size > 0) {
      console.warn(
        `[WHOLESALE API] Transaction-derived first order dates unavailable for ${t365NewCustomerIds.size} new customers. ` +
        `Falling back to DB first_sale_date values (may be null/stale). Check T365 calculation errors above.`
      );
    }

    // New customers - all customers acquired in the last 365 days (T365)
    // Uses t365NewCustomerIds which identifies customers whose first-ever order was in the last 365 days
    // Excludes $0 revenue customers (likely cash sales or returns that don't count as real customers)
    // IMPORTANT: Override first_sale_date with transaction-derived date (DB value may be null/stale)
    const newCustomers: WholesaleCustomer[] = b2bCustomers
      .filter((c) => t365NewCustomerIds.has(c.ns_customer_id) && (c.total_revenue || 0) > 0)
      .map((c) => ({
        ...c,
        // Use transaction-derived first order date, falling back to DB value
        first_sale_date: t365NewCustomerFirstOrders.get(c.ns_customer_id) || c.first_sale_date,
      }))
      .sort((a, b) => {
        // Sort by first order date (most recent first) - now guaranteed to have data
        const aDate = a.first_sale_date ? new Date(a.first_sale_date).getTime() : 0;
        const bDate = b.first_sale_date ? new Date(b.first_sale_date).getTime() : 0;
        return bDate - aDate;
      });

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
      corporateCustomers,
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
