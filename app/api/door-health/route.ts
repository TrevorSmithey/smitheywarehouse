/**
 * Door Health / Churn Analytics API
 * Returns focused churn metrics and drill-down data for wholesale customers
 *
 * Health Status Thresholds (from database compute_customer_metrics):
 * - active (thriving/stable): < 180 days since last order
 * - at_risk: 180-269 days
 * - churning: 270-364 days
 * - churned: >= 365 days
 *
 * CRITICAL: Corporate customers (is_corporate=true) are EXCLUDED from all calculations
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth/server";
import { checkRateLimit, rateLimitedResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { QUERY_LIMITS, checkQueryLimit } from "@/lib/constants";
import type {
  DoorHealthResponse,
  DoorHealthMetrics,
  DoorHealthFunnel,
  DoorHealthCustomer,
  ChurnedByYear,
  ChurnedBySegment,
  ChurnedByLifespan,
  CustomerSegment,
  LifespanBucket,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Health status thresholds (days since last order)
const THRESHOLDS = {
  AT_RISK: 180,    // >= 180 days
  CHURNING: 270,   // >= 270 days
  CHURNED: 365,    // >= 365 days
} as const;

// Segment revenue thresholds (from compute_customer_metrics SQL - 20260109 migration)
// IMPORTANT: These must match database thresholds exactly
const SEGMENT_THRESHOLDS = {
  major: 50000,   // >= $50,000 lifetime
  large: 20000,   // >= $20,000 lifetime
  mid: 5000,      // >= $5,000 lifetime
  small: 1000,    // >= $1,000 lifetime
  starter: 0,     // > $0 lifetime (any revenue)
} as const;

/**
 * Calculate lifespan bucket from months
 */
function getLifespanBucket(months: number | null): LifespanBucket {
  if (months === null || months < 12) return "<1yr";
  if (months < 24) return "1-2yr";
  if (months < 36) return "2-3yr";
  return "3+yr";
}

/**
 * Calculate months between two dates
 */
function monthsBetween(start: Date, end: Date): number {
  const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  return Math.max(0, months);
}

/**
 * Determine customer segment from revenue
 * MUST match database compute_customer_metrics() logic exactly
 */
function getSegment(totalRevenue: number): CustomerSegment {
  if (totalRevenue >= SEGMENT_THRESHOLDS.major) return "major";
  if (totalRevenue >= SEGMENT_THRESHOLDS.large) return "large";
  if (totalRevenue >= SEGMENT_THRESHOLDS.mid) return "mid";
  if (totalRevenue >= SEGMENT_THRESHOLDS.small) return "small";
  if (totalRevenue > 0) return "starter";  // DB uses > 0, not >= 0
  return "minimal";
}

/**
 * Calculate year customer crossed 365-day threshold
 * This is the year their last order date + 365 days falls into
 */
function getChurnYear(lastSaleDate: string | null): number | null {
  if (!lastSaleDate) return null;
  const lastOrder = new Date(lastSaleDate);
  // Guard against invalid date strings
  if (isNaN(lastOrder.getTime())) return null;
  const churnDate = new Date(lastOrder);
  churnDate.setDate(churnDate.getDate() + THRESHOLDS.CHURNED);
  return churnDate.getFullYear();
}

export async function GET(request: NextRequest) {
  // Auth check
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

  // Rate limiting
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  const rateLimitResult = checkRateLimit(`door-health:${ip}`, RATE_LIMITS.API);
  if (!rateLimitResult.success) {
    return rateLimitedResponse(rateLimitResult);
  }

  try {
    const supabase = createServiceClient();
    const now = new Date();
    const currentYear = now.getFullYear();
    const priorYear = currentYear - 1;

    // Fetch all B2B customers (exclude corporate)
    // Using last_sale_date (current/transactional) NOT last_order_date (stale/sync)
    // CRITICAL: Only use `is_corporate` - is_corporate_gifting does NOT exist in DB schema
    const { data: rawCustomers, error: fetchError } = await supabase
      .from("ns_wholesale_customers")
      .select(`
        ns_customer_id,
        company_name,
        first_sale_date,
        last_sale_date,
        lifetime_revenue,
        lifetime_orders,
        is_corporate
      `)
      .neq("is_inactive", true)
      .limit(QUERY_LIMITS.WHOLESALE_CUSTOMERS);

    if (fetchError) {
      console.error("[DOOR-HEALTH] Fetch error:", fetchError);
      return NextResponse.json(
        { error: "Failed to fetch customer data" },
        { status: 500 }
      );
    }

    // Check for data truncation
    checkQueryLimit(
      rawCustomers?.length || 0,
      QUERY_LIMITS.WHOLESALE_CUSTOMERS,
      "door_health_customers"
    );

    // Filter out corporate customers - they have different buying patterns
    // Uses is_corporate (computed from category='Corporate' OR category='4')
    const b2bCustomers = (rawCustomers || []).filter((c) => !c.is_corporate);

    // Enrich each customer with computed fields
    const enrichedCustomers: DoorHealthCustomer[] = b2bCustomers.map((c) => {
      const lastSale = c.last_sale_date ? new Date(c.last_sale_date) : null;
      const firstSale = c.first_sale_date ? new Date(c.first_sale_date) : null;

      const daysSinceLastOrder = lastSale
        ? Math.floor((now.getTime() - lastSale.getTime()) / (1000 * 60 * 60 * 24))
        : null;

      const lifespanMonths = firstSale && lastSale
        ? monthsBetween(firstSale, lastSale)
        : null;

      return {
        ns_customer_id: c.ns_customer_id,
        company_name: c.company_name || "Unknown",
        segment: getSegment(c.lifetime_revenue || 0),
        first_sale_date: c.first_sale_date,
        last_sale_date: c.last_sale_date,
        days_since_last_order: daysSinceLastOrder,
        total_revenue: c.lifetime_revenue || 0,
        order_count: c.lifetime_orders || 0,
        lifespan_months: lifespanMonths,
        churn_year: getChurnYear(c.last_sale_date),
      };
    });

    // Build funnel counts
    const funnel: DoorHealthFunnel = {
      active: 0,
      atRisk: 0,
      churning: 0,
      churned: 0,
    };

    // Only count customers WITH order history in the health funnel
    // Customers with no last_sale_date are excluded (never ordered = not a "door")
    enrichedCustomers.forEach((c) => {
      const days = c.days_since_last_order;
      if (days === null) return; // Skip customers with no order history
      if (days < THRESHOLDS.AT_RISK) {
        funnel.active++;
      } else if (days < THRESHOLDS.CHURNING) {
        funnel.atRisk++;
      } else if (days < THRESHOLDS.CHURNED) {
        funnel.churning++;
      } else {
        funnel.churned++;
      }
    });

    // Filter to churned customers only (>= 365 days)
    const churnedCustomers = enrichedCustomers.filter(
      (c) => c.days_since_last_order !== null && c.days_since_last_order >= THRESHOLDS.CHURNED
    );

    // Group churned by year
    const byYearMap = new Map<number, { count: number; revenue: number }>();
    churnedCustomers.forEach((c) => {
      const year = c.churn_year || 0;
      const existing = byYearMap.get(year) || { count: 0, revenue: 0 };
      existing.count++;
      existing.revenue += c.total_revenue;
      byYearMap.set(year, existing);
    });
    const churnedByYear: ChurnedByYear[] = Array.from(byYearMap.entries())
      .map(([year, data]) => ({ year, ...data }))
      .filter((row) => row.year > 0)
      .sort((a, b) => b.year - a.year);

    // Group churned by segment
    const bySegmentMap = new Map<CustomerSegment, { count: number; revenue: number; lifespans: number[] }>();
    churnedCustomers.forEach((c) => {
      const existing = bySegmentMap.get(c.segment) || { count: 0, revenue: 0, lifespans: [] };
      existing.count++;
      existing.revenue += c.total_revenue;
      if (c.lifespan_months !== null) {
        existing.lifespans.push(c.lifespan_months);
      }
      bySegmentMap.set(c.segment, existing);
    });
    const segmentOrder: CustomerSegment[] = ["major", "large", "mid", "small", "starter", "minimal"];
    const churnedBySegment: ChurnedBySegment[] = segmentOrder
      .filter((seg) => bySegmentMap.has(seg))
      .map((segment) => {
        const data = bySegmentMap.get(segment)!;
        const avgLifespan = data.lifespans.length > 0
          ? data.lifespans.reduce((a, b) => a + b, 0) / data.lifespans.length
          : 0;
        return {
          segment,
          count: data.count,
          revenue: data.revenue,
          avgLifespanMonths: Math.round(avgLifespan * 10) / 10,
        };
      });

    // Group churned by lifespan bucket
    const byLifespanMap = new Map<LifespanBucket, { count: number; revenue: number }>();
    churnedCustomers.forEach((c) => {
      const bucket = getLifespanBucket(c.lifespan_months);
      const existing = byLifespanMap.get(bucket) || { count: 0, revenue: 0 };
      existing.count++;
      existing.revenue += c.total_revenue;
      byLifespanMap.set(bucket, existing);
    });
    const bucketOrder: LifespanBucket[] = ["<1yr", "1-2yr", "2-3yr", "3+yr"];
    const churnedByLifespan: ChurnedByLifespan[] = bucketOrder.map((bucket) => ({
      bucket,
      count: byLifespanMap.get(bucket)?.count || 0,
      revenue: byLifespanMap.get(bucket)?.revenue || 0,
    }));

    // Calculate YTD and prior year churn rates
    // Churn rate = customers who crossed 365-day threshold in that year / total B2B customers at start
    const churnedYtd = churnedCustomers.filter((c) => c.churn_year === currentYear).length;
    const churnedPriorYear = churnedCustomers.filter((c) => c.churn_year === priorYear).length;
    const totalB2B = enrichedCustomers.length;

    const churnRateYtd = totalB2B > 0 ? (churnedYtd / totalB2B) * 100 : 0;
    const churnRatePriorYear = totalB2B > 0 ? (churnedPriorYear / totalB2B) * 100 : 0;
    const churnRateChange = churnRateYtd - churnRatePriorYear;

    // Calculate average lifespan (churned customers only)
    const lifespansYtd = churnedCustomers
      .filter((c) => c.churn_year === currentYear && c.lifespan_months !== null)
      .map((c) => c.lifespan_months!);
    const lifespansPrior = churnedCustomers
      .filter((c) => c.churn_year === priorYear && c.lifespan_months !== null)
      .map((c) => c.lifespan_months!);

    const avgLifespanMonths = lifespansYtd.length > 0
      ? lifespansYtd.reduce((a, b) => a + b, 0) / lifespansYtd.length
      : 0;
    const avgLifespanMonthsPriorYear = lifespansPrior.length > 0
      ? lifespansPrior.reduce((a, b) => a + b, 0) / lifespansPrior.length
      : 0;

    // Total lost revenue (all churned customers)
    const lostRevenue = churnedCustomers.reduce((sum, c) => sum + c.total_revenue, 0);

    // Build metrics summary
    const metrics: DoorHealthMetrics = {
      totalB2BCustomers: totalB2B,
      activeCustomers: funnel.active,
      inactiveCustomers: funnel.atRisk + funnel.churning + funnel.churned,
      churnedCustomers: funnel.churned,
      churnRateYtd: Math.round(churnRateYtd * 10) / 10,
      churnRatePriorYear: Math.round(churnRatePriorYear * 10) / 10,
      churnRateChange: Math.round(churnRateChange * 10) / 10,
      avgLifespanMonths: Math.round(avgLifespanMonths * 10) / 10,
      avgLifespanMonthsPriorYear: Math.round(avgLifespanMonthsPriorYear * 10) / 10,
      lostRevenue,
    };

    // Get last sync time
    const { data: syncLog } = await supabase
      .from("sync_logs")
      .select("finished_at")
      .eq("job_type", "sync-netsuite-customers")
      .eq("status", "success")
      .order("finished_at", { ascending: false })
      .limit(1)
      .single();

    const response: DoorHealthResponse = {
      metrics,
      funnel,
      churnedByYear,
      churnedBySegment,
      churnedByLifespan,
      customers: churnedCustomers.sort((a, b) => b.total_revenue - a.total_revenue),
      lastSynced: syncLog?.finished_at || null,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("[DOOR-HEALTH] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
