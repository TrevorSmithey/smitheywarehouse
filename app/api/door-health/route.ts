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
 * CRITICAL: Uses same exclusion logic as wholesale API for consistent counts
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
  DudRateByCohort,
  CohortRetention,
  CustomerSegment,
  LifespanBucket,
} from "@/lib/types";

// Dud rate maturity window (2× median reorder interval of 67 days)
const DUD_MATURITY_DAYS = 133;

// Hardcoded customer IDs to exclude - MUST MATCH wholesale API
// These are D2C/retail aggregates that pollute B2B data
const HARDCODED_EXCLUDED_IDS = [
  2501, // "Smithey Shopify Customer" - D2C retail aggregate, not a real wholesale customer
];

// Helper to build exclusion list combining hardcoded IDs and DB-flagged test accounts
async function getExcludedCustomerIds(
  supabase: ReturnType<typeof createServiceClient>
): Promise<number[]> {
  const { data: excludedFromDB, error } = await supabase
    .from("ns_wholesale_customers")
    .select("ns_customer_id")
    .eq("is_excluded", true);

  if (error) {
    console.warn("[DOOR-HEALTH] Failed to fetch excluded customers from DB:", error.message);
  }

  const dbExcludedIds = (excludedFromDB || []).map((c) => c.ns_customer_id);
  return [...new Set([...HARDCODED_EXCLUDED_IDS, ...dbExcludedIds])];
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Health status thresholds (days since last order)
const THRESHOLDS = {
  AT_RISK: 180,    // >= 180 days
  CHURNING: 270,   // >= 270 days
  CHURNED: 365,    // >= 365 days
  DECLINING_YOY_PCT: -20, // YoY revenue drop >20% = Declining
} as const;

// Segment revenue thresholds (from compute_customer_metrics SQL - 20260115 migration)
// IMPORTANT: These must match database thresholds exactly
// Updated 2026-01-15: Simplified to 3-tier system (Major/Mid/Small)
const SEGMENT_THRESHOLDS = {
  major: 20000,   // >= $20,000 lifetime (key accounts)
  mid: 5000,      // >= $5,000 lifetime (growth accounts)
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
 * Updated 2026-01-15: Simplified to 3-tier system (Major/Mid/Small)
 */
function getSegment(totalRevenue: number): CustomerSegment {
  if (totalRevenue >= SEGMENT_THRESHOLDS.major) return "major";   // >= $20K = key accounts
  if (totalRevenue >= SEGMENT_THRESHOLDS.mid) return "mid";       // >= $5K = growth accounts
  return "small";                                                  // < $5K = emerging accounts
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

    // Get excluded customer IDs (hardcoded + DB-flagged) - MUST MATCH wholesale API
    const excludedIds = await getExcludedCustomerIds(supabase);

    // Fetch all B2B customers (exclude corporate)
    // Using last_sale_date (current/transactional) NOT last_order_date (stale/sync)
    // CRITICAL: Only use `is_corporate` - is_corporate_gifting does NOT exist in DB schema
    // Updated 2026-01-15: Added was_churned for reactivation tracking
    // NOTE: Door Health dashboard INCLUDES inactive customers to track churn metrics
    // Other dashboards filter is_inactive=true, but this one needs full visibility
    const { data: rawCustomers, error: fetchError } = await supabase
      .from("ns_wholesale_customers")
      .select(`
        ns_customer_id,
        company_name,
        first_sale_date,
        last_sale_date,
        lifetime_revenue,
        lifetime_orders,
        is_corporate,
        is_inactive,
        is_manually_churned,
        yoy_revenue_change_pct,
        was_churned
      `)
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

    // Filter out corporate customers AND excluded IDs - matches wholesale API exactly
    // Uses is_corporate (computed from category='Corporate' OR category='4')
    // CRITICAL: Also filter out customers with no actual orders (lifetime_orders = 0)
    // These may have last_sale_date set from stale sync data but no transactions
    const excludedIdSet = new Set(excludedIds);
    const b2bCustomers = (rawCustomers || []).filter(
      (c) => !c.is_corporate && !excludedIdSet.has(c.ns_customer_id) && (c.lifetime_orders || 0) > 0
    );

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

      // Check if customer is declining (YoY revenue drop >20%)
      const yoyChangePct = c.yoy_revenue_change_pct ? parseFloat(c.yoy_revenue_change_pct) : null;
      const isDeclining = yoyChangePct !== null && yoyChangePct < THRESHOLDS.DECLINING_YOY_PCT;

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
        is_declining: isDeclining,
        was_churned: c.was_churned || false,
      };
    });

    // Build funnel counts
    // Updated 2026-01-15: Added reactivated tracking
    const funnel: DoorHealthFunnel = {
      active: 0,
      atRisk: 0,
      churning: 0,
      churned: 0,
      healthyDeclining: 0, // Active customers with YoY revenue drop >20%
      reactivated: 0, // Customers who were previously churned but came back
    };

    // Only count customers WITH order history AND revenue in the health funnel
    // Customers with no last_sale_date are excluded (never ordered = not a "door")
    // Customers with $0 revenue are excluded (cancelled/draft order = never a real customer)
    // Updated 2026-01-15: Track reactivated customers (was_churned=true but now active)
    enrichedCustomers.forEach((c) => {
      const days = c.days_since_last_order;
      if (days === null) return; // Skip customers with no order history
      if (c.total_revenue <= 0) return; // Skip $0 revenue - not a real customer

      // Count reactivated: previously churned but now NOT churned (came back)
      // These customers count toward their current bucket AND are flagged as reactivated
      if (c.was_churned && days < THRESHOLDS.CHURNED) {
        funnel.reactivated++;
      }

      if (days < THRESHOLDS.AT_RISK) {
        funnel.active++;
        // Track declining customers within the healthy/active segment
        if (c.is_declining) {
          funnel.healthyDeclining++;
        }
      } else if (days < THRESHOLDS.CHURNING) {
        funnel.atRisk++;
      } else if (days < THRESHOLDS.CHURNED) {
        funnel.churning++;
      } else {
        funnel.churned++;
      }
    });

    // Filter to churned customers only (>= 365 days)
    // Must have revenue > 0 to count as churned - $0 revenue means they were never a real customer
    // (cancelled order, draft order, 100% discount, etc.)
    const churnedCustomers = enrichedCustomers.filter(
      (c) => c.days_since_last_order !== null &&
             c.days_since_last_order >= THRESHOLDS.CHURNED &&
             c.total_revenue > 0
    );

    // Total B2B customers - ALL TIME (for churn rate denominator)
    // This is the historical total: active + at-risk + churning + churned
    const allTimeDoors = enrichedCustomers.filter(
      (c) => c.order_count > 0 &&
             c.total_revenue > 0 &&
             c.days_since_last_order !== null
    ).length;

    // Active Doors = customers we're currently working with (NOT churned)
    // This is the HERO metric: healthy + at-risk + churning
    const activeDoors = funnel.active + funnel.atRisk + funnel.churning;

    // Group churned by year with pool-shrinking methodology
    // Pool shrinks each year as customers churn out
    const byYearMap = new Map<number, { count: number; revenue: number }>();
    churnedCustomers.forEach((c) => {
      const year = c.churn_year || 0;
      const existing = byYearMap.get(year) || { count: 0, revenue: 0 };
      existing.count++;
      existing.revenue += c.total_revenue;
      byYearMap.set(year, existing);
    });

    // Calculate pool-adjusted churn rates
    // Pool at start of year = total customers - cumulative churned in prior years
    const years = Array.from(byYearMap.keys()).filter((y) => y > 0).sort((a, b) => a - b);
    let cumulativeChurned = 0;
    const poolByYear = new Map<number, number>();

    // First pass: compute pool size for each year (cumulative from earliest)
    for (const year of years) {
      poolByYear.set(year, allTimeDoors - cumulativeChurned);
      cumulativeChurned += byYearMap.get(year)?.count || 0;
    }

    const churnedByYear: ChurnedByYear[] = Array.from(byYearMap.entries())
      .map(([year, data]) => {
        const poolSize = poolByYear.get(year) || allTimeDoors;
        const churnRate = poolSize > 0 ? (data.count / poolSize) * 100 : 0;
        return {
          year,
          count: data.count,
          revenue: data.revenue,
          poolSize,
          churnRate: Math.round(churnRate * 10) / 10,
        };
      })
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
    // Updated 2026-01-15: Simplified to 3-tier system
    const segmentOrder: CustomerSegment[] = ["major", "mid", "small"];
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

    // ==========================================================
    // DUD RATE CALCULATION BY COHORT
    // Dud = one-time buyer who hasn't reordered within maturity window (133 days)
    // ==========================================================
    const dudRateByCohort: DudRateByCohort[] = [];

    // Group customers by acquisition cohort
    const cohortMap = new Map<string, typeof enrichedCustomers>();
    enrichedCustomers.forEach((c) => {
      if (!c.first_sale_date) return;
      const firstDate = new Date(c.first_sale_date);
      const year = firstDate.getFullYear();
      const month = firstDate.getMonth() + 1;
      // Split current year into H1/H2
      const cohortKey = year === currentYear
        ? `${year} ${month <= 6 ? "H1" : "H2"}`
        : `${year}`;
      const existing = cohortMap.get(cohortKey) || [];
      existing.push(c);
      cohortMap.set(cohortKey, existing);
    });

    // Calculate dud rate for each cohort
    const cohortKeys = Array.from(cohortMap.keys()).sort();
    for (const cohort of cohortKeys) {
      const members = cohortMap.get(cohort) || [];
      const totalAcquired = members.length;

      // Mature = has had DUD_MATURITY_DAYS since first order
      const matureCustomers = members.filter((c) => {
        if (!c.first_sale_date) return false;
        const firstOrder = new Date(c.first_sale_date);
        const daysSinceFirst = Math.floor((now.getTime() - firstOrder.getTime()) / (1000 * 60 * 60 * 24));
        return daysSinceFirst >= DUD_MATURITY_DAYS;
      });

      // One-time = exactly 1 order
      const matureOneTime = matureCustomers.filter((c) => c.order_count === 1);

      const isMature = matureCustomers.length === totalAcquired;
      const dudRate = matureCustomers.length > 0
        ? (matureOneTime.length / matureCustomers.length) * 100
        : null;

      dudRateByCohort.push({
        cohort,
        totalAcquired,
        matureCustomers: matureCustomers.length,
        matureOneTime: matureOneTime.length,
        dudRate: dudRate !== null ? Math.round(dudRate * 10) / 10 : null,
        isMature,
      });
    }

    // ==========================================================
    // COHORT RETENTION ANALYSIS - The honest numbers
    // Shows what % of each acquisition cohort has churned vs retained
    // This is the "scary number" that reveals true retention health
    // ==========================================================
    const cohortRetention: CohortRetention[] = [];

    // Build year-only cohort map (simpler than H1/H2 split)
    const yearCohortMap = new Map<number, typeof enrichedCustomers>();
    enrichedCustomers.forEach((c) => {
      if (!c.first_sale_date) return;
      const year = new Date(c.first_sale_date).getFullYear();
      const existing = yearCohortMap.get(year) || [];
      existing.push(c);
      yearCohortMap.set(year, existing);
    });

    // Calculate retention for each cohort
    const sortedYears = Array.from(yearCohortMap.keys()).sort();
    for (const year of sortedYears) {
      const members = yearCohortMap.get(year) || [];
      const acquired = members.length;

      // Classify each customer by current status
      let healthy = 0, atRisk = 0, churning = 0, churned = 0;
      members.forEach((c) => {
        const days = c.days_since_last_order;
        if (days === null) {
          // No last_sale_date = treat as healthy (data gap)
          healthy++;
        } else if (days >= THRESHOLDS.CHURNED) {
          churned++;
        } else if (days >= THRESHOLDS.CHURNING) {
          churning++;
        } else if (days >= THRESHOLDS.AT_RISK) {
          atRisk++;
        } else {
          healthy++;
        }
      });

      const retained = healthy + atRisk + churning;
      const retentionPct = acquired > 0 ? (retained / acquired) * 100 : 0;
      const churnPct = acquired > 0 ? (churned / acquired) * 100 : 0;

      // A cohort is "maturing" if NOT ALL members have had 365 days to churn
      // This means the END of the cohort year (Dec 31) must be <365 days ago
      const cohortEndDate = new Date(year, 11, 31); // Dec 31 of cohort year
      const daysSinceCohortEnd = Math.floor((now.getTime() - cohortEndDate.getTime()) / (1000 * 60 * 60 * 24));
      const isMaturing = daysSinceCohortEnd < 365;

      cohortRetention.push({
        year,
        acquired,
        healthy,
        atRisk,
        churning,
        churned,
        retained,
        retentionPct: Math.round(retentionPct * 10) / 10,
        churnPct: Math.round(churnPct * 10) / 10,
        isMaturing,
      });
    }

    // ==========================================================
    // ROLLING 12-MONTH CHURN RATE - Updated 2026-01-15
    // The primary churn metric: what % of all doors have we lost?
    // This is a point-in-time snapshot that updates daily as customers
    // naturally move in/out of the "churned" bucket.
    //
    // Formula: (currently churned / total customers with orders) * 100
    //
    // Why "rolling": The numerator changes daily as:
    // - Customers cross the 365-day threshold (enter churned)
    // - Customers place new orders (exit churned)
    // This creates a naturally smoothing effect without complex windows.
    // ==========================================================
    const rolling12MonthChurnRate = allTimeDoors > 0
      ? (funnel.churned / allTimeDoors) * 100
      : 0;

    // Keep YTD/prior year for the yearly breakdown table (historical view)
    const churnedYtd = churnedCustomers.filter((c) => c.churn_year === currentYear).length;
    const churnedPriorYear = churnedCustomers.filter((c) => c.churn_year === priorYear).length;

    // Legacy rates (kept for backward compatibility with yearly breakdown)
    const churnRateYtd = allTimeDoors > 0 ? (churnedYtd / allTimeDoors) * 100 : 0;
    const churnRatePriorYear = allTimeDoors > 0 ? (churnedPriorYear / allTimeDoors) * 100 : 0;
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

    // Revenue at risk (at_risk + churning customers, 180-365 days)
    const atRiskCustomers = enrichedCustomers.filter(
      (c) => c.days_since_last_order !== null &&
             c.days_since_last_order >= THRESHOLDS.AT_RISK &&
             c.days_since_last_order < THRESHOLDS.CHURNED
    );
    const revenueAtRisk = atRiskCustomers.reduce((sum, c) => sum + c.total_revenue, 0);

    // Build metrics summary
    // Updated 2026-01-15: Added rolling12MonthChurnRate as primary churn metric
    // Hero metric is activeDoors (healthy + at-risk + churning), NOT allTimeDoors
    const metrics: DoorHealthMetrics = {
      totalB2BCustomers: activeDoors, // HERO: 432 active doors we're working with
      activeCustomers: funnel.active, // Healthy customers
      inactiveCustomers: funnel.churned, // Churned = inactive (365+ days, lost)
      churnedCustomers: funnel.churned,
      rolling12MonthChurnRate: Math.round(rolling12MonthChurnRate * 10) / 10,
      churnRateYtd: Math.round(churnRateYtd * 10) / 10,
      churnRatePriorYear: Math.round(churnRatePriorYear * 10) / 10,
      churnRateChange: Math.round(churnRateChange * 10) / 10,
      avgLifespanMonths: Math.round(avgLifespanMonths * 10) / 10,
      avgLifespanMonthsPriorYear: Math.round(avgLifespanMonthsPriorYear * 10) / 10,
      lostRevenue,
      revenueAtRisk,
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
      dudRateByCohort,
      cohortRetention,
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
