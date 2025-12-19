/**
 * Ecommerce Analytics API
 * Returns comprehensive analytics data for the Ecommerce dashboard
 *
 * Uses database-side aggregation for performance (handles 100K+ orders)
 * Supports periods: mtd, last_month, qtd, ytd, 30d, 90d, 12m
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type AnalyticsPeriod = "mtd" | "last_month" | "qtd" | "ytd" | "30d" | "90d" | "12m";

interface DateRange {
  start: Date;
  end: Date;
  priorStart: Date;
  priorEnd: Date;
}

function getDateRange(period: AnalyticsPeriod): DateRange {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  let start: Date;
  let priorStart: Date;
  let priorEnd: Date;

  switch (period) {
    case "mtd": {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      priorStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      priorEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      break;
    }
    case "last_month": {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDayOfPriorMonth = new Date(now.getFullYear(), now.getMonth(), 0);
      end.setTime(lastDayOfPriorMonth.getTime());
      end.setHours(23, 59, 59, 999);
      priorStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      priorEnd = new Date(now.getFullYear(), now.getMonth() - 1, 0);
      break;
    }
    case "qtd": {
      const quarter = Math.floor(now.getMonth() / 3);
      start = new Date(now.getFullYear(), quarter * 3, 1);
      priorStart = new Date(now.getFullYear(), (quarter - 1) * 3, 1);
      priorEnd = new Date(now.getFullYear(), quarter * 3, 0);
      break;
    }
    case "ytd": {
      start = new Date(now.getFullYear(), 0, 1);
      priorStart = new Date(now.getFullYear() - 1, 0, 1);
      priorEnd = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      break;
    }
    case "30d": {
      start = new Date(now);
      start.setDate(start.getDate() - 30);
      priorStart = new Date(start);
      priorStart.setDate(priorStart.getDate() - 30);
      priorEnd = new Date(start);
      priorEnd.setDate(priorEnd.getDate() - 1);
      break;
    }
    case "90d": {
      start = new Date(now);
      start.setDate(start.getDate() - 90);
      priorStart = new Date(start);
      priorStart.setDate(priorStart.getDate() - 90);
      priorEnd = new Date(start);
      priorEnd.setDate(priorEnd.getDate() - 1);
      break;
    }
    case "12m": {
      start = new Date(now);
      start.setFullYear(start.getFullYear() - 1);
      priorStart = new Date(start);
      priorStart.setFullYear(priorStart.getFullYear() - 1);
      priorEnd = new Date(start);
      priorEnd.setDate(priorEnd.getDate() - 1);
      break;
    }
  }

  start.setHours(0, 0, 0, 0);
  priorStart.setHours(0, 0, 0, 0);
  priorEnd.setHours(23, 59, 59, 999);

  return { start, end, priorStart, priorEnd };
}

function pctChange(current: number, prior: number): number {
  if (prior === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - prior) / prior) * 1000) / 10;
}

// Database aggregation query for order summary
async function getOrderSummary(
  supabase: ReturnType<typeof createServiceClient>,
  startDate: string,
  endDate: string
): Promise<{ totalOrders: number; totalRevenue: number; avgOrderValue: number; totalDiscounts: number; ordersWithDiscount: number }> {
  const { data, error } = await supabase.rpc("get_order_analytics_summary", {
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error) {
    console.error("[ANALYTICS] RPC error, falling back to direct query:", error.message);
    // Fallback to direct SQL if RPC doesn't exist
    const { data: fallbackData } = await supabase
      .from("orders")
      .select("total_price, total_discounts")
      .gte("created_at", startDate)
      .lte("created_at", endDate)
      .eq("canceled", false)
      .not("total_price", "is", null)
      .limit(50000); // Safety limit

    const orders = fallbackData || [];
    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((sum, o) => sum + (parseFloat(String(o.total_price)) || 0), 0);
    const totalDiscounts = orders.reduce((sum, o) => sum + (parseFloat(String(o.total_discounts)) || 0), 0);
    const ordersWithDiscount = orders.filter(o => (parseFloat(String(o.total_discounts)) || 0) > 0).length;

    return {
      totalOrders,
      totalRevenue,
      avgOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
      totalDiscounts,
      ordersWithDiscount,
    };
  }

  const result = data?.[0] || {};
  return {
    totalOrders: result.total_orders || 0,
    totalRevenue: parseFloat(result.total_revenue) || 0,
    avgOrderValue: parseFloat(result.avg_order_value) || 0,
    totalDiscounts: parseFloat(result.total_discounts) || 0,
    ordersWithDiscount: result.orders_with_discount || 0,
  };
}

// Get new vs returning customer breakdown
async function getNewVsReturning(
  supabase: ReturnType<typeof createServiceClient>,
  startDate: string,
  endDate: string
): Promise<{ newRevenue: number; returningRevenue: number; newCount: number; returningCount: number }> {
  const { data, error } = await supabase.rpc("get_new_vs_returning_analytics", {
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error) {
    console.error("[ANALYTICS] New vs returning RPC error, falling back:", error.message);
    // Fallback
    const { data: orders } = await supabase
      .from("orders")
      .select("total_price, shopify_customer_id, is_first_order")
      .gte("created_at", startDate)
      .lte("created_at", endDate)
      .eq("canceled", false)
      .not("total_price", "is", null)
      .limit(50000);

    const orderList = orders || [];
    const newOrders = orderList.filter(o => o.is_first_order === true);
    const returningOrders = orderList.filter(o => o.is_first_order === false && o.shopify_customer_id);

    return {
      newRevenue: newOrders.reduce((sum, o) => sum + (parseFloat(String(o.total_price)) || 0), 0),
      returningRevenue: returningOrders.reduce((sum, o) => sum + (parseFloat(String(o.total_price)) || 0), 0),
      newCount: new Set(newOrders.map(o => o.shopify_customer_id).filter(Boolean)).size,
      returningCount: new Set(returningOrders.map(o => o.shopify_customer_id).filter(Boolean)).size,
    };
  }

  const result = data?.[0] || {};
  return {
    newRevenue: parseFloat(result.new_revenue) || 0,
    returningRevenue: parseFloat(result.returning_revenue) || 0,
    newCount: result.new_customer_count || 0,
    returningCount: result.returning_customer_count || 0,
  };
}

// US State code to name mapping
const US_STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia",
};

interface TopStateResult {
  provinceCode: string;
  provinceName: string;
  countryCode: string;
  orderCount: number;
  totalRevenue: number;
  uniqueCustomers: number;
  avgOrderValue: number;
}

// Get top states by revenue
async function getTopStates(
  supabase: ReturnType<typeof createServiceClient>,
  startDate: string,
  endDate: string
): Promise<TopStateResult[]> {
  const { data, error } = await supabase.rpc("get_geographic_analytics", {
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error) {
    console.error("[ANALYTICS] Geographic RPC error, falling back:", error.message);
    // Fallback: sample query with customer counts
    const { data: orders } = await supabase
      .from("orders")
      .select("shipping_province_code, total_price, shopify_customer_id")
      .gte("created_at", startDate)
      .lte("created_at", endDate)
      .eq("canceled", false)
      .eq("shipping_country_code", "US")
      .not("shipping_province_code", "is", null)
      .not("total_price", "is", null)
      .limit(50000);

    const geoAgg = new Map<string, { revenue: number; count: number; customers: Set<string> }>();
    for (const o of orders || []) {
      const state = o.shipping_province_code;
      if (state) {
        const existing = geoAgg.get(state) || { revenue: 0, count: 0, customers: new Set() };
        existing.revenue += parseFloat(String(o.total_price)) || 0;
        existing.count++;
        if (o.shopify_customer_id) existing.customers.add(o.shopify_customer_id);
        geoAgg.set(state, existing);
      }
    }

    return Array.from(geoAgg.entries())
      .map(([state, stats]) => ({
        provinceCode: state,
        provinceName: US_STATE_NAMES[state] || state,
        countryCode: "US",
        orderCount: stats.count,
        totalRevenue: Math.round(stats.revenue * 100) / 100,
        uniqueCustomers: stats.customers.size,
        avgOrderValue: stats.count > 0 ? Math.round((stats.revenue / stats.count) * 100) / 100 : 0,
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue);
  }

  return (data || []).map((r: { province_code: string; revenue: string; order_count: number; unique_customers: number }) => {
    const revenue = parseFloat(r.revenue) || 0;
    const orderCount = r.order_count || 0;
    return {
      provinceCode: r.province_code,
      provinceName: US_STATE_NAMES[r.province_code] || r.province_code,
      countryCode: "US",
      orderCount,
      totalRevenue: Math.round(revenue * 100) / 100,
      uniqueCustomers: r.unique_customers || 0,
      avgOrderValue: orderCount > 0 ? Math.round((revenue / orderCount) * 100) / 100 : 0,
    };
  });
}

// Get monthly revenue trends (new vs returning)
interface MonthlyTrend {
  month: string;
  newCustomerRevenue: number;
  returningCustomerRevenue: number;
  newCustomers: number;
  returningCustomers: number;
}

async function getMonthlyRevenueTrends(
  supabase: ReturnType<typeof createServiceClient>,
  startDate: string,
  endDate: string
): Promise<MonthlyTrend[]> {
  const { data, error } = await supabase.rpc("get_monthly_revenue_trends", {
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error) {
    console.error("[ANALYTICS] Monthly trends RPC error:", error.message);
    return [];
  }

  return (data || []).map((r: { month: string; new_customer_revenue: string; returning_customer_revenue: string; new_customers: number; returning_customers: number }) => ({
    month: r.month,
    newCustomerRevenue: Math.round(parseFloat(r.new_customer_revenue) * 100) / 100,
    returningCustomerRevenue: Math.round(parseFloat(r.returning_customer_revenue) * 100) / 100,
    newCustomers: r.new_customers || 0,
    returningCustomers: r.returning_customers || 0,
  }));
}

// Get AOV split by discount status
interface AOVSplit {
  discountedAOV: number;
  nonDiscountedAOV: number;
  discountedOrderCount: number;
  nonDiscountedOrderCount: number;
}

async function getAOVByDiscountStatus(
  supabase: ReturnType<typeof createServiceClient>,
  startDate: string,
  endDate: string
): Promise<AOVSplit> {
  const { data, error } = await supabase.rpc("get_aov_by_discount_status", {
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error) {
    console.error("[ANALYTICS] AOV split RPC error:", error.message);
    return {
      discountedAOV: 0,
      nonDiscountedAOV: 0,
      discountedOrderCount: 0,
      nonDiscountedOrderCount: 0,
    };
  }

  const row = data?.[0] || {};
  return {
    discountedAOV: Math.round(parseFloat(row.discounted_aov) * 100) / 100 || 0,
    nonDiscountedAOV: Math.round(parseFloat(row.non_discounted_aov) * 100) / 100 || 0,
    discountedOrderCount: row.discounted_order_count || 0,
    nonDiscountedOrderCount: row.non_discounted_order_count || 0,
  };
}

// Get top discount codes
async function getTopDiscountCodes(
  supabase: ReturnType<typeof createServiceClient>,
  startDate: string,
  endDate: string
): Promise<Array<{ code: string; usageCount: number; totalRevenue: number; totalDiscount: number; avgOrderValue: number }>> {
  const { data, error } = await supabase.rpc("get_discount_code_analytics", {
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error) {
    console.error("[ANALYTICS] Discount code RPC error, falling back:", error.message);
    // Fallback: sample orders with discount codes
    const { data: orders } = await supabase
      .from("orders")
      .select("total_price, discount_codes")
      .gte("created_at", startDate)
      .lte("created_at", endDate)
      .eq("canceled", false)
      .not("discount_codes", "is", null)
      .limit(10000);

    const codeUsage = new Map<string, { count: number; revenue: number; discount: number }>();
    for (const order of orders || []) {
      if (order.discount_codes && Array.isArray(order.discount_codes)) {
        for (const dc of order.discount_codes as Array<{ code: string; amount: string }>) {
          const code = dc.code;
          const existing = codeUsage.get(code) || { count: 0, revenue: 0, discount: 0 };
          existing.count++;
          existing.revenue += parseFloat(String(order.total_price)) || 0;
          existing.discount += parseFloat(String(dc.amount)) || 0;
          codeUsage.set(code, existing);
        }
      }
    }

    return Array.from(codeUsage.entries())
      .map(([code, stats]) => ({
        code,
        usageCount: stats.count,
        totalRevenue: Math.round(stats.revenue * 100) / 100,
        totalDiscount: Math.round(stats.discount * 100) / 100,
        avgOrderValue: stats.count > 0 ? Math.round((stats.revenue / stats.count) * 100) / 100 : 0,
      }))
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 10);
  }

  return (data || []).map((r: { code: string; usage_count: number; total_revenue: string; total_discount: string }) => ({
    code: r.code,
    usageCount: r.usage_count || 0,
    totalRevenue: parseFloat(r.total_revenue) || 0,
    totalDiscount: parseFloat(r.total_discount) || 0,
    avgOrderValue: r.usage_count > 0 ? Math.round((parseFloat(r.total_revenue) / r.usage_count) * 100) / 100 : 0,
  }));
}

// Get customer LTV metrics and segment data using database aggregation
interface LTVMetrics {
  avgLTV: number;
  repeatPurchaseRate: number;
  segments: Record<string, { count: number; revenue: number; avgLTV: number }>;
}

async function getCustomerLTVMetrics(
  supabase: ReturnType<typeof createServiceClient>
): Promise<LTVMetrics> {
  const { data, error } = await supabase.rpc("get_customer_ltv_metrics");

  if (error) {
    console.error("[ANALYTICS] LTV metrics RPC error:", error.message);
    // Return zeros if function doesn't exist
    return {
      avgLTV: 0,
      repeatPurchaseRate: 0,
      segments: {
        new: { count: 0, revenue: 0, avgLTV: 0 },
        active: { count: 0, revenue: 0, avgLTV: 0 },
        at_risk: { count: 0, revenue: 0, avgLTV: 0 },
        churned: { count: 0, revenue: 0, avgLTV: 0 },
        vip: { count: 0, revenue: 0, avgLTV: 0 },
      },
    };
  }

  const row = data?.[0] || {};
  return {
    avgLTV: Math.round(parseFloat(row.avg_ltv) || 0),
    repeatPurchaseRate: Math.round((parseFloat(row.repeat_purchase_rate) || 0) * 10) / 10,
    segments: {
      new: {
        count: row.segment_new_count || 0,
        revenue: 0,
        avgLTV: Math.round(parseFloat(row.segment_new_ltv) || 0),
      },
      active: {
        count: row.segment_active_count || 0,
        revenue: 0,
        avgLTV: Math.round(parseFloat(row.segment_active_ltv) || 0),
      },
      at_risk: {
        count: row.segment_at_risk_count || 0,
        revenue: 0,
        avgLTV: Math.round(parseFloat(row.segment_at_risk_ltv) || 0),
      },
      churned: {
        count: row.segment_churned_count || 0,
        revenue: 0,
        avgLTV: Math.round(parseFloat(row.segment_churned_ltv) || 0),
      },
      vip: {
        count: row.segment_vip_count || 0,
        revenue: 0,
        avgLTV: Math.round(parseFloat(row.segment_vip_ltv) || 0),
      },
    },
  };
}

// Get session metrics from Fathom/GA data
interface SessionMetrics {
  currentMonth: {
    webSessions: number;
    webOrders: number;
    conversionRate: number;
    newCustomers: number;
    newCustomerRevenue: number;
    newCustomerAOV: number;
    returningCustomers: number;
    returningCustomerRevenue: number;
    returningCustomerAOV: number;
  } | null;
  priorMonth: {
    webSessions: number;
    webOrders: number;
    conversionRate: number;
  } | null;
  ytd: {
    totalSessions: number;
    totalOrders: number;
    avgConversionRate: number;
    priorYearSessions: number;
    priorYearOrders: number;
  };
  monthlyTrends: Array<{
    month: string;
    webSessions: number;
    webOrders: number;
    conversionRate: number;
    priorYearSessions: number;
    priorYearOrders: number;
    priorYearConversion: number;
  }>;
}

async function getSessionMetrics(
  supabase: ReturnType<typeof createServiceClient>
): Promise<SessionMetrics> {
  const now = new Date();
  const currentYear = now.getFullYear();
  const priorYear = currentYear - 1;
  const currentYearStart = `${currentYear}-01-01`;
  const currentYearEnd = `${currentYear}-12-31`;
  const priorYearStart = `${priorYear}-01-01`;
  const priorYearEnd = `${priorYear}-12-31`;

  // Fetch current year and prior year data in parallel
  const [currentYearData, priorYearData] = await Promise.all([
    supabase
      .from("session_metrics")
      .select("month, web_sessions, web_orders, conversion_rate, new_customers, returning_customers, new_customer_aov, returning_customer_aov")
      .gte("month", currentYearStart)
      .lte("month", currentYearEnd)
      .order("month", { ascending: true }),
    supabase
      .from("session_metrics")
      .select("month, web_sessions, web_orders, conversion_rate")
      .gte("month", priorYearStart)
      .lte("month", priorYearEnd)
      .order("month", { ascending: true }),
  ]);

  const currentYearRecords = currentYearData.data || [];
  const priorYearRecords = priorYearData.data || [];

  // Helper to extract month number from "YYYY-MM-DD" without timezone issues
  const getMonthFromDateStr = (dateStr: string): number => {
    const [, monthStr] = dateStr.split('-');
    return parseInt(monthStr, 10);
  };

  // Build prior year lookup by month number (1-12)
  const priorYearByMonth: Record<number, { webSessions: number; webOrders: number; conversionRate: number }> = {};
  for (const r of priorYearRecords) {
    const monthNum = getMonthFromDateStr(r.month);
    priorYearByMonth[monthNum] = {
      webSessions: r.web_sessions || 0,
      webOrders: r.web_orders || 0,
      conversionRate: parseFloat(r.conversion_rate) || 0,
    };
  }

  // Build monthly trends with YoY comparison
  const monthlyTrends = currentYearRecords.map(r => {
    const monthNum = getMonthFromDateStr(r.month);
    const priorYearMonth = priorYearByMonth[monthNum];
    return {
      month: r.month,
      webSessions: r.web_sessions || 0,
      webOrders: r.web_orders || 0,
      conversionRate: parseFloat(r.conversion_rate) || 0,
      priorYearSessions: priorYearMonth?.webSessions || 0,
      priorYearOrders: priorYearMonth?.webOrders || 0,
      priorYearConversion: priorYearMonth?.conversionRate || 0,
    };
  });

  // Calculate YTD totals
  const ytdTotalSessions = currentYearRecords.reduce((sum, r) => sum + (r.web_sessions || 0), 0);
  const ytdTotalOrders = currentYearRecords.reduce((sum, r) => sum + (r.web_orders || 0), 0);
  const ytdAvgConversion = ytdTotalSessions > 0 ? ytdTotalOrders / ytdTotalSessions : 0;

  // Helper to extract year and month from "YYYY-MM-DD"
  const getYearMonthFromDateStr = (dateStr: string): { year: number; month: number } => {
    const [yearStr, monthStr] = dateStr.split('-');
    return { year: parseInt(yearStr, 10), month: parseInt(monthStr, 10) };
  };

  // Prior year YTD totals - compare ONLY months that exist in current year data
  // This fixes the bug where Dec 2024 was included but Dec 2025 wasn't imported yet
  const currentYearMonths = new Set(currentYearRecords.map(r => getMonthFromDateStr(r.month)));
  const maxCurrentYearMonth = Math.max(...Array.from(currentYearMonths));
  const priorYtdRecords = priorYearRecords.filter(r => getMonthFromDateStr(r.month) <= maxCurrentYearMonth);
  const priorYtdSessions = priorYtdRecords.reduce((sum, r) => sum + (r.web_sessions || 0), 0);
  const priorYtdOrders = priorYtdRecords.reduce((sum, r) => sum + (r.web_orders || 0), 0);

  // Get current month data
  const currentMonthNum = now.getMonth() + 1;
  const currentMonthRecord = currentYearRecords.find(r => {
    const { year, month } = getYearMonthFromDateStr(r.month);
    return month === currentMonthNum && year === now.getFullYear();
  });

  const currentMonth = currentMonthRecord ? {
    webSessions: currentMonthRecord.web_sessions || 0,
    webOrders: currentMonthRecord.web_orders || 0,
    conversionRate: parseFloat(currentMonthRecord.conversion_rate) || 0,
    newCustomers: currentMonthRecord.new_customers || 0,
    newCustomerRevenue: 0,
    newCustomerAOV: parseFloat(currentMonthRecord.new_customer_aov) || 0,
    returningCustomers: currentMonthRecord.returning_customers || 0,
    returningCustomerRevenue: 0,
    returningCustomerAOV: parseFloat(currentMonthRecord.returning_customer_aov) || 0,
  } : null;

  // Get prior month for MoM comparison
  const priorMonthNum = now.getMonth(); // 0-indexed, so current month - 1
  const priorMonthYear = priorMonthNum === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const priorMonthNumAdjusted = priorMonthNum === 0 ? 12 : priorMonthNum;

  const priorMonthRecord = currentYearRecords.find(r => {
    const { year, month } = getYearMonthFromDateStr(r.month);
    return month === priorMonthNumAdjusted && year === priorMonthYear;
  });

  const priorMonth = priorMonthRecord ? {
    webSessions: priorMonthRecord.web_sessions || 0,
    webOrders: priorMonthRecord.web_orders || 0,
    conversionRate: parseFloat(priorMonthRecord.conversion_rate) || 0,
  } : null;

  return {
    currentMonth,
    priorMonth,
    ytd: {
      totalSessions: ytdTotalSessions,
      totalOrders: ytdTotalOrders,
      avgConversionRate: ytdAvgConversion,
      priorYearSessions: priorYtdSessions,
      priorYearOrders: priorYtdOrders,
    },
    monthlyTrends,
  };
}

// Get abandoned checkout metrics
interface AbandonedCheckoutMetrics {
  total: number;
  totalValue: number;
  recovered: number;
  recoveryRate: number;
  avgCartValue: number;
}

async function getAbandonedCheckouts(
  supabase: ReturnType<typeof createServiceClient>,
  startDate: string,
  endDate: string
): Promise<AbandonedCheckoutMetrics> {
  const { data, error } = await supabase
    .from("abandoned_checkouts")
    .select("id, subtotal_price, recovered_order_id")
    .gte("created_at", startDate)
    .lte("created_at", endDate);

  if (error) {
    console.error("[ANALYTICS] Abandoned checkouts error:", error.message);
    return { total: 0, totalValue: 0, recovered: 0, recoveryRate: 0, avgCartValue: 0 };
  }

  const checkouts = data || [];
  const total = checkouts.length;
  const totalValue = checkouts.reduce((sum, c) => sum + (parseFloat(String(c.subtotal_price)) || 0), 0);
  const recovered = checkouts.filter(c => c.recovered_order_id != null).length;
  const recoveryRate = total > 0 ? Math.round((recovered / total) * 1000) / 10 : 0;
  const avgCartValue = total > 0 ? Math.round(totalValue / total) : 0;

  return { total, totalValue, recovered, recoveryRate, avgCartValue };
}

/**
 * Customer Segments - Smithey-Specific Thresholds
 *
 * Based on actual Smithey repurchase data analysis (Dec 2024):
 * - 74% of customers who return do so within 180 days
 * - 90% return within 365 days
 * - 97% return within 545 days (18 months)
 * - Avg days between orders for 2-order customers: 245 days (~8 months)
 *
 * These thresholds are calibrated for durable goods (cast iron cookware),
 * NOT typical e-commerce 90/180 day cycles.
 */
interface CustomerSegment {
  count: number;
  revenue: number;
  avgLTV: number;
  avgOrders: number;
  definition: string;
}

interface CustomerSegmentsData {
  new: CustomerSegment;
  active: CustomerSegment;
  at_risk: CustomerSegment;
  churned: CustomerSegment;
  vip: CustomerSegment;
  total: number;
}

// Smithey-specific thresholds based on actual data analysis (Dec 2025)
// See docs/customer-segmentation-analysis.md for methodology
const SEGMENT_THRESHOLDS = {
  // First order within 180 days, single order = still in conversion window
  // 64% of eventual repeat buyers convert by 180 days
  NEW_WINDOW_DAYS: 180,
  // 2+ orders within 365 days = engaged collector
  // 80% of repeat buyers have returned by 365 days
  ACTIVE_WINDOW_DAYS: 365,
  // 366-545 days = re-engagement opportunity
  // 87% of repeat buyers have returned by 545 days; remaining 13% not worth chasing
  SLEEPING_WINDOW_DAYS: 545,
  // VIP threshold = 95th percentile (~$1,000 net revenue)
  // Top 5.2% of customers, 24.5% of revenue
  VIP_LTV_THRESHOLD: 1000,
} as const;

async function getCustomerSegmentsDirect(
  supabase: ReturnType<typeof createServiceClient>
): Promise<CustomerSegmentsData> {
  const defaults: CustomerSegment = { count: 0, revenue: 0, avgLTV: 0, avgOrders: 0, definition: "" };
  const emptyResult: CustomerSegmentsData = {
    new: { ...defaults, definition: `Single purchase within last ${SEGMENT_THRESHOLDS.NEW_WINDOW_DAYS} days` },
    active: { ...defaults, definition: `Repeat buyer (2+), last order within ${SEGMENT_THRESHOLDS.ACTIVE_WINDOW_DAYS} days` },
    at_risk: { ...defaults, definition: `Unconverted (1 order, ${SEGMENT_THRESHOLDS.NEW_WINDOW_DAYS + 1}-${SEGMENT_THRESHOLDS.SLEEPING_WINDOW_DAYS}d) OR dormant repeat (${SEGMENT_THRESHOLDS.ACTIVE_WINDOW_DAYS + 1}-${SEGMENT_THRESHOLDS.SLEEPING_WINDOW_DAYS}d)` },
    churned: { ...defaults, definition: `${SEGMENT_THRESHOLDS.SLEEPING_WINDOW_DAYS}+ days since last order` },
    vip: { ...defaults, definition: `$${SEGMENT_THRESHOLDS.VIP_LTV_THRESHOLD}+ lifetime spend` },
    total: 0,
  };

  // Use RPC for efficient DB-side aggregation (handles 235K+ customers)
  const { data, error } = await supabase.rpc('get_customer_segments');

  if (error) {
    console.error("[ANALYTICS] Customer segments RPC error:", error.message);
    return emptyResult;
  }

  if (!data) {
    console.warn("[ANALYTICS] Customer segments RPC returned no data");
    return emptyResult;
  }

  // Map RPC response to CustomerSegmentsData format
  // RPC returns: { new: {...}, active: {...}, at_risk: {...}, churned: {...}, vip: {...}, total: number }
  const rpcData = data as Record<string, unknown>;

  // Segment definitions (type-safe, separate from emptyResult to avoid union type issues)
  const segmentDefinitions: Record<string, string> = {
    new: `Single purchase within last ${SEGMENT_THRESHOLDS.NEW_WINDOW_DAYS} days`,
    active: `Repeat buyer (2+), last order within ${SEGMENT_THRESHOLDS.ACTIVE_WINDOW_DAYS} days`,
    at_risk: `Unconverted (1 order, ${SEGMENT_THRESHOLDS.NEW_WINDOW_DAYS + 1}-${SEGMENT_THRESHOLDS.SLEEPING_WINDOW_DAYS}d) OR dormant repeat (${SEGMENT_THRESHOLDS.ACTIVE_WINDOW_DAYS + 1}-${SEGMENT_THRESHOLDS.SLEEPING_WINDOW_DAYS}d)`,
    churned: `${SEGMENT_THRESHOLDS.SLEEPING_WINDOW_DAYS}+ days since last order`,
    vip: `$${SEGMENT_THRESHOLDS.VIP_LTV_THRESHOLD.toLocaleString()}+ lifetime spend`,
  };

  const mapSegment = (key: string): CustomerSegment => {
    const seg = rpcData[key] as Record<string, unknown> | undefined;
    const definition = segmentDefinitions[key] || '';
    if (!seg) return { ...defaults, definition };
    return {
      count: Number(seg.count) || 0,
      revenue: Number(seg.revenue) || 0,
      avgLTV: Number(seg.avgLTV) || 0,
      avgOrders: Number(seg.avgOrders) || 0,
      definition,
    };
  };

  return {
    new: mapSegment('new'),
    active: mapSegment('active'),
    at_risk: mapSegment('at_risk'),
    churned: mapSegment('churned'),
    vip: mapSegment('vip'),
    total: Number(rpcData.total) || 0,
  };
}

// Cohort analysis - monthly acquisition cohorts with retention
interface CohortData {
  cohort: string;
  cohortSize: number;
  returned: number;
  returnRate: number;
  m1: number;
  m2: number;
  m3: number;
  m6: number;
  m12: number;
}

async function getCohortAnalysis(
  supabase: ReturnType<typeof createServiceClient>
): Promise<CohortData[]> {
  // Fetch orders from 2024 onwards for cohort analysis
  const { data: orderData, error } = await supabase
    .from("orders")
    .select("shopify_customer_id, created_at")
    .gte("created_at", "2024-01-01")
    .eq("canceled", false)
    .not("shopify_customer_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(150000);

  if (error) {
    console.error("[ANALYTICS] Cohort analysis error:", error.message);
    return [];
  }

  // Build customer first order map
  const customerFirstOrder = new Map<string, Date>();
  const customerOrders = new Map<string, Date[]>();

  for (const o of orderData || []) {
    const cid = o.shopify_customer_id;
    if (!cid) continue;
    const orderDate = new Date(o.created_at);

    if (!customerFirstOrder.has(cid) || orderDate < customerFirstOrder.get(cid)!) {
      customerFirstOrder.set(cid, orderDate);
    }

    if (!customerOrders.has(cid)) {
      customerOrders.set(cid, []);
    }
    customerOrders.get(cid)!.push(orderDate);
  }

  // Group by cohort month and calculate retention
  const cohortMap = new Map<string, {
    size: number;
    returned: Set<string>;
    m1: Set<string>;
    m2: Set<string>;
    m3: Set<string>;
    m6: Set<string>;
    m12: Set<string>;
  }>();

  for (const [cid, firstOrder] of customerFirstOrder) {
    const cohortKey = `${firstOrder.getFullYear()}-${String(firstOrder.getMonth() + 1).padStart(2, "0")}`;

    if (!cohortMap.has(cohortKey)) {
      cohortMap.set(cohortKey, {
        size: 0,
        returned: new Set(),
        m1: new Set(),
        m2: new Set(),
        m3: new Set(),
        m6: new Set(),
        m12: new Set(),
      });
    }

    const cohort = cohortMap.get(cohortKey)!;
    cohort.size++;

    // Check subsequent orders
    const orders = customerOrders.get(cid) || [];
    for (const orderDate of orders) {
      const monthsDiff = (orderDate.getFullYear() - firstOrder.getFullYear()) * 12 +
        (orderDate.getMonth() - firstOrder.getMonth());

      if (monthsDiff >= 1) cohort.returned.add(cid);
      if (monthsDiff === 1) cohort.m1.add(cid);
      if (monthsDiff === 2) cohort.m2.add(cid);
      if (monthsDiff === 3) cohort.m3.add(cid);
      if (monthsDiff === 6) cohort.m6.add(cid);
      if (monthsDiff === 12) cohort.m12.add(cid);
    }
  }

  // Convert to array and sort
  const cohorts: CohortData[] = [];
  for (const [cohort, data] of cohortMap) {
    cohorts.push({
      cohort,
      cohortSize: data.size,
      returned: data.returned.size,
      returnRate: data.size > 0 ? Math.round((data.returned.size / data.size) * 1000) / 10 : 0,
      m1: data.m1.size,
      m2: data.m2.size,
      m3: data.m3.size,
      m6: data.m6.size,
      m12: data.m12.size,
    });
  }

  return cohorts.sort((a, b) => b.cohort.localeCompare(a.cohort)).slice(0, 18);
}

// Re-engagement queue counts
// Based on cumulative return curve: 90d (first nudge), 180d (second push), 365d (final attempt), 545+ (VIP only)
interface ReengagementQueues {
  day90: { count: number; label: string };
  day180: { count: number; label: string };
  day365: { count: number; label: string };
  lapsedVips: { count: number; label: string };
}

// Product Insights - Pre-computed cross-sell analytics
interface ProductInsights {
  repeatRates: Array<{
    product_title: string;
    category: string;
    first_buyers: number;
    repeat_buyers: number;
    repeat_rate: number;
    avg_days_to_second: number;
  }>;
  crossSells: Array<{
    second_product: string;
    sequence_count: number;
    avg_days_between: number;
  }>;
  basketPairs: Array<{
    product_a: string;
    product_b: string;
    co_occurrence: number;
    confidence: number;
  }>;
  computed_at: string | null;
}

async function getReengagementQueues(
  supabase: ReturnType<typeof createServiceClient>
): Promise<ReengagementQueues> {
  const emptyResult: ReengagementQueues = {
    day90: { count: 0, label: "First nudge (75-105d, 1 order)" },
    day180: { count: 0, label: "Second push (165-195d, 1 order)" },
    day365: { count: 0, label: "Final attempt (350-380d)" },
    lapsedVips: { count: 0, label: "Win-back (545d+, $1K+ LTV)" },
  };

  // Use RPC for efficient calculation
  const { data, error } = await supabase.rpc('get_reengagement_queues');

  if (error) {
    console.error("[ANALYTICS] Re-engagement queues RPC error:", error.message);
    // Fall back to empty result - we'll create the RPC if it doesn't exist
    return emptyResult;
  }

  if (!data) {
    return emptyResult;
  }

  return {
    day90: { count: Number(data.day90) || 0, label: "First nudge (75-105d, 1 order)" },
    day180: { count: Number(data.day180) || 0, label: "Second push (165-195d, 1 order)" },
    day365: { count: Number(data.day365) || 0, label: "Final attempt (350-380d)" },
    lapsedVips: { count: Number(data.lapsed_vips) || 0, label: "Win-back (545d+, $1K+ LTV)" },
  };
}

// Get product insights from pre-computed tables
// Tables: product_repeat_rates, cross_sell_sequences, basket_affinity
async function getProductInsights(
  supabase: ReturnType<typeof createServiceClient>
): Promise<ProductInsights> {
  const emptyResult: ProductInsights = {
    repeatRates: [],
    crossSells: [],
    basketPairs: [],
    computed_at: null,
  };

  try {
    // Fetch from pre-computed tables in parallel
    const [repeatRatesResult, crossSellsResult, basketResult] = await Promise.all([
      // Get top products by repeat rate (min 500 first buyers for statistical significance)
      supabase.rpc('get_product_repeat_rates', { p_min_buyers: 500, p_limit: 15 }),
      // Get cross-sells for No. 12 Skillet (gateway product)
      supabase.rpc('get_cross_sell_for_product', { p_product: 'No. 12', p_limit: 10 }),
      // Get top basket pairs
      supabase.rpc('get_basket_affinity', { p_limit: 15 }),
    ]);

    // Check for errors - tables might not exist yet
    if (repeatRatesResult.error) {
      console.warn("[ANALYTICS] Product repeat rates RPC not available:", repeatRatesResult.error.message);
    }
    if (crossSellsResult.error) {
      console.warn("[ANALYTICS] Cross-sells RPC not available:", crossSellsResult.error.message);
    }
    if (basketResult.error) {
      console.warn("[ANALYTICS] Basket affinity RPC not available:", basketResult.error.message);
    }

    // Get computed_at from the first repeat rate record (if any)
    let computed_at: string | null = null;
    if (repeatRatesResult.data && repeatRatesResult.data.length > 0) {
      // Query for computed_at timestamp
      const { data: metaData } = await supabase
        .from('product_repeat_rates')
        .select('computed_at')
        .limit(1);
      if (metaData && metaData[0]) {
        computed_at = metaData[0].computed_at;
      }
    }

    return {
      repeatRates: (repeatRatesResult.data || []).map((r: Record<string, unknown>) => ({
        product_title: String(r.product_title || ''),
        category: String(r.category || 'other'),
        first_buyers: Number(r.first_buyers) || 0,
        repeat_buyers: Number(r.repeat_buyers) || 0,
        repeat_rate: Number(r.repeat_rate) || 0,
        avg_days_to_second: Number(r.avg_days_to_second) || 0,
      })),
      crossSells: (crossSellsResult.data || []).map((r: Record<string, unknown>) => ({
        second_product: String(r.second_product || ''),
        sequence_count: Number(r.sequence_count) || 0,
        avg_days_between: Number(r.avg_days_between) || 0,
      })),
      basketPairs: (basketResult.data || []).map((r: Record<string, unknown>) => ({
        product_a: String(r.product_a || ''),
        product_b: String(r.product_b || ''),
        co_occurrence: Number(r.co_occurrence) || 0,
        confidence: Number(r.confidence) || 0,
      })),
      computed_at,
    };
  } catch (error) {
    console.error("[ANALYTICS] Product insights error:", error);
    return emptyResult;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const period = (url.searchParams.get("period") || "ytd") as AnalyticsPeriod;

  const supabase = createServiceClient();
  const { start, end, priorStart, priorEnd } = getDateRange(period);

  const startStr = start.toISOString();
  const endStr = end.toISOString();
  const priorStartStr = priorStart.toISOString();
  const priorEndStr = priorEnd.toISOString();

  console.log(`[ANALYTICS] Fetching ${period} data: ${startStr} to ${endStr}`);

  try {
    // Run all queries in parallel using database aggregation
    const [
      currentSummary,
      priorSummary,
      currentNewVsReturning,
      priorNewVsReturning,
      topStates,
      topDiscountCodes,
      ltvMetrics,
      monthlyTrends,
      aovSplit,
      abandonedCheckoutMetrics,
      sessionMetrics,
      customerSegments,
      cohortData,
      reengagementQueues,
      productInsights,
    ] = await Promise.all([
      getOrderSummary(supabase, startStr, endStr),
      getOrderSummary(supabase, priorStartStr, priorEndStr),
      getNewVsReturning(supabase, startStr, endStr),
      getNewVsReturning(supabase, priorStartStr, priorEndStr),
      getTopStates(supabase, startStr, endStr),
      getTopDiscountCodes(supabase, startStr, endStr),
      getCustomerLTVMetrics(supabase),
      getMonthlyRevenueTrends(supabase, startStr, endStr),
      getAOVByDiscountStatus(supabase, startStr, endStr),
      getAbandonedCheckouts(supabase, startStr, endStr),
      getSessionMetrics(supabase),
      getCustomerSegmentsDirect(supabase),
      getCohortAnalysis(supabase),
      getReengagementQueues(supabase),
      getProductInsights(supabase),
    ]);

    // Build state heat map
    const stateHeatMap: Record<string, number> = {};
    for (const s of topStates) {
      stateHeatMap[s.provinceCode] = s.totalRevenue;
    }

    // Calculate discount rate
    const discountRate = currentSummary.totalOrders > 0
      ? (currentSummary.ordersWithDiscount / currentSummary.totalOrders) * 100
      : 0;

    // Build response - matches AnalyticsData interface in page.tsx
    const newRevenuePct = currentSummary.totalRevenue > 0
      ? Math.round((currentNewVsReturning.newRevenue / currentSummary.totalRevenue) * 1000) / 10
      : 0;

    const response = {
      period,
      dateRange: {
        start: startStr,
        end: endStr,
        priorStart: priorStartStr,
        priorEnd: priorEndStr,
      },
      summary: {
        totalRevenue: Math.round(currentSummary.totalRevenue * 100) / 100,
        revenueDelta: Math.round((currentSummary.totalRevenue - priorSummary.totalRevenue) * 100) / 100,
        revenueDeltaPct: pctChange(currentSummary.totalRevenue, priorSummary.totalRevenue),
        totalOrders: currentSummary.totalOrders,
        ordersDelta: currentSummary.totalOrders - priorSummary.totalOrders,
        avgOrderValue: Math.round(currentSummary.avgOrderValue * 100) / 100,
        aovDelta: Math.round((currentSummary.avgOrderValue - priorSummary.avgOrderValue) * 100) / 100,
        aovDeltaPct: pctChange(currentSummary.avgOrderValue, priorSummary.avgOrderValue),
        totalCustomers: currentNewVsReturning.newCount + currentNewVsReturning.returningCount,
        repeatPurchaseRate: ltvMetrics.repeatPurchaseRate,
        avgCustomerLTV: ltvMetrics.avgLTV,
      },
      acquisition: {
        newVsReturning: {
          newCustomers: currentNewVsReturning.newCount,
          newRevenue: Math.round(currentNewVsReturning.newRevenue * 100) / 100,
          newOrders: currentNewVsReturning.newCount, // approximation
          returningCustomers: currentNewVsReturning.returningCount,
          returningRevenue: Math.round(currentNewVsReturning.returningRevenue * 100) / 100,
          returningOrders: currentNewVsReturning.returningCount, // approximation
          newRevenuePct,
        },
        monthlyTrends: monthlyTrends,
      },
      segments: {
        new: customerSegments.new,
        active: customerSegments.active,
        at_risk: customerSegments.at_risk,
        churned: customerSegments.churned,
        vip: customerSegments.vip,
        total: customerSegments.total,
      },
      cohorts: cohortData,
      discounts: {
        ordersWithDiscount: currentSummary.ordersWithDiscount,
        totalDiscountAmount: Math.round(currentSummary.totalDiscounts * 100) / 100,
        discountRate: Math.round(discountRate * 10) / 10,
        avgDiscountPerOrder: currentSummary.ordersWithDiscount > 0
          ? Math.round((currentSummary.totalDiscounts / currentSummary.ordersWithDiscount) * 100) / 100
          : 0,
        discountedAOV: aovSplit.discountedAOV,
        nonDiscountedAOV: aovSplit.nonDiscountedAOV,
        topCodes: topDiscountCodes.map(c => ({
          code: c.code,
          usageCount: c.usageCount,
          totalRevenue: c.totalRevenue,
          totalDiscount: c.totalDiscount,
          avgOrderValue: c.avgOrderValue,
        })),
      },
      geographic: {
        topStates,
        stateHeatMap,
      },
      abandonedCheckouts: abandonedCheckoutMetrics,
      sessionMetrics,
      reengagement: reengagementQueues,
      productInsights,
    };

    console.log(`[ANALYTICS] Success: ${currentSummary.totalOrders} orders, $${currentSummary.totalRevenue.toFixed(2)} revenue`);

    return NextResponse.json(response);

  } catch (error) {
    console.error("[ANALYTICS API] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch analytics", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
