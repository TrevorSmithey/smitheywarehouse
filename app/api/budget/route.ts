import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  BudgetResponse,
  BudgetDateRange,
  BudgetCategoryData,
  BudgetSkuRow,
  BudgetCategory,
} from "@/lib/types";

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

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

    case "2months": {
      let prevMonth = estMonth - 1;
      let prevYear = estYear;
      if (prevMonth < 0) {
        prevMonth = 11;
        prevYear--;
      }
      startDate = new Date(prevYear, prevMonth, 1);
      endDate = new Date(estYear, estMonth, estDay);
      const prevDays = getDaysInMonth(prevYear, prevMonth);
      const currDays = getDaysInMonth(estYear, estMonth);
      months.push({
        year: prevYear,
        month: prevMonth + 1,
        monthName: MONTH_NAMES[prevMonth],
        daysInRange: prevDays,
        totalDays: prevDays,
      });
      months.push({
        year: estYear,
        month: estMonth + 1,
        monthName: MONTH_NAMES[estMonth],
        daysInRange: estDay,
        totalDays: currDays,
      });
      periodLabel = `${MONTH_NAMES[prevMonth]} - ${MONTH_NAMES[estMonth]} ${estYear}`;
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

  const startISO = new Date(
    Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 5, 0, 0)
  ).toISOString();
  const endISO = new Date(
    Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 28, 59, 59)
  ).toISOString();

  return {
    start: startISO,
    end: endISO,
    months,
    daysInPeriod,
    daysElapsed,
    periodLabel,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const range = (searchParams.get("range") || "mtd") as BudgetDateRange;
    const customStart = searchParams.get("start") || undefined;
    const customEnd = searchParams.get("end") || undefined;

    const validRanges: BudgetDateRange[] = ["mtd", "2months", "qtd", "ytd", "6months", "custom"];
    if (!validRanges.includes(range)) {
      return NextResponse.json(
        { error: "Invalid range. Use: mtd, 2months, qtd, ytd, 6months, custom" },
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

    // Query budgets from Supabase
    const { data: budgetData, error: budgetError } = await supabase
      .from("budgets")
      .select("sku, year, month, budget")
      .or(budgetConditions.join(","));

    if (budgetError) {
      throw new Error(`Failed to fetch budgets: ${budgetError.message}`);
    }

    // Aggregate budgets by SKU (FULL month budgets - no pro-rating)
    // User wants to see progress against full month target, not prorated target
    const budgetsBySku = new Map<string, number>();
    for (const row of budgetData || []) {
      const current = budgetsBySku.get(row.sku) || 0;
      budgetsBySku.set(row.sku, current + row.budget);
    }

    // Get unique SKUs that have budgets
    const budgetSkus = new Set(budgetsBySku.keys());

    // Query products for display names and categories
    const { data: productsData } = await supabase
      .from("products")
      .select("sku, display_name, category");

    // Build product lookup (case-insensitive)
    const productMap = new Map<string, { displayName: string; category: string }>();
    for (const p of productsData || []) {
      productMap.set(p.sku.toLowerCase(), {
        displayName: p.display_name,
        category: p.category,
      });
    }

    // Query retail sales (line_items joined with orders)
    // IMPORTANT: Supabase defaults to 1000 rows, we need more for accurate totals
    const { data: retailData, error: retailError } = await supabase
      .from("line_items")
      .select(`
        sku,
        quantity,
        orders!inner(created_at, canceled)
      `)
      .gte("orders.created_at", start)
      .lte("orders.created_at", end)
      .eq("orders.canceled", false)
      .limit(100000);

    if (retailError) {
      throw new Error(`Failed to fetch retail sales: ${retailError.message}`);
    }

    // Query B2B fulfilled
    const { data: b2bData, error: b2bError } = await supabase
      .from("b2b_fulfilled")
      .select("sku, quantity")
      .gte("fulfilled_at", start)
      .lte("fulfilled_at", end)
      .limit(50000);

    if (b2bError) {
      throw new Error(`Failed to fetch B2B sales: ${b2bError.message}`);
    }

    // Aggregate sales by SKU (case-insensitive)
    const salesBySku = new Map<string, number>();

    for (const item of retailData || []) {
      if (item.sku) {
        const key = item.sku.toLowerCase();
        const current = salesBySku.get(key) || 0;
        salesBySku.set(key, current + (item.quantity || 0));
      }
    }

    for (const item of b2bData || []) {
      if (item.sku) {
        const key = item.sku.toLowerCase();
        const current = salesBySku.get(key) || 0;
        salesBySku.set(key, current + (item.quantity || 0));
      }
    }

    // Build category data
    const categoryDataMap = new Map<BudgetCategory, BudgetSkuRow[]>();
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

      const budget = budgetsBySku.get(sku) || 0;
      const actual = salesBySku.get(sku.toLowerCase()) || 0;
      const variance = actual - budget;
      const variancePct = budget > 0 ? (variance / budget) * 100 : 0;

      // Use display name from products table, fallback to SKU
      const displayName = product?.displayName || sku;

      const row: BudgetSkuRow = {
        displayName,
        sku,
        budget,
        actual,
        variance,
        variancePct,
      };

      categoryDataMap.get(category)?.push(row);
    }

    // Sort and calculate totals
    const categories: BudgetCategoryData[] = [];
    let cookwareBudget = 0;
    let cookwareActual = 0;
    let grandBudget = 0;
    let grandActual = 0;

    for (const cat of CATEGORY_ORDER) {
      const skus = categoryDataMap.get(cat) || [];
      // Sort by budget spreadsheet order (using SKU_SORT_ORDER map)
      skus.sort((a, b) => {
        const orderA = SKU_SORT_ORDER[a.sku.toLowerCase()] ?? 999;
        const orderB = SKU_SORT_ORDER[b.sku.toLowerCase()] ?? 999;
        return orderA - orderB;
      });

      const totals = skus.reduce(
        (acc, row) => ({
          budget: acc.budget + row.budget,
          actual: acc.actual + row.actual,
          variance: acc.variance + row.variance,
          variancePct: 0,
        }),
        { budget: 0, actual: 0, variance: 0, variancePct: 0 }
      );

      totals.variancePct = totals.budget > 0 ? (totals.variance / totals.budget) * 100 : 0;

      categories.push({
        category: cat,
        displayName: CATEGORY_DISPLAY_NAMES[cat],
        skus,
        totals,
      });

      grandBudget += totals.budget;
      grandActual += totals.actual;

      if (cat === "cast_iron" || cat === "carbon_steel") {
        cookwareBudget += totals.budget;
        cookwareActual += totals.actual;
      }
    }

    const cookwareTotal = {
      budget: cookwareBudget,
      actual: cookwareActual,
      variance: cookwareActual - cookwareBudget,
      variancePct: cookwareBudget > 0 ? ((cookwareActual - cookwareBudget) / cookwareBudget) * 100 : 0,
    };

    const grandTotal = {
      budget: grandBudget,
      actual: grandActual,
      variance: grandActual - grandBudget,
      variancePct: grandBudget > 0 ? ((grandActual - grandBudget) / grandBudget) * 100 : 0,
    };

    const periodProgress = daysElapsed / daysInPeriod;

    const response: BudgetResponse = {
      categories,
      cookwareTotal,
      grandTotal,
      dateRange: range,
      periodLabel,
      periodProgress,
      daysInPeriod,
      daysElapsed,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Budget API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
