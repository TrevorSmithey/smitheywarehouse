import { NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SHOPIFY_API_VERSION } from "@/lib/shopify";
import { checkRateLimit, rateLimitedResponse, RATE_LIMITS } from "@/lib/rate-limit";

// Force dynamic rendering - never cache this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;
import {
  BudgetResponse,
  BudgetDateRange,
  BudgetSkuRow,
  BudgetCategory,
  CompareType,
  BudgetCategoryComparison,
  ComparisonTotals,
  BudgetSkuComparison,
  ChannelActuals,
  ChannelBudgets,
  BudgetSkuRowWithChannels,
  BudgetCategoryDataWithChannels,
} from "@/lib/types";

// Validate env vars and create client (lazy initialization to avoid build-time errors)
function getSupabaseClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error("Missing Supabase credentials (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY)");
  }

  return createClient(url, key);
}

// B2B Shopify credentials
const SHOPIFY_B2B_URL = process.env.SHOPIFY_B2B_STORE_URL || "";
const SHOPIFY_B2B_TOKEN = process.env.SHOPIFY_B2B_ADMIN_TOKEN || "";

// Fetch B2B data from Shopify (includes all orders, not just fulfilled)
// Optional skuFilter to only return items matching a specific SKU (case-insensitive)
async function fetchB2BFromShopify(
  startDate: string,
  endDate: string,
  skuFilter?: string
): Promise<Array<{ sku: string; quantity: number }>> {
  if (!SHOPIFY_B2B_URL || !SHOPIFY_B2B_TOKEN) {
    console.warn("B2B Shopify credentials not configured");
    return [];
  }

  const results: Array<{ sku: string; quantity: number }> = [];

  // Convert ISO dates to Shopify query format (YYYY-MM-DD)
  const startStr = startDate.split("T")[0];
  const endStr = endDate.split("T")[0];
  const skuFilterLower = skuFilter?.toLowerCase();

  const query = `
    query($cursor: String) {
      orders(first: 250, after: $cursor, query: "created_at:>=${startStr} created_at:<=${endStr}") {
        edges {
          node {
            lineItems(first: 250) {
              edges {
                node {
                  sku
                  quantity
                }
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  let cursor: string | null = null;
  let hasMore = true;

  while (hasMore) {
    try {
      const response: Response = await fetch(
        `https://${SHOPIFY_B2B_URL}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": SHOPIFY_B2B_TOKEN,
          },
          body: JSON.stringify({ query, variables: { cursor } }),
        }
      );

      const data = await response.json();

      if (data.errors) {
        throw new Error(`B2B Shopify GraphQL error: ${JSON.stringify(data.errors)}`);
      }

      const orders = data.data?.orders;
      if (!orders) {
        throw new Error("B2B Shopify returned no orders data");
      }

      for (const edge of orders?.edges || []) {
        for (const lineEdge of edge.node.lineItems?.edges || []) {
          const sku = lineEdge.node.sku;
          const qty = lineEdge.node.quantity || 0;
          if (sku && qty > 0) {
            // Apply SKU filter if specified
            if (skuFilterLower && sku.toLowerCase() !== skuFilterLower) {
              continue;
            }
            results.push({ sku, quantity: qty });
          }
        }
      }

      hasMore = orders?.pageInfo?.hasNextPage || false;
      cursor = orders?.pageInfo?.endCursor;
    } catch (error) {
      // Propagate error instead of silently returning partial data
      throw new Error(`B2B Shopify fetch error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return results;
}

// Month name to index mapping
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Category display names
const CATEGORY_DISPLAY_NAMES: Record<BudgetCategory, string> = {
  cast_iron: "Cast Iron",
  carbon_steel: "Carbon Steel",
  accessories: "Accessories",
  glass_lid: "Glass Lids",
};

// Category order for display
const CATEGORY_ORDER: BudgetCategory[] = [
  "cast_iron",
  "carbon_steel",
  "accessories",
  "glass_lid",
];

// SKU sort order within each category (matches budget spreadsheet row order exactly)
const SKU_SORT_ORDER: Record<string, number> = {
  // Accessories (order from budget spreadsheet)
  "smith-ac-scrub1": 1,     // Chainmail Scrubber
  "smith-ac-fgph": 2,       // Leather Potholder
  "smith-ac-sleeve1": 3,    // Short Sleeve
  "smith-ac-sleeve2": 4,    // Long Sleeve
  "smith-ac-spatw1": 5,     // Slotted Spat
  "smith-ac-spatb1": 6,     // Mighty Spat
  "smith-ac-phtlg": 7,      // Suede Potholder
  "smith-ac-keeperw": 8,    // Salt Keeper
  "smith-ac-season": 9,     // Seasoning Oil
  "smith-ac-carekit": 10,   // Care Kit (was Brush)
  "smith-bottle1": 11,      // Bottle Opener
  // Carbon Steel (order from budget spreadsheet)
  "smith-cs-farm12": 1,     // Farmhouse Skillet
  "smith-cs-deep12": 2,     // Deep Farm
  "smith-cs-rroastm": 3,    // Round Roaster
  "smith-cs-ovalm": 4,      // Oval Roaster
  "smith-cs-wokm": 5,       // Wok
  "smith-cs-round17n": 6,   // Paella Pan
  "smith-cs-farm9": 7,      // Little Farm
  "smith-cs-fish": 8,       // Fish Skillet
  // Cast Iron (order from budget spreadsheet)
  "smith-ci-skil8": 1,      // 8Chef
  "smith-ci-chef10": 2,     // 10Chef
  "smith-ci-flat10": 3,     // 10Flat
  "smith-ci-flat12": 4,     // 12Flat
  "smith-ci-skil6": 5,      // 6Trad
  "smith-ci-skil10": 6,     // 10Trad
  "smith-ci-skil12": 7,     // 12Trad
  "smith-ci-tradskil14": 8, // 14Trad
  "smith-ci-skil14": 9,     // 14Dual
  "smith-ci-dskil11": 10,   // 11Deep
  "smith-ci-grill12": 11,   // 12Grill
  "smith-ci-dutch4": 12,    // 3.5 Dutch
  "smith-ci-dutch5": 13,    // 5.5 Dutch
  "smith-ci-dutch7": 14,    // 7.25 Dutch
  "smith-ci-dual6": 15,     // 6Dual
  "smith-ci-griddle18": 16, // Double Burner Griddle
  "smith-ci-dual12": 17,    // 12Dual
  "smith-ci-sauce1": 18,    // Sauce Pan
  // Glass Lids (order from budget spreadsheet)
  "smith-ac-glid10": 1,     // 10Lid
  "smith-ac-glid12": 2,     // 12Lid
  "smith-ac-glid14": 3,     // 14Lid
  "smith-ac-cslid12": 4,    // CS 12 Lid
};

// Map inventory categories to budget categories
function mapToBudgetCategory(category: string): BudgetCategory | null {
  switch (category) {
    case "cast_iron": return "cast_iron";
    case "carbon_steel": return "carbon_steel";
    case "glass_lid": return "glass_lid";
    case "accessory": return "accessories";
    case "factory_second": return null; // Excluded from budget
    default: return null;
  }
}

/**
 * Calculate date ranges based on period type
 * For custom ranges, pass customStart and customEnd as ISO date strings (YYYY-MM-DD)
 */
function calculateDateRange(
  range: BudgetDateRange,
  customStart?: string,
  customEnd?: string
): {
  start: string;
  end: string;
  months: Array<{ year: number; month: number; monthName: string; daysInRange: number; totalDays: number }>;
  daysInPeriod: number;
  daysElapsed: number;
  periodLabel: string;
} {
  // Get current date in EST
  const now = new Date();
  const estFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const estParts = estFormatter.formatToParts(now);
  const estYear = parseInt(
    estParts.find((p) => p.type === "year")?.value || "2025"
  );
  const estMonth =
    parseInt(estParts.find((p) => p.type === "month")?.value || "1") - 1; // 0-indexed
  const estDay = parseInt(
    estParts.find((p) => p.type === "day")?.value || "1"
  );

  const months: Array<{ year: number; month: number; monthName: string; daysInRange: number; totalDays: number }> = [];
  let startDate: Date;
  let endDate: Date;
  let periodLabel: string;

  // Helper to get days in a month
  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

  // Helper to add months with pro-rating info for a date range
  const addMonthsForRange = (start: Date, end: Date) => {
    let tempDate = new Date(start.getFullYear(), start.getMonth(), 1);
    while (tempDate <= end) {
      const yr = tempDate.getFullYear();
      const mo = tempDate.getMonth();
      const totalDays = getDaysInMonth(yr, mo);

      // Calculate days in range for this month
      const monthStart = new Date(yr, mo, 1);
      const monthEnd = new Date(yr, mo, totalDays);
      const rangeStart = start > monthStart ? start : monthStart;
      const rangeEnd = end < monthEnd ? end : monthEnd;
      // Inclusive date counting: floor division + 1
      const daysInRange = Math.floor((rangeEnd.getTime() - rangeStart.getTime()) / 86400000) + 1;

      months.push({
        year: yr,
        month: mo + 1,
        monthName: MONTH_NAMES[mo],
        daysInRange,
        totalDays,
      });
      tempDate = new Date(yr, mo + 1, 1);
    }
  };

  switch (range) {
    case "mtd": {
      startDate = new Date(estYear, estMonth, 1);
      endDate = new Date(estYear, estMonth, estDay);
      const totalDaysInMonth = getDaysInMonth(estYear, estMonth);
      months.push({
        year: estYear,
        month: estMonth + 1,
        monthName: MONTH_NAMES[estMonth],
        daysInRange: estDay,
        totalDays: totalDaysInMonth,
      });
      const monthName = new Intl.DateTimeFormat("en-US", { month: "long" }).format(startDate);
      periodLabel = `${monthName} ${estYear} MTD (Day ${estDay} of ${totalDaysInMonth})`;
      break;
    }

    case "last_month": {
      // Previous complete month only
      let prevMonth = estMonth - 1;
      let prevYear = estYear;
      if (prevMonth < 0) {
        prevMonth = 11;
        prevYear--;
      }
      const prevDays = getDaysInMonth(prevYear, prevMonth);
      startDate = new Date(prevYear, prevMonth, 1);
      endDate = new Date(prevYear, prevMonth, prevDays);
      months.push({
        year: prevYear,
        month: prevMonth + 1,
        monthName: MONTH_NAMES[prevMonth],
        daysInRange: prevDays,
        totalDays: prevDays,
      });
      periodLabel = `${MONTH_NAMES[prevMonth]} ${prevYear}`;
      break;
    }

    case "qtd": {
      const quarter = Math.floor(estMonth / 3);
      const quarterStart = quarter * 3;
      startDate = new Date(estYear, quarterStart, 1);
      endDate = new Date(estYear, estMonth, estDay);
      for (let m = quarterStart; m <= estMonth; m++) {
        const totalDays = getDaysInMonth(estYear, m);
        const daysInRange = m === estMonth ? estDay : totalDays;
        months.push({ year: estYear, month: m + 1, monthName: MONTH_NAMES[m], daysInRange, totalDays });
      }
      periodLabel = `Q${quarter + 1} ${estYear} (${MONTH_NAMES[quarterStart]} - ${MONTH_NAMES[estMonth]})`;
      break;
    }

    case "ytd": {
      startDate = new Date(estYear, 0, 1);
      endDate = new Date(estYear, estMonth, estDay);
      for (let m = 0; m <= estMonth; m++) {
        const totalDays = getDaysInMonth(estYear, m);
        const daysInRange = m === estMonth ? estDay : totalDays;
        months.push({ year: estYear, month: m + 1, monthName: MONTH_NAMES[m], daysInRange, totalDays });
      }
      periodLabel = `${estYear} YTD (Jan - ${MONTH_NAMES[estMonth]})`;
      break;
    }

    case "6months": {
      startDate = new Date(estYear, estMonth - 5, 1);
      if (estMonth < 5) {
        startDate = new Date(estYear - 1, estMonth + 7, 1);
      }
      endDate = new Date(estYear, estMonth, estDay);
      addMonthsForRange(startDate, endDate);
      const startMonthName = MONTH_NAMES[startDate.getMonth()];
      periodLabel = `Last 6 Months (${startMonthName} ${startDate.getFullYear()} - ${MONTH_NAMES[estMonth]} ${estYear})`;
      break;
    }

    case "custom": {
      if (!customStart || !customEnd) {
        throw new Error("Custom range requires start and end dates");
      }
      // Parse ISO dates (YYYY-MM-DD)
      const [startY, startM, startD] = customStart.split("-").map(Number);
      const [endY, endM, endD] = customEnd.split("-").map(Number);
      startDate = new Date(startY, startM - 1, startD);
      endDate = new Date(endY, endM - 1, endD);

      // Validate
      if (endDate < startDate) {
        throw new Error("End date must be after start date");
      }

      addMonthsForRange(startDate, endDate);

      // Format period label
      const startLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(startDate);
      const endLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(endDate);
      periodLabel = `${startLabel} - ${endLabel}`;
      break;
    }

    default: {
      // Fallback to MTD
      startDate = new Date(estYear, estMonth, 1);
      endDate = new Date(estYear, estMonth, estDay);
      const totalDaysInMonth = getDaysInMonth(estYear, estMonth);
      months.push({
        year: estYear,
        month: estMonth + 1,
        monthName: MONTH_NAMES[estMonth],
        daysInRange: estDay,
        totalDays: totalDaysInMonth,
      });
      periodLabel = `${MONTH_NAMES[estMonth]} ${estYear} MTD`;
    }
  }

  const daysInPeriod = Math.ceil(
    (endDate.getTime() - startDate.getTime() + 86400000) / 86400000
  );
  const daysElapsed = daysInPeriod;

  // Start of period: UTC midnight on first day
  const startISO = new Date(
    Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 0, 0, 0)
  ).toISOString();

  // End of period: use current time (now) for "to date" queries
  // This ensures MTD/QTD/YTD include all orders up to this moment
  const endISO = new Date().toISOString();

  return {
    start: startISO,
    end: endISO,
    months,
    daysInPeriod,
    daysElapsed,
    periodLabel,
  };
}

/**
 * Calculate comparison period dates based on primary period and comparison type
 */
function calculateComparisonPeriod(
  primaryStart: string,
  primaryEnd: string,
  compareType: CompareType,
  customCompareStart?: string,
  customCompareEnd?: string
): { start: string; end: string; periodLabel: string } {
  // Parse the primary period dates
  const pStart = new Date(primaryStart);
  const pEnd = new Date(primaryEnd);
  const periodDays = Math.ceil((pEnd.getTime() - pStart.getTime()) / 86400000);

  let cStart: Date;
  let cEnd: Date;
  let periodLabel: string;

  switch (compareType) {
    case "previous_period": {
      // Same duration, immediately before primary period
      cEnd = new Date(pStart.getTime() - 86400000); // Day before primary start
      cStart = new Date(cEnd.getTime() - (periodDays - 1) * 86400000);
      const startLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(cStart);
      const endLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(cEnd);
      periodLabel = `Previous Period (${startLabel} - ${endLabel})`;
      break;
    }

    case "same_period_last_year": {
      // Same dates, 1 year ago
      cStart = new Date(pStart);
      cStart.setFullYear(cStart.getFullYear() - 1);
      cEnd = new Date(pEnd);
      cEnd.setFullYear(cEnd.getFullYear() - 1);
      const startLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(cStart);
      const endLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(cEnd);
      periodLabel = `Same Period Last Year (${startLabel} - ${endLabel})`;
      break;
    }

    case "custom": {
      if (!customCompareStart || !customCompareEnd) {
        throw new Error("Custom comparison requires start and end dates");
      }
      const [startY, startM, startD] = customCompareStart.split("-").map(Number);
      const [endY, endM, endD] = customCompareEnd.split("-").map(Number);
      cStart = new Date(startY, startM - 1, startD);
      cEnd = new Date(endY, endM - 1, endD);
      const startLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(cStart);
      const endLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(cEnd);
      periodLabel = `Custom (${startLabel} - ${endLabel})`;
      break;
    }

    default:
      throw new Error(`Invalid comparison type: ${compareType}`);
  }

  // Convert to ISO with UTC midnight boundaries
  const startISO = new Date(
    Date.UTC(cStart.getFullYear(), cStart.getMonth(), cStart.getDate(), 0, 0, 0)
  ).toISOString();
  const endISO = new Date(
    Date.UTC(cEnd.getFullYear(), cEnd.getMonth(), cEnd.getDate(), 23, 59, 59)
  ).toISOString();

  return {
    start: startISO,
    end: endISO,
    periodLabel,
  };
}

/**
 * Fetch sales data for a given date range
 * Uses same methodology as main GET handler for consistency:
 * - D2C: All orders (including cancelled) from Supabase
 * - B2B: All orders from b2b_fulfilled table (synced from Shopify)
 */
async function fetchSalesData(
  supabase: SupabaseClient,
  start: string,
  end: string
): Promise<Map<string, number>> {
  const salesBySku = new Map<string, number>();

  // Query D2C retail sales with pagination
  const PAGE_SIZE = 50000;
  const retailData: Array<{ sku: string | null; quantity: number }> = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    // Include all orders (including cancelled) to match Excel/Coupler methodology
    const { data: page, error: pageError } = await supabase
      .from("line_items")
      .select(`sku, quantity, orders!inner(created_at)`)
      .gte("orders.created_at", start)
      .lte("orders.created_at", end)
      .range(offset, offset + PAGE_SIZE - 1);

    if (pageError) {
      throw new Error(`Failed to fetch retail sales: ${pageError.message}`);
    }

    if (page && page.length > 0) {
      retailData.push(...page);
      offset += PAGE_SIZE;
      hasMore = page.length === PAGE_SIZE;
    } else {
      hasMore = false;
    }
  }

  // Query B2B from b2b_fulfilled table (already synced from Shopify with status:any)
  // Filter out cancelled orders using soft-delete column
  const { data: b2bData, error: b2bError } = await supabase
    .from("b2b_fulfilled")
    .select("sku, quantity")
    .gte("created_at", start)
    .lte("created_at", end)
    .is("cancelled_at", null);

  if (b2bError) {
    throw new Error(`Failed to fetch B2B sales: ${b2bError.message}`);
  }

  for (const item of retailData || []) {
    if (item.sku) {
      const key = item.sku.toLowerCase();
      salesBySku.set(key, (salesBySku.get(key) || 0) + (item.quantity || 0));
    }
  }

  for (const item of b2bData || []) {
    if (item.sku) {
      const key = item.sku.toLowerCase();
      salesBySku.set(key, (salesBySku.get(key) || 0) + (item.quantity || 0));
    }
  }

  // CARE KIT BUNDLE ADJUSTMENT (effective July 1, 2025)
  const CARE_KIT_SKU = "smith-ac-carekit";
  const CHAINMAIL_SKU = "smith-ac-scrub1";
  const SEASONING_OIL_SKU = "smith-ac-season";
  const bundleStartDate = new Date(Date.UTC(2025, 6, 1, 0, 0, 0)); // July 1, 2025 UTC midnight
  const rangeEndDate = new Date(end);

  if (rangeEndDate >= bundleStartDate) {
    const effectiveStart = new Date(start) > bundleStartDate
      ? start
      : bundleStartDate.toISOString();

    const { data: careKitRetail } = await supabase
      .from("line_items")
      .select(`sku, quantity, orders!inner(created_at)`)
      .ilike("sku", CARE_KIT_SKU)
      .gte("orders.created_at", effectiveStart)
      .lte("orders.created_at", end)
      .limit(100000);

    // Query B2B care kits from b2b_fulfilled table
    // Filter out cancelled orders using soft-delete column
    const { data: careKitB2B } = await supabase
      .from("b2b_fulfilled")
      .select("sku, quantity")
      .ilike("sku", CARE_KIT_SKU)
      .gte("created_at", effectiveStart)
      .lte("created_at", end)
      .is("cancelled_at", null);

    let careKitCount = 0;
    for (const item of careKitRetail || []) {
      careKitCount += item.quantity || 0;
    }
    for (const item of careKitB2B || []) {
      careKitCount += item.quantity || 0;
    }

    if (careKitCount > 0) {
      salesBySku.set(CHAINMAIL_SKU, (salesBySku.get(CHAINMAIL_SKU) || 0) + careKitCount);
      salesBySku.set(SEASONING_OIL_SKU, (salesBySku.get(SEASONING_OIL_SKU) || 0) + careKitCount);
    }
  }

  return salesBySku;
}

export async function GET(request: Request) {
  // Rate limiting
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  const rateLimitResult = checkRateLimit(`budget:${ip}`, RATE_LIMITS.API);
  if (!rateLimitResult.success) {
    return rateLimitedResponse(rateLimitResult);
  }

  try {
    const supabase = getSupabaseClient();

    const { searchParams } = new URL(request.url);
    const range = (searchParams.get("range") || "mtd") as BudgetDateRange;
    const customStart = searchParams.get("start") || undefined;
    const customEnd = searchParams.get("end") || undefined;

    // Comparison period params
    const compareType = searchParams.get("compare") as CompareType | null;
    const compareStart = searchParams.get("compareStart") || undefined;
    const compareEnd = searchParams.get("compareEnd") || undefined;

    // Channel param is deprecated - we now return all channel data in one response
    // The frontend handles filtering client-side for instant switching

    const validRanges: BudgetDateRange[] = ["mtd", "last_month", "qtd", "ytd", "6months", "custom"];
    if (!validRanges.includes(range)) {
      return NextResponse.json(
        { error: "Invalid range. Use: mtd, last_month, qtd, ytd, 6months, custom" },
        { status: 400 }
      );
    }

    // Validate custom range has dates
    if (range === "custom" && (!customStart || !customEnd)) {
      return NextResponse.json(
        { error: "Custom range requires start and end query params (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    // Validate custom date range order
    if (range === "custom" && customStart && customEnd) {
      const [startY, startM, startD] = customStart.split("-").map(Number);
      const [endY, endM, endD] = customEnd.split("-").map(Number);
      const startCheck = new Date(startY, startM - 1, startD);
      const endCheck = new Date(endY, endM - 1, endD);
      if (endCheck < startCheck) {
        return NextResponse.json(
          { error: "End date must be after start date" },
          { status: 400 }
        );
      }
    }

    const { start, end, months, daysInPeriod, daysElapsed, periodLabel } =
      calculateDateRange(range, customStart, customEnd);

    // Build query conditions for budgets table
    // We need to get budgets for all (year, month) combinations in our range
    // Supabase .or() with compound conditions uses: and(col1.eq.val1,col2.eq.val2)
    const budgetConditions = months.map(m => `and(year.eq.${m.year},month.eq.${m.month})`);

    // Query budgets from Supabase (now includes channel column)
    // High limit to prevent any future truncation issues
    const { data: budgetData, error: budgetError } = await supabase
      .from("budgets")
      .select("sku, year, month, channel, budget")
      .or(budgetConditions.join(","))
      .limit(1000000);

    if (budgetError) {
      throw new Error(`Failed to fetch budgets: ${budgetError.message}`);
    }

    // Aggregate budgets by SKU and channel (FULL month budgets - no pro-rating)
    // Use lowercase keys for case-insensitive matching
    // Note: "total" is its own channel in the database, NOT the sum of retail + wholesale
    const retailBudgetsBySku = new Map<string, number>();
    const wholesaleBudgetsBySku = new Map<string, number>();
    const totalBudgetsBySku = new Map<string, number>();

    for (const row of budgetData || []) {
      const skuLower = row.sku.toLowerCase();
      const budget = row.budget || 0;
      const channel = row.channel || "total"; // Default to total for legacy data

      if (channel === "retail") {
        retailBudgetsBySku.set(skuLower, (retailBudgetsBySku.get(skuLower) || 0) + budget);
      } else if (channel === "wholesale") {
        wholesaleBudgetsBySku.set(skuLower, (wholesaleBudgetsBySku.get(skuLower) || 0) + budget);
      } else if (channel === "total") {
        // Total is its own budget, not the sum of retail + wholesale
        totalBudgetsBySku.set(skuLower, (totalBudgetsBySku.get(skuLower) || 0) + budget);
      }
    }

    // CARE KIT BUDGET: Use Smith-AC-Brush budgets for Smith-AC-CareKit
    // The brush SKU in the spreadsheet IS the Care Kit budget
    const BRUSH_SKU = "smith-ac-brush";
    const CAREKIT_SKU = "smith-ac-carekit";
    if (retailBudgetsBySku.has(BRUSH_SKU)) {
      retailBudgetsBySku.set(CAREKIT_SKU, retailBudgetsBySku.get(BRUSH_SKU) || 0);
    }
    if (wholesaleBudgetsBySku.has(BRUSH_SKU)) {
      wholesaleBudgetsBySku.set(CAREKIT_SKU, wholesaleBudgetsBySku.get(BRUSH_SKU) || 0);
    }
    if (totalBudgetsBySku.has(BRUSH_SKU)) {
      totalBudgetsBySku.set(CAREKIT_SKU, totalBudgetsBySku.get(BRUSH_SKU) || 0);
    }

    // Get unique SKUs that have budgets (from total channel, which is the authoritative source)
    const budgetSkus = new Set(totalBudgetsBySku.keys());

    // Query products for display names and categories
    const { data: productsData, error: productsError } = await supabase
      .from("products")
      .select("sku, display_name, category");

    if (productsError) {
      throw new Error(`Failed to fetch products: ${productsError.message}`);
    }

    // Build product lookup (case-insensitive)
    const productMap = new Map<string, { displayName: string; category: string }>();
    for (const p of productsData || []) {
      productMap.set(p.sku.toLowerCase(), {
        displayName: p.display_name,
        category: p.category,
      });
    }

    // Aggregate sales by SKU per channel (case-insensitive)
    const retailSalesBySku = new Map<string, number>();
    const wholesaleSalesBySku = new Map<string, number>();

    // OPTIMIZATION: Use RPC for fast aggregation at database level
    console.log(`[Budget API] Using optimized RPC (get_budget_actuals_v2)`);

    const { data: rpcData, error: rpcError } = await supabase.rpc("get_budget_actuals_v2", {
      p_start_date: start,
      p_end_date: end,
    });

    if (rpcError) {
      throw new Error(`Failed to fetch sales data: ${rpcError.message}`);
    }

    // Build sales maps from RPC result
    for (const row of rpcData || []) {
      const skuLower = row.sku.toLowerCase();
      retailSalesBySku.set(skuLower, row.retail_qty || 0);
      wholesaleSalesBySku.set(skuLower, row.wholesale_qty || 0);
    }

    // CARE KIT BUNDLE ADJUSTMENT (effective July 1, 2025)
    // Each Cleaning & Care Kit (smith-ac-carekit) contains:
    // - 1x Chainmail Scrubber (smith-ac-scrub1)
    // - 1x Seasoning Oil (smith-ac-season)
    // We need to add these component quantities to their respective actuals
    const CARE_KIT_SKU = "smith-ac-carekit";
    const CHAINMAIL_SKU = "smith-ac-scrub1";
    const SEASONING_OIL_SKU = "smith-ac-season";

    // Only apply adjustment if date range includes dates >= July 1, 2025
    const bundleStartDate = new Date(Date.UTC(2025, 6, 1, 0, 0, 0)); // July 1, 2025 UTC midnight
    const rangeEndDate = new Date(end);

    if (rangeEndDate >= bundleStartDate) {
      // Determine the effective start for counting Care Kits
      // Either the range start or July 1, 2025 - whichever is later
      const effectiveStart = new Date(start) > bundleStartDate
        ? start
        : bundleStartDate.toISOString();

      // Query Care Kit retail sales from July 1, 2025 onwards (within our range)
      // Include all orders (including cancelled) to match Excel/Coupler methodology
      const { data: careKitRetail } = await supabase
        .from("line_items")
        .select(`
          sku,
          quantity,
          orders!inner(created_at)
        `)
        .ilike("sku", CARE_KIT_SKU)
        .gte("orders.created_at", effectiveStart)
        .lte("orders.created_at", end)
        .limit(100000);

      // Query B2B care kits from b2b_fulfilled table (already synced from Shopify)
      // Filter out cancelled orders using soft-delete column
      const { data: careKitB2B } = await supabase
        .from("b2b_fulfilled")
        .select("sku, quantity")
        .ilike("sku", CARE_KIT_SKU)
        .gte("created_at", effectiveStart)
        .lte("created_at", end)
        .is("cancelled_at", null);

      // Count Care Kits sold by channel after July 1, 2025
      let retailCareKitCount = 0;
      let wholesaleCareKitCount = 0;
      for (const item of careKitRetail || []) {
        retailCareKitCount += item.quantity || 0;
      }
      for (const item of careKitB2B || []) {
        wholesaleCareKitCount += item.quantity || 0;
      }

      // Add Care Kit bundle components to their respective channel actuals
      if (retailCareKitCount > 0) {
        retailSalesBySku.set(CHAINMAIL_SKU, (retailSalesBySku.get(CHAINMAIL_SKU) || 0) + retailCareKitCount);
        retailSalesBySku.set(SEASONING_OIL_SKU, (retailSalesBySku.get(SEASONING_OIL_SKU) || 0) + retailCareKitCount);
      }
      if (wholesaleCareKitCount > 0) {
        wholesaleSalesBySku.set(CHAINMAIL_SKU, (wholesaleSalesBySku.get(CHAINMAIL_SKU) || 0) + wholesaleCareKitCount);
        wholesaleSalesBySku.set(SEASONING_OIL_SKU, (wholesaleSalesBySku.get(SEASONING_OIL_SKU) || 0) + wholesaleCareKitCount);
      }
    }

    // Calculate combined sales (retail + wholesale) for budget comparison
    // We keep both maps for channel breakdowns in the response
    const salesBySku = new Map<string, number>();
    retailSalesBySku.forEach((qty, sku) => salesBySku.set(sku, qty));
    wholesaleSalesBySku.forEach((qty, sku) => {
      salesBySku.set(sku, (salesBySku.get(sku) || 0) + qty);
    });

    // Build category data with channel breakdowns
    const categoryDataMap = new Map<BudgetCategory, BudgetSkuRowWithChannels[]>();
    for (const cat of CATEGORY_ORDER) {
      categoryDataMap.set(cat, []);
    }

    // Process each budget SKU
    for (const sku of budgetSkus) {
      // Get product info from database
      const product = productMap.get(sku.toLowerCase());
      const category = product
        ? mapToBudgetCategory(product.category)
        : null;

      if (!category) continue;

      const skuLower = sku.toLowerCase();

      // Get channel-specific budgets
      const retailBudget = retailBudgetsBySku.get(skuLower) || 0;
      const wholesaleBudget = wholesaleBudgetsBySku.get(skuLower) || 0;
      const budget = totalBudgetsBySku.get(skuLower) || 0; // Total budget

      // Get channel-specific actuals
      const retailActual = retailSalesBySku.get(skuLower) || 0;
      const wholesaleActual = wholesaleSalesBySku.get(skuLower) || 0;
      const actual = retailActual + wholesaleActual; // Combined

      const variance = actual - budget;
      const variancePct = budget > 0 ? (variance / budget) * 100 : 0;

      // Calculate pace: are we on track based on where we are in the period?
      // Pace = (actual/budget) / periodProgress
      // e.g., 33% of budget on day 8 of 31 (26% through) = 127% pace (ahead)
      const totalDaysInBudgetPeriod = months.reduce((sum, m) => sum + m.totalDays, 0);
      const daysElapsedInPeriod = months.reduce((sum, m) => sum + m.daysInRange, 0);
      const periodProgressFactor = totalDaysInBudgetPeriod > 0
        ? daysElapsedInPeriod / totalDaysInBudgetPeriod
        : 1;
      const expectedByNow = budget * periodProgressFactor;
      const pace = expectedByNow > 0 ? (actual / expectedByNow) * 100 : 0;

      // Calculate channel-specific pace
      const retailExpected = retailBudget * periodProgressFactor;
      const retailPace = retailExpected > 0 ? (retailActual / retailExpected) * 100 : 0;
      const wholesaleExpected = wholesaleBudget * periodProgressFactor;
      const wholesalePace = wholesaleExpected > 0 ? (wholesaleActual / wholesaleExpected) * 100 : 0;

      // Use display name from products table, fallback to SKU
      const displayName = product?.displayName || sku;

      const row: BudgetSkuRowWithChannels = {
        displayName,
        sku,
        budget,
        actual,
        variance,
        variancePct,
        pace: Math.round(pace),
        channelActuals: {
          retail: retailActual,
          wholesale: wholesaleActual,
          total: actual,
        },
        channelBudgets: {
          retail: retailBudget,
          wholesale: wholesaleBudget,
          total: budget,
        },
        channelPace: {
          retail: Math.round(retailPace),
          wholesale: Math.round(wholesalePace),
          total: Math.round(pace),
        },
      };

      categoryDataMap.get(category)?.push(row);
    }

    // Sort and calculate totals with channel breakdowns
    const categories: BudgetCategoryDataWithChannels[] = [];
    let cookwareBudget = 0;
    let cookwareActual = 0;
    let cookwareRetail = 0;
    let cookwareWholesale = 0;
    let cookwareRetailBudget = 0;
    let cookwareWholesaleBudget = 0;
    let grandBudget = 0;
    let grandActual = 0;
    let grandRetail = 0;
    let grandWholesale = 0;
    let grandRetailBudget = 0;
    let grandWholesaleBudget = 0;

    for (const cat of CATEGORY_ORDER) {
      const skus = categoryDataMap.get(cat) || [];
      // Sort by budget spreadsheet order (using SKU_SORT_ORDER map)
      skus.sort((a, b) => {
        const orderA = SKU_SORT_ORDER[a.sku.toLowerCase()] ?? 999;
        const orderB = SKU_SORT_ORDER[b.sku.toLowerCase()] ?? 999;
        return orderA - orderB;
      });

      // Calculate totals including channel breakdowns for actuals AND budgets
      let catBudget = 0, catActual = 0, catVariance = 0;
      let catRetail = 0, catWholesale = 0;
      let catRetailBudget = 0, catWholesaleBudget = 0;
      for (const row of skus) {
        catBudget += row.budget;
        catActual += row.actual;
        catVariance += row.variance;
        catRetail += row.channelActuals.retail;
        catWholesale += row.channelActuals.wholesale;
        catRetailBudget += row.channelBudgets.retail;
        catWholesaleBudget += row.channelBudgets.wholesale;
      }

      const variancePct = catBudget > 0 ? (catVariance / catBudget) * 100 : 0;

      // Calculate pace for category totals (total and per channel)
      const totalDaysInBudgetPeriod = months.reduce((sum, m) => sum + m.totalDays, 0);
      const daysElapsedInPeriod = months.reduce((sum, m) => sum + m.daysInRange, 0);
      const periodProgressFactor = totalDaysInBudgetPeriod > 0
        ? daysElapsedInPeriod / totalDaysInBudgetPeriod
        : 1;
      const expectedByNow = catBudget * periodProgressFactor;
      const pace = expectedByNow > 0 ? Math.round((catActual / expectedByNow) * 100) : 0;
      const catRetailExpected = catRetailBudget * periodProgressFactor;
      const catRetailPace = catRetailExpected > 0 ? Math.round((catRetail / catRetailExpected) * 100) : 0;
      const catWholesaleExpected = catWholesaleBudget * periodProgressFactor;
      const catWholesalePace = catWholesaleExpected > 0 ? Math.round((catWholesale / catWholesaleExpected) * 100) : 0;

      categories.push({
        category: cat,
        displayName: CATEGORY_DISPLAY_NAMES[cat],
        skus,
        totals: {
          budget: catBudget,
          actual: catActual,
          variance: catVariance,
          variancePct,
          pace,
        },
        channelActuals: {
          retail: catRetail,
          wholesale: catWholesale,
          total: catActual,
        },
        channelBudgets: {
          retail: catRetailBudget,
          wholesale: catWholesaleBudget,
          total: catBudget,
        },
        channelPace: {
          retail: catRetailPace,
          wholesale: catWholesalePace,
          total: pace,
        },
      });

      grandBudget += catBudget;
      grandActual += catActual;
      grandRetail += catRetail;
      grandWholesale += catWholesale;
      grandRetailBudget += catRetailBudget;
      grandWholesaleBudget += catWholesaleBudget;

      if (cat === "cast_iron" || cat === "carbon_steel") {
        cookwareBudget += catBudget;
        cookwareActual += catActual;
        cookwareRetail += catRetail;
        cookwareWholesale += catWholesale;
        cookwareRetailBudget += catRetailBudget;
        cookwareWholesaleBudget += catWholesaleBudget;
      }
    }

    // Calculate period progress for totals
    const totalDaysInPeriod = months.reduce((sum, m) => sum + m.totalDays, 0);
    const daysElapsedInPeriod = months.reduce((sum, m) => sum + m.daysInRange, 0);
    const periodProgressFactor = totalDaysInPeriod > 0 ? daysElapsedInPeriod / totalDaysInPeriod : 1;

    // Cookware pace calculation (total and per channel)
    const cookwareExpectedByNow = cookwareBudget * periodProgressFactor;
    const cookwarePace = cookwareExpectedByNow > 0 ? (cookwareActual / cookwareExpectedByNow) * 100 : 0;
    const cookwareRetailExpected = cookwareRetailBudget * periodProgressFactor;
    const cookwareRetailPace = cookwareRetailExpected > 0 ? (cookwareRetail / cookwareRetailExpected) * 100 : 0;
    const cookwareWholesaleExpected = cookwareWholesaleBudget * periodProgressFactor;
    const cookwareWholesalePace = cookwareWholesaleExpected > 0 ? (cookwareWholesale / cookwareWholesaleExpected) * 100 : 0;

    const cookwareTotal = {
      budget: cookwareBudget,
      actual: cookwareActual,
      variance: cookwareActual - cookwareBudget,
      variancePct: cookwareBudget > 0 ? ((cookwareActual - cookwareBudget) / cookwareBudget) * 100 : 0,
      pace: Math.round(cookwarePace),
      channelActuals: {
        retail: cookwareRetail,
        wholesale: cookwareWholesale,
        total: cookwareActual,
      },
      channelBudgets: {
        retail: cookwareRetailBudget,
        wholesale: cookwareWholesaleBudget,
        total: cookwareBudget,
      },
      channelPace: {
        retail: Math.round(cookwareRetailPace),
        wholesale: Math.round(cookwareWholesalePace),
        total: Math.round(cookwarePace),
      },
    };

    // Grand total pace calculation (total and per channel)
    const grandExpectedByNow = grandBudget * periodProgressFactor;
    const grandPace = grandExpectedByNow > 0 ? (grandActual / grandExpectedByNow) * 100 : 0;
    const grandRetailExpected = grandRetailBudget * periodProgressFactor;
    const grandRetailPace = grandRetailExpected > 0 ? (grandRetail / grandRetailExpected) * 100 : 0;
    const grandWholesaleExpected = grandWholesaleBudget * periodProgressFactor;
    const grandWholesalePace = grandWholesaleExpected > 0 ? (grandWholesale / grandWholesaleExpected) * 100 : 0;

    const grandTotalData = {
      budget: grandBudget,
      actual: grandActual,
      variance: grandActual - grandBudget,
      variancePct: grandBudget > 0 ? ((grandActual - grandBudget) / grandBudget) * 100 : 0,
      pace: Math.round(grandPace),
      channelActuals: {
        retail: grandRetail,
        wholesale: grandWholesale,
        total: grandActual,
      },
      channelBudgets: {
        retail: grandRetailBudget,
        wholesale: grandWholesaleBudget,
        total: grandBudget,
      },
      channelPace: {
        retail: Math.round(grandRetailPace),
        wholesale: Math.round(grandWholesalePace),
        total: Math.round(grandPace),
      },
    };

    // Use the correctly calculated values from months array
    // totalDaysInPeriod = sum of totalDays (e.g., 31 for MTD in Dec)
    // daysElapsedInPeriod = sum of daysInRange (e.g., 8 for day 8 of Dec)
    const periodProgress = periodProgressFactor;

    // Build comparison data if requested
    let comparison: BudgetResponse["comparison"] | undefined;

    if (compareType) {
      const validCompareTypes: CompareType[] = ["previous_period", "same_period_last_year", "custom"];
      if (!validCompareTypes.includes(compareType)) {
        return NextResponse.json(
          { error: "Invalid compare type. Use: previous_period, same_period_last_year, custom" },
          { status: 400 }
        );
      }

      // Validate custom comparison has dates
      if (compareType === "custom" && (!compareStart || !compareEnd)) {
        return NextResponse.json(
          { error: "Custom comparison requires compareStart and compareEnd params (YYYY-MM-DD)" },
          { status: 400 }
        );
      }

      // Calculate comparison period dates
      const comparisonPeriod = calculateComparisonPeriod(
        start,
        end,
        compareType,
        compareStart,
        compareEnd
      );

      // Fetch comparison period sales data
      const comparisonSalesBySku = await fetchSalesData(
        supabase,
        comparisonPeriod.start,
        comparisonPeriod.end
      );

      // Build comparison categories with deltas
      const comparisonCategories: BudgetCategoryComparison[] = [];
      let compCookwareActual = 0;
      let compGrandActual = 0;

      for (const cat of categories) {
        const compSkus: BudgetSkuComparison[] = cat.skus.map((sku) => {
          const compActual = comparisonSalesBySku.get(sku.sku.toLowerCase()) || 0;
          const delta = sku.actual - compActual;
          const deltaPct = compActual > 0 ? (delta / compActual) * 100 : 0;

          return {
            displayName: sku.displayName,
            sku: sku.sku,
            budget: sku.budget,
            actual: sku.actual,
            comparisonActual: compActual,
            delta,
            deltaPct,
          };
        });

        // Calculate comparison category totals
        const compCatActual = compSkus.reduce((sum, s) => sum + s.comparisonActual, 0);
        const catDelta = cat.totals.actual - compCatActual;
        const catDeltaPct = compCatActual > 0 ? (catDelta / compCatActual) * 100 : 0;

        comparisonCategories.push({
          category: cat.category,
          displayName: cat.displayName,
          skus: compSkus,
          totals: {
            budget: cat.totals.budget,
            actual: cat.totals.actual,
            variance: cat.totals.variance,
            variancePct: cat.totals.variancePct,
            pace: cat.totals.pace,
            delta: catDelta,
            deltaPct: catDeltaPct,
          },
        });

        compGrandActual += compCatActual;
        if (cat.category === "cast_iron" || cat.category === "carbon_steel") {
          compCookwareActual += compCatActual;
        }
      }

      // Calculate cookware comparison totals
      const cookwareDelta = cookwareTotal.actual - compCookwareActual;
      const cookwareDeltaPct = compCookwareActual > 0 ? (cookwareDelta / compCookwareActual) * 100 : 0;

      // Calculate grand comparison totals
      const grandDelta = grandTotalData.actual - compGrandActual;
      const grandDeltaPct = compGrandActual > 0 ? (grandDelta / compGrandActual) * 100 : 0;

      // Calculate comparison period days
      const compStart = new Date(comparisonPeriod.start);
      const compEnd = new Date(comparisonPeriod.end);
      const compDaysInPeriod = Math.ceil((compEnd.getTime() - compStart.getTime() + 86400000) / 86400000);

      comparison = {
        periodLabel: comparisonPeriod.periodLabel,
        daysInPeriod: compDaysInPeriod,
        daysElapsed: compDaysInPeriod, // Comparison period is always complete
        categories: comparisonCategories,
        cookwareTotal: {
          budget: cookwareTotal.budget,
          actual: cookwareTotal.actual,
          variance: cookwareTotal.variance,
          variancePct: cookwareTotal.variancePct,
          pace: cookwareTotal.pace,
          delta: cookwareDelta,
          deltaPct: cookwareDeltaPct,
        },
        grandTotal: {
          budget: grandTotalData.budget,
          actual: grandTotalData.actual,
          variance: grandTotalData.variance,
          variancePct: grandTotalData.variancePct,
          pace: grandTotalData.pace,
          delta: grandDelta,
          deltaPct: grandDeltaPct,
        },
      };
    }

    const response: BudgetResponse = {
      categories,
      cookwareTotal,
      grandTotal: grandTotalData,
      dateRange: range,
      periodLabel,
      periodProgress,
      daysInPeriod: totalDaysInPeriod,
      daysElapsed: daysElapsedInPeriod,
      comparison,
    };

    // No caching - budget data needs to be fresh on each request
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error) {
    console.error("Budget API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
