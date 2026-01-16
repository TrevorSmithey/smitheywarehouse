/**
 * Wholesale Forecast API
 * Manages annual revenue forecasts with door-level driver assumptions
 * Supports immutable versioning (edits create new versions)
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth/server";
import { checkRateLimit, rateLimitedResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { QUERY_LIMITS, checkQueryLimit } from "@/lib/constants";
import type {
  WholesaleForecast,
  ForecastSkuMix,
  ForecastResponse,
  ForecastQuarterActuals,
  ForecastCreateInput,
  ForecastMonthlyUnits,
  ForecastStatus,
} from "@/lib/types";
import {
  B2B_SEASONALITY,
  CORP_SEASONALITY,
  DEFAULT_SKU_MIX,
  computeDoorScenarios,
  computeMonthlyUnits,
  computeMonthlyFromQuarterly,
  buildQuarterlyActuals,
} from "@/lib/forecasting";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Hardcoded D2C aggregate to exclude from all wholesale queries
// MUST MATCH door-health API for consistent Active Doors metric
const HARDCODED_EXCLUDED_IDS = [2501];

// Helper to build exclusion list combining hardcoded IDs and DB-flagged test accounts
// MUST MATCH door-health API exactly for universal Active Doors metric
async function getExcludedCustomerIds(
  supabase: ReturnType<typeof createServiceClient>
): Promise<number[]> {
  const { data: excludedFromDB, error } = await supabase
    .from("ns_wholesale_customers")
    .select("ns_customer_id")
    .eq("is_excluded", true);

  if (error) {
    console.warn("[FORECAST API] Failed to fetch excluded customers from DB:", error.message);
  }

  const dbExcludedIds = (excludedFromDB || []).map((c) => c.ns_customer_id);
  return [...new Set([...HARDCODED_EXCLUDED_IDS, ...dbExcludedIds])];
}

/**
 * GET /api/wholesale/forecast
 * Fetch the active forecast for a fiscal year, including computed actuals
 *
 * Query params:
 *   - year: fiscal year (defaults to current year)
 *   - version: specific version (optional, defaults to active)
 *   - history: if "true", return all versions for the year
 */
export async function GET(request: NextRequest) {
  // Auth check
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

  // Rate limiting
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  const rateLimitResult = checkRateLimit(`wholesale-forecast:${ip}`, RATE_LIMITS.API);
  if (!rateLimitResult.success) {
    return rateLimitedResponse(rateLimitResult);
  }

  try {
    const supabase = createServiceClient();
    const { searchParams } = new URL(request.url);

    const year = parseInt(searchParams.get("year") || String(new Date().getFullYear()));
    const version = searchParams.get("version");
    const includeHistory = searchParams.get("history") === "true";

    // Fetch forecast(s) based on params
    let forecastQuery = supabase
      .from("wholesale_forecasts")
      .select("*")
      .eq("fiscal_year", year);

    if (version) {
      forecastQuery = forecastQuery.eq("version", parseInt(version));
    } else if (!includeHistory) {
      // Default: get active forecast only
      forecastQuery = forecastQuery.eq("status", "active");
    }

    forecastQuery = forecastQuery.order("version", { ascending: false });

    const { data: forecasts, error: forecastError } = await forecastQuery;

    if (forecastError) {
      console.error("[FORECAST API] Failed to fetch forecasts:", forecastError);
      return NextResponse.json({ error: "Failed to fetch forecasts" }, { status: 500 });
    }

    // Get the primary forecast (first result, or null if none)
    const forecast = forecasts?.[0] as WholesaleForecast | null;

    // Fetch SKU mix if we have a forecast
    let skuMix: ForecastSkuMix[] = [];
    if (forecast) {
      const { data: skuMixData, error: skuError } = await supabase
        .from("wholesale_forecast_sku_mix")
        .select("*")
        .eq("forecast_id", forecast.id);

      if (skuError) {
        console.error("[FORECAST API] Failed to fetch SKU mix:", skuError);
      } else {
        skuMix = (skuMixData || []) as ForecastSkuMix[];
      }

      // If no SKU mix exists, compute dynamically from TTM data
      // HIGH-3 FIX: Use actual transaction data instead of 6-month-old hardcoded defaults
      if (skuMix.length === 0) {
        skuMix = await fetchDynamicSkuMix(supabase, forecast.id);

        // Final fallback to defaults only if dynamic computation fails
        if (skuMix.length === 0) {
          console.warn("[FORECAST API] Dynamic SKU mix failed, using stale defaults");
          skuMix = DEFAULT_SKU_MIX.map((s, i) => ({
            id: `default-${i}`,
            forecast_id: forecast.id,
            ...s,
          }));
        }
      }
    }

    // Fetch quarterly actuals from transactions for comparison
    // This is the source of truth for actual revenue
    const quarterlyActuals = await fetchQuarterlyActuals(supabase, year, forecast);

    // Compute door scenarios if we have driver assumptions
    let scenarios: ReturnType<typeof computeDoorScenarios> = [];
    if (forecast?.existing_doors_start && forecast?.new_doors_target) {
      scenarios = computeDoorScenarios({
        existingDoorsStart: forecast.existing_doors_start,
        newDoorsTarget: forecast.new_doors_target,
        expectedChurnDoors: forecast.expected_churn_doors || 0,
        organicGrowthPct: forecast.organic_growth_pct || 0.11,
        newDoorFirstYearYield: forecast.new_door_first_year_yield || 6000,
        annualB2BTarget:
          (forecast.b2b_q1_target || 0) +
          (forecast.b2b_q2_target || 0) +
          (forecast.b2b_q3_target || 0) +
          (forecast.b2b_q4_target || 0),
      });
    }

    // Compute monthly unit forecasts if we have revenue targets
    const monthlyUnits: ForecastMonthlyUnits[] = [];
    if (forecast) {
      const b2bQuarterly = [
        { quarter: "Q1", revenue: forecast.b2b_q1_target || 0 },
        { quarter: "Q2", revenue: forecast.b2b_q2_target || 0 },
        { quarter: "Q3", revenue: forecast.b2b_q3_target || 0 },
        { quarter: "Q4", revenue: forecast.b2b_q4_target || 0 },
      ];

      // Distribute quarterly revenue to months using weighted distribution
      // HIGH-4 FIX: Use MONTHLY_WITHIN_QUARTER weights (Q4 is more back-weighted for holiday push)
      const monthNames = [
        "Jan", "Feb", "Mar", // Q1
        "Apr", "May", "Jun", // Q2
        "Jul", "Aug", "Sep", // Q3
        "Oct", "Nov", "Dec", // Q4
      ];

      for (let q = 0; q < 4; q++) {
        const quarterlyRevenue = b2bQuarterly[q].revenue;
        // Use weighted distribution: default [0.30, 0.33, 0.37], Q4 [0.28, 0.32, 0.40]
        const quarterNum = (q + 1) as 1 | 2 | 3 | 4;
        const monthlyRevenues = computeMonthlyFromQuarterly(quarterlyRevenue, quarterNum);
        for (let m = 0; m < 3; m++) {
          const monthIndex = q * 3 + m;
          const monthName = monthNames[monthIndex];
          const units = computeMonthlyUnits(monthlyRevenues[m], monthName, skuMix);
          monthlyUnits.push(...units);
        }
      }
    }

    // Fetch revision history if requested
    let revisions: Array<{
      id: string;
      fiscal_year: number;
      version: number;
      status: ForecastStatus;
      created_at: string;
      created_by: string | null;
      revision_note: string | null;
      b2b_total: number;
      corp_total: number;
    }> = [];

    if (includeHistory && forecasts) {
      revisions = forecasts.map((f) => ({
        id: f.id,
        fiscal_year: f.fiscal_year,
        version: f.version,
        status: f.status as ForecastStatus,
        created_at: f.created_at,
        created_by: f.created_by,
        revision_note: f.revision_note,
        b2b_total:
          (f.b2b_q1_target || 0) +
          (f.b2b_q2_target || 0) +
          (f.b2b_q3_target || 0) +
          (f.b2b_q4_target || 0),
        corp_total:
          (f.corp_q1_target || 0) +
          (f.corp_q2_target || 0) +
          (f.corp_q3_target || 0) +
          (f.corp_q4_target || 0),
      }));
    }

    // Fetch current door count using UNIVERSAL Active Doors definition
    // See BUSINESS_LOGIC.md "Active Doors (Universal Metric)" - MUST match Door Health tab
    // Active Doors = Healthy + At Risk + Churning (excludes Churned)
    // CRITICAL: Use last_sale_date with date math, NOT the stale days_since_last_order column
    // Door Health computes days dynamically from last_sale_date - we must match exactly
    const excludedIds = await getExcludedCustomerIds(supabase);
    const churned365DaysAgo = new Date();
    churned365DaysAgo.setDate(churned365DaysAgo.getDate() - 365);
    const churnCutoffDate = churned365DaysAgo.toISOString().split("T")[0];

    const { count: currentDoorCount } = await supabase
      .from("ns_wholesale_customers")
      .select("*", { count: "exact", head: true })
      .neq("is_inactive", true)
      .eq("is_corporate", false)
      .not("ns_customer_id", "in", `(${excludedIds.join(",")})`)
      .gt("lifetime_orders", 0)          // Has placed at least one order
      .gt("lifetime_revenue", 0)         // Has generated actual revenue
      .not("last_sale_date", "is", null) // Must have a last sale date
      .gt("last_sale_date", churnCutoffDate); // Not churned (ordered within 365 days)

    const response: ForecastResponse = {
      forecast,
      skuMix,
      quarterlyActuals,
      scenarios,
      monthlyUnits: monthlyUnits.flat(),
      revisions,
      stats: forecast
        ? (() => {
            const b2b_annual_target =
              (forecast.b2b_q1_target || 0) +
              (forecast.b2b_q2_target || 0) +
              (forecast.b2b_q3_target || 0) +
              (forecast.b2b_q4_target || 0);
            const corp_annual_target =
              (forecast.corp_q1_target || 0) +
              (forecast.corp_q2_target || 0) +
              (forecast.corp_q3_target || 0) +
              (forecast.corp_q4_target || 0);
            const b2b_ytd_actual = quarterlyActuals
              .reduce((sum, q) => sum + q.b2b_actual, 0);
            const corp_ytd_actual = quarterlyActuals
              .reduce((sum, q) => sum + q.corp_actual, 0);

            // Calculate expected YTD based on time elapsed
            const now = new Date();
            const yearStart = new Date(year, 0, 1);
            const yearEnd = new Date(year + 1, 0, 1);
            const yearProgress = (now.getTime() - yearStart.getTime()) / (yearEnd.getTime() - yearStart.getTime());
            const b2b_expected_ytd = b2b_annual_target * yearProgress;
            const corp_expected_ytd = corp_annual_target * yearProgress;

            const b2b_ytd_variance_pct = b2b_expected_ytd > 0
              ? ((b2b_ytd_actual - b2b_expected_ytd) / b2b_expected_ytd) * 100
              : 0;
            const corp_ytd_variance_pct = corp_expected_ytd > 0
              ? ((corp_ytd_actual - corp_expected_ytd) / corp_expected_ytd) * 100
              : 0;

            const b2b_pacing: "ahead" | "on_track" | "behind" =
              b2b_ytd_variance_pct > 5 ? "ahead" : b2b_ytd_variance_pct < -5 ? "behind" : "on_track";
            const corp_pacing: "ahead" | "on_track" | "behind" =
              corp_ytd_variance_pct > 5 ? "ahead" : corp_ytd_variance_pct < -5 ? "behind" : "on_track";

            const projected_ending_doors = (forecast.existing_doors_start || 0) -
              (forecast.expected_churn_doors || 0) +
              (forecast.new_doors_target || 0);

            return {
              b2b_annual_target,
              b2b_ytd_actual,
              b2b_ytd_variance_pct,
              b2b_pacing,
              corp_annual_target,
              corp_ytd_actual,
              corp_ytd_variance_pct,
              corp_pacing,
              current_doors: currentDoorCount || 0,
              projected_ending_doors,
            };
          })()
        : null,
      lastSynced: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("[FORECAST API] Unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/wholesale/forecast
 * Create a new forecast or new revision
 *
 * Body:
 *   - fiscal_year: number (required)
 *   - status: "draft" | "active" (optional, defaults to "draft")
 *   - revision_note: string (optional, required if creating revision)
 *   - ... all target and driver fields
 */
export async function POST(request: NextRequest) {
  // Auth check
  const { session, error: authError } = await requireAuth(request);
  if (authError) return authError;

  // Rate limiting
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  const rateLimitResult = checkRateLimit(`wholesale-forecast:${ip}`, RATE_LIMITS.API);
  if (!rateLimitResult.success) {
    return rateLimitedResponse(rateLimitResult);
  }

  try {
    const supabase = createServiceClient();
    const body: ForecastCreateInput = await request.json();

    // Validate required fields
    if (!body.fiscal_year) {
      return NextResponse.json({ error: "fiscal_year is required" }, { status: 400 });
    }

    // Check for existing forecasts in this year
    const { data: existingForecasts, error: existingError } = await supabase
      .from("wholesale_forecasts")
      .select("id, version, status")
      .eq("fiscal_year", body.fiscal_year)
      .order("version", { ascending: false });

    if (existingError) {
      console.error("[FORECAST API] Failed to check existing forecasts:", existingError);
      return NextResponse.json({ error: "Failed to check existing forecasts" }, { status: 500 });
    }

    const latestForecast = existingForecasts?.[0];
    const newVersion = latestForecast ? latestForecast.version + 1 : 1;
    const parentId = latestForecast?.id || null;

    // If setting status to active, archive all other active forecasts for this year
    // MED-2 FIX: Track archived IDs for rollback if insert fails
    let archivedForecastIds: string[] = [];
    if (body.status === "active" && existingForecasts) {
      const activeForecasts = existingForecasts.filter((f) => f.status === "active");
      if (activeForecasts.length > 0) {
        archivedForecastIds = activeForecasts.map((f) => f.id);
        const { error: archiveError } = await supabase
          .from("wholesale_forecasts")
          .update({ status: "archived" })
          .in("id", archivedForecastIds);

        if (archiveError) {
          console.error("[FORECAST API] Failed to archive existing active forecasts:", archiveError);
          // Continue - the unique constraint will protect against duplicates
        }
      }
    }

    // Create the new forecast
    const newForecast = {
      fiscal_year: body.fiscal_year,
      version: newVersion,
      status: body.status || "draft",
      created_by: session?.name || null,
      b2b_q1_target: body.b2b_q1_target || 0,
      b2b_q2_target: body.b2b_q2_target || 0,
      b2b_q3_target: body.b2b_q3_target || 0,
      b2b_q4_target: body.b2b_q4_target || 0,
      corp_q1_target: body.corp_q1_target || 0,
      corp_q2_target: body.corp_q2_target || 0,
      corp_q3_target: body.corp_q3_target || 0,
      corp_q4_target: body.corp_q4_target || 0,
      existing_doors_start: body.existing_doors_start || null,
      new_doors_target: body.new_doors_target || null,
      expected_churn_doors: body.expected_churn_doors || null,
      organic_growth_pct: body.organic_growth_pct || null,
      new_door_first_year_yield: body.new_door_first_year_yield || null,
      revision_note: body.revision_note || null,
      parent_forecast_id: parentId,
    };

    const { data: createdForecast, error: createError } = await supabase
      .from("wholesale_forecasts")
      .insert(newForecast)
      .select()
      .single();

    if (createError) {
      console.error("[FORECAST API] Failed to create forecast:", createError);

      // MED-2 FIX: Rollback archived forecasts if insert fails
      if (archivedForecastIds.length > 0) {
        console.error("[FORECAST API] Attempting rollback of archived forecasts");
        const { error: rollbackError } = await supabase
          .from("wholesale_forecasts")
          .update({ status: "active" })
          .in("id", archivedForecastIds);

        if (rollbackError) {
          console.error("[FORECAST API] CRITICAL: Rollback failed! Manual intervention required:", rollbackError);
        } else {
          console.log("[FORECAST API] Successfully rolled back archived forecasts");
        }
      }

      return NextResponse.json({ error: "Failed to create forecast" }, { status: 500 });
    }

    // Seed SKU mix for first version with defaults
    if (newVersion === 1) {
      // First version - seed with default SKU mix
      const defaultSkuRows = DEFAULT_SKU_MIX.map((s) => ({
        forecast_id: createdForecast.id,
        sku: s.sku,
        sku_name: s.sku_name,
        revenue_share_pct: s.revenue_share_pct,
        avg_unit_price: s.avg_unit_price,
      }));

      const { error: defaultSkuError } = await supabase
        .from("wholesale_forecast_sku_mix")
        .insert(defaultSkuRows);

      if (defaultSkuError) {
        console.error("[FORECAST API] Failed to insert default SKU mix:", defaultSkuError);
      }
    }

    console.log(
      `[FORECAST API] Created forecast v${newVersion} for FY${body.fiscal_year} (status: ${body.status || "draft"})`
    );

    return NextResponse.json({
      success: true,
      forecast: createdForecast,
      message: `Created forecast v${newVersion} for FY${body.fiscal_year}`,
    });
  } catch (error) {
    console.error("[FORECAST API] Unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Helper: Compute dynamic SKU mix from trailing 12 months transaction data
 * HIGH-3 FIX: Uses actual B2B transaction data instead of stale hardcoded defaults
 * NOTE: Cast iron products are item_type='Assembly', NOT 'InvtPart'
 */
async function fetchDynamicSkuMix(
  supabase: ReturnType<typeof createServiceClient>,
  forecastId: string
): Promise<ForecastSkuMix[]> {
  try {
    // Calculate TTM date range
    const ttmStart = new Date();
    ttmStart.setMonth(ttmStart.getMonth() - 12);
    const ttmStartStr = ttmStart.toISOString().split("T")[0];

    // Query TTM SKU revenue from line items
    // Uses ABS() because NetSuite stores amounts as negatives
    const { data: skuData, error } = await supabase.rpc("compute_ttm_sku_mix", {
      p_ttm_start: ttmStartStr,
    });

    // If RPC doesn't exist, fall back to raw query
    if (error?.code === "42883") {
      // Function doesn't exist, use direct query
      const { data: lineItems, error: lineError } = await supabase
        .from("ns_wholesale_line_items")
        .select(`
          sku,
          foreign_amount,
          quantity,
          ns_transaction_id,
          item_type
        `)
        .eq("item_type", "Assembly") // Cast iron products
        .not("sku", "is", null)
        .gt("quantity", 0);

      if (lineError) {
        console.warn("[FORECAST API] Failed to fetch line items for SKU mix:", lineError);
        return [];
      }

      // Aggregate by SKU
      const skuTotals = new Map<string, { revenue: number; units: number }>();
      for (const item of lineItems || []) {
        if (!item.sku?.startsWith("Smith-CI")) continue;
        const existing = skuTotals.get(item.sku) || { revenue: 0, units: 0 };
        existing.revenue += Math.abs(parseFloat(item.foreign_amount) || 0);
        existing.units += Math.abs(item.quantity || 0);
        skuTotals.set(item.sku, existing);
      }

      // Calculate total revenue for percentages
      const totalRevenue = Array.from(skuTotals.values()).reduce((sum, s) => sum + s.revenue, 0);
      if (totalRevenue === 0) return [];

      // Convert to SKU mix format
      const dynamicMix: ForecastSkuMix[] = Array.from(skuTotals.entries())
        .filter(([_, data]) => data.revenue > 1000) // Filter tiny SKUs
        .map(([sku, data], i) => ({
          id: `dynamic-${i}`,
          forecast_id: forecastId,
          sku,
          sku_name: sku.replace("Smith-CI-", "").replace(/([a-z])([A-Z])/g, "$1 $2"),
          revenue_share_pct: Math.round((data.revenue / totalRevenue) * 1000) / 1000, // 3 decimals
          avg_unit_price: data.units > 0 ? Math.round(data.revenue / data.units) : 0,
        }))
        .sort((a, b) => b.revenue_share_pct - a.revenue_share_pct)
        .slice(0, 20); // Top 20 SKUs

      console.log(`[FORECAST API] Computed dynamic SKU mix: ${dynamicMix.length} SKUs from TTM data`);
      return dynamicMix;
    }

    if (error) {
      console.warn("[FORECAST API] Failed to compute dynamic SKU mix:", error);
      return [];
    }

    // Transform RPC result to SKU mix format
    return (skuData || []).map((s: { sku: string; sku_name: string; revenue_share_pct: number; avg_unit_price: number }, i: number) => ({
      id: `dynamic-${i}`,
      forecast_id: forecastId,
      sku: s.sku,
      sku_name: s.sku_name,
      revenue_share_pct: s.revenue_share_pct,
      avg_unit_price: s.avg_unit_price,
    }));
  } catch (err) {
    console.warn("[FORECAST API] Error computing dynamic SKU mix:", err);
    return [];
  }
}

/**
 * Helper: Fetch quarterly actuals from transaction data
 * Returns B2B and Corporate revenue by quarter for the given fiscal year,
 * combined with targets from the forecast to calculate variances
 */
async function fetchQuarterlyActuals(
  supabase: ReturnType<typeof createServiceClient>,
  year: number,
  forecast: {
    b2b_q1_target?: number | null;
    b2b_q2_target?: number | null;
    b2b_q3_target?: number | null;
    b2b_q4_target?: number | null;
    corp_q1_target?: number | null;
    corp_q2_target?: number | null;
    corp_q3_target?: number | null;
    corp_q4_target?: number | null;
  } | null
): Promise<ForecastQuarterActuals[]> {
  const today = new Date();
  const quarters: Array<{
    num: 1 | 2 | 3 | 4;
    name: string;
    start: string;
    end: string;
    b2b_target: number;
    corp_target: number;
    days_total: number;
  }> = [
    {
      num: 1,
      name: "Q1",
      start: `${year}-01-01`,
      end: `${year}-03-31`,
      b2b_target: forecast?.b2b_q1_target || 0,
      corp_target: forecast?.corp_q1_target || 0,
      days_total: 90, // Jan-Mar
    },
    {
      num: 2,
      name: "Q2",
      start: `${year}-04-01`,
      end: `${year}-06-30`,
      b2b_target: forecast?.b2b_q2_target || 0,
      corp_target: forecast?.corp_q2_target || 0,
      days_total: 91, // Apr-Jun
    },
    {
      num: 3,
      name: "Q3",
      start: `${year}-07-01`,
      end: `${year}-09-30`,
      b2b_target: forecast?.b2b_q3_target || 0,
      corp_target: forecast?.corp_q3_target || 0,
      days_total: 92, // Jul-Sep
    },
    {
      num: 4,
      name: "Q4",
      start: `${year}-10-01`,
      end: `${year}-12-31`,
      b2b_target: forecast?.b2b_q4_target || 0,
      corp_target: forecast?.corp_q4_target || 0,
      days_total: 92, // Oct-Dec
    },
  ];

  const results: ForecastQuarterActuals[] = [];

  // Fetch customer corporate flag mapping
  const { data: customers } = await supabase
    .from("ns_wholesale_customers")
    .select("ns_customer_id, is_corporate, category")
    .not("ns_customer_id", "in", `(${HARDCODED_EXCLUDED_IDS.join(",")})`);

  // IMPORTANT: Use ONLY is_corporate flag per BUSINESS_LOGIC.md lines 154-157
  // DO NOT use category === "Corporate" or category === "4" (deprecated, unreliable)
  const corporateCustomerIds = new Set(
    (customers || [])
      .filter((c) => c.is_corporate === true)
      .map((c) => c.ns_customer_id)
  );

  for (const q of quarters) {
    // Fetch transactions for this quarter with exact count to detect truncation
    const { data: transactions, error, count: totalCount } = await supabase
      .from("ns_wholesale_transactions")
      .select("ns_customer_id, foreign_total", { count: "exact" })
      .not("ns_customer_id", "in", `(${HARDCODED_EXCLUDED_IDS.join(",")})`)
      .gte("tran_date", q.start)
      .lte("tran_date", q.end)
      .limit(QUERY_LIMITS.WHOLESALE_TRANSACTIONS_YTD);

    if (error) {
      // HIGH-1 FIX: Throw error instead of silent continue (Prime Directive: No silent failures)
      console.error(`[FORECAST API] Failed to fetch ${q.name} transactions:`, error);
      throw new Error(`Failed to fetch quarterly transactions for ${q.name}: ${error.message}`);
    }

    // HIGH-2 FIX: Use actual count from database, not returned array length
    checkQueryLimit(
      totalCount || 0,
      QUERY_LIMITS.WHOLESALE_TRANSACTIONS_YTD,
      `forecast_${q.name}_transactions`
    );

    // Calculate B2B vs Corporate revenue
    let b2bActual = 0;
    let corpActual = 0;

    for (const txn of transactions || []) {
      const revenue = parseFloat(txn.foreign_total) || 0;
      const customerId = typeof txn.ns_customer_id === "string"
        ? parseInt(txn.ns_customer_id)
        : txn.ns_customer_id;

      if (corporateCustomerIds.has(customerId)) {
        corpActual += revenue;
      } else {
        b2bActual += revenue;
      }
    }

    // Calculate quarter completion status
    const quarterStart = new Date(q.start);
    const quarterEnd = new Date(q.end);
    const isComplete = today > quarterEnd;
    const daysElapsed = isComplete
      ? q.days_total
      : Math.max(0, Math.floor((today.getTime() - quarterStart.getTime()) / (1000 * 60 * 60 * 24)));

    // Calculate variances
    const b2bVariance = b2bActual - q.b2b_target;
    const b2bVariancePct = q.b2b_target > 0
      ? Math.round(((b2bActual - q.b2b_target) / q.b2b_target) * 10000) / 100
      : 0;
    const corpVariance = corpActual - q.corp_target;
    const corpVariancePct = q.corp_target > 0
      ? Math.round(((corpActual - q.corp_target) / q.corp_target) * 10000) / 100
      : 0;

    results.push({
      quarter: q.num,
      b2b_target: q.b2b_target,
      b2b_actual: Math.round(b2bActual * 100) / 100,
      b2b_variance: Math.round(b2bVariance * 100) / 100,
      b2b_variance_pct: b2bVariancePct,
      corp_target: q.corp_target,
      corp_actual: Math.round(corpActual * 100) / 100,
      corp_variance: Math.round(corpVariance * 100) / 100,
      corp_variance_pct: corpVariancePct,
      is_complete: isComplete,
      days_elapsed: daysElapsed,
      days_total: q.days_total,
    });
  }

  return results;
}
