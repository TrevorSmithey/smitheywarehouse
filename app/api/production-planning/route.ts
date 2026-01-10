/**
 * Production Planning API - TOOL (not just dashboard)
 *
 * This is the nerve center of production operations, providing:
 * - Current month execution tracking (targets vs actuals)
 * - Forward-looking production forecast (next 6 months)
 * - Component-level deep dive with shared demand calculation
 * - On-order visibility and lead time awareness
 * - Historical performance review
 *
 * Data sources:
 * - production_targets: Monthly production goals from ops manager
 * - assembly_sku_daily: Daily production actuals by SKU
 * - budgets (channel='total'): Annual sales forecast
 * - bill_of_materials: Component relationships
 * - component_orders: Components on order with ETAs
 * - component_lead_times: Lead times per component/supplier
 * - ShipHero API: Real-time component inventory
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { requireAuth } from "@/lib/auth/server";
import { fetchAllProducts, normalizeToShipHeroSku, SKU_DISPLAY_NAMES } from "@/lib/shiphero";
import { checkRateLimit, rateLimitedResponse, RATE_LIMITS } from "@/lib/rate-limit";

// ============================================
// Product Filters
// ============================================

// STRICT filter for production counts (matches Excel Daily_Aggregation formula)
// Only Cast Iron and Carbon Steel, excludes defects
function isProductionTracked(sku: string): boolean {
  const skuUpper = sku.toUpperCase();

  // Exclude defects (items ending in -D)
  if (skuUpper.endsWith("-D")) return false;

  // Cast Iron and Carbon Steel cookware only
  if (skuUpper.startsWith("SMITH-CI-")) return true;
  if (skuUpper.startsWith("SMITH-CS-")) return true;

  return false;
}

// BROADER filter for production planning (includes items with targets)
// Cast Iron, Carbon Steel, Glass Lids, CareKit - excludes defects
function isPlannedProduct(sku: string): boolean {
  const skuUpper = sku.toUpperCase();

  // Exclude defects (items ending in -D)
  if (skuUpper.endsWith("-D")) return false;

  // Cast Iron and Carbon Steel cookware
  if (skuUpper.startsWith("SMITH-CI-")) return true;
  if (skuUpper.startsWith("SMITH-CS-")) return true;

  // Glass lids (manufactured, have targets)
  if (skuUpper.startsWith("SMITH-AC-GLID")) return true;

  // Care Kit (assembled, has targets)
  if (skuUpper.includes("CAREKIT") || skuUpper.includes("CARE-KIT")) return true;

  return false;
}

// Alias for backward compatibility
const isManufacturedProduct = isPlannedProduct;

// Purchased accessories ordered from China (not manufactured, need inventory planning)
// These use sales forecast (not production targets) and have long lead times
function isPurchasedAccessory(sku: string): boolean {
  const skuUpper = sku.toUpperCase();
  // Accessories that are NOT glass lids (glass lids are manufactured)
  if (skuUpper.startsWith("SMITH-AC-") && !skuUpper.includes("GLID")) return true;
  return false;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

function getSupabaseClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing Supabase credentials");
  return createClient(url, key);
}

// ============================================
// Types
// ============================================

interface ProductionTarget {
  year: number;
  month: number;
  sku: string;
  target: number;
}

interface AssemblyDaily {
  date: string;
  sku: string;
  quantity: number;
}

interface BudgetRow {
  sku: string;
  year: number;
  month: number;
  budget: number;
}

interface BOMRow {
  finished_good_sku: string;
  component_sku: string;
  quantity_required: number;
}

interface ComponentOrder {
  component_sku: string;
  quantity_ordered: number;
  quantity_received: number;
  expected_arrival: string | null;
  status: string;
  po_number: string | null;
  supplier: string | null;
}

interface ComponentLeadTime {
  component_sku: string;
  supplier: string | null;
  lead_time_days: number;
  min_order_quantity: number | null;
}

// BOM component with inventory info
interface BOMComponent {
  component: string;
  qtyRequired: number;
  available: number;
  canMake: number;
  isConstraining: boolean;
  leadTimeDays: number | null;
}

type ProductCategory = "cast_iron" | "carbon_steel" | "accessory";

function getProductCategory(sku: string): ProductCategory {
  const skuUpper = sku.toUpperCase();
  if (skuUpper.startsWith("SMITH-CI-")) return "cast_iron";
  if (skuUpper.startsWith("SMITH-CS-")) return "carbon_steel";
  return "accessory";
}

// SKU data for current month
interface SKUData {
  sku: string;
  displayName: string;
  category: ProductCategory;
  monthlyTarget: number;
  producedMTD: number;
  percentToMonthlyTarget: number;
  quarterlyTarget: number;
  producedQTD: number;
  percentToQuarterlyTarget: number;
  yearSalesForecast: number;
  producedYTD: number;
  remainingForYear: number;
  percentToYearTarget: number;
  maxProducible: number;
  constrainingComponent: string;
  constrainingQtyAvailable: number;
  hasConstraint: boolean;
  shortfall: number;
  bomComponents: BOMComponent[];
}

// Component data with shared demand calculation
interface ComponentData {
  sku: string;
  available: number;
  onOrder: number;
  nextArrival: string | null;
  leadTimeDays: number | null;
  totalDemandThisMonth: number;
  totalDemandNext3Months: number;
  usedBySkus: Array<{ sku: string; displayName: string; qtyPerUnit: number; demandThisMonth: number }>;
  runwayDays: number | null; // Days until we run out at current rate
  runoutDate: string | null;
  orderRecommendation: {
    needed: boolean;
    quantity: number;
    orderByDate: string | null;
    reason: string;
  } | null;
}

// Monthly forecast data
interface MonthForecast {
  year: number;
  month: number;
  monthName: string;
  skuTargets: Array<{
    sku: string;
    displayName: string;
    target: number;
    canProduce: number; // Based on current + on-order inventory
    hasConstraint: boolean;
  }>;
  totalTarget: number;
  constrainedSkuCount: number;
}

// Historical month data
interface HistoricalMonth {
  year: number;
  month: number;
  monthName: string;
  totalTarget: number;
  totalProduced: number;
  percentAchieved: number;
  skuPerformance: Array<{
    sku: string;
    displayName: string;
    target: number;
    produced: number;
    percentAchieved: number;
  }>;
}

// Purchased accessory data (chainmail, potholders, etc. ordered from China)
// These don't have production targets - use sales forecast instead
interface AccessoryData {
  sku: string;
  displayName: string;
  available: number;                    // Current ShipHero inventory
  onOrder: number;                      // From component_orders
  nextArrival: string | null;           // ETA of next shipment
  leadTimeDays: number;                 // Default 90 days for China
  salesForecastThisMonth: number;       // From budgets table
  salesForecastNext3Months: number;     // Next 3 months from budgets
  dailyDemand: number;                  // salesForecastThisMonth / daysInMonth
  runwayDays: number | null;            // available / dailyDemand
  runoutDate: string | null;
  safetyStockDays: number;              // Buffer in days (default 30)
  reorderPoint: number;                 // (leadTimeDays + safetyStockDays) * dailyDemand
  belowReorderPoint: boolean;           // available < reorderPoint
  orderRecommendation: {
    needed: boolean;
    quantity: number;
    orderByDate: string | null;
    reason: string;
  } | null;
}

interface ConstraintAlert {
  sku: string;
  displayName: string;
  monthlyTarget: number;
  maxProducible: number;
  shortfall: number;
  constrainingComponent: string;
  componentAvailable: number;
}

// Cumulative production vs budget curve - the core planning insight
// Shows if we're building inventory fast enough to meet seasonal demand
interface InventoryCurveMonth {
  month: number;           // 1-12
  monthName: string;
  cumulativeBudget: number;     // Total units expected to be SOLD by end of this month
  cumulativeProduction: number; // Total units MADE by end of this month (actual + projected)
  gap: number;                  // production - budget (positive = ahead, negative = behind)
  isActual: boolean;            // true if this month has actual data, false if projected
}

interface InventoryCurve {
  sku: string;
  displayName: string;
  category: ProductCategory;
  year: number;
  months: InventoryCurveMonth[];
  currentGap: number;           // Gap right now (positive = ahead, negative = behind)
  currentGapPercent: number;    // Gap as % of year budget
  minGap: number;               // Worst gap at any point in the year
  minGapMonth: string;          // Month where gap is worst
  stockoutRisk: boolean;        // Does production ever dip below budget?
  status: "ahead" | "on_track" | "behind" | "critical";
}

interface PeriodInfo {
  year: number;
  month: number;
  monthName: string;
  quarter: number;
  daysInMonth: number;
  daysElapsedInMonth: number;
}

// Full response
export interface ProductionPlanningResponse {
  asOfDate: string;
  period: PeriodInfo;

  // Execute tab data
  skuData: SKUData[];
  constraintAlerts: ConstraintAlert[];
  summary: {
    totalMonthlyTarget: number;
    totalProducedMTD: number;
    percentToMonthlyTarget: number;
    totalYearForecast: number;
    totalProducedYTD: number;
    constrainedSkuCount: number;
  };

  // Components tab data
  components: ComponentData[];

  // Purchased accessories (ordered from China, not manufactured)
  accessories: AccessoryData[];

  // Forecast tab data (next 6 months)
  forecast: MonthForecast[];

  // History tab data (past 6 months)
  history: HistoricalMonth[];

  // Inventory build curves - cumulative production vs cumulative budget
  // Shows if we're building inventory fast enough for seasonal demand
  inventoryCurves: InventoryCurve[];

  // Aggregate curve (all SKUs combined)
  aggregateCurve: {
    months: InventoryCurveMonth[];
    currentGap: number;
    status: "ahead" | "on_track" | "behind" | "critical";
  };

  // Legacy (for backwards compat)
  componentInventory: Array<{ sku: string; available: number; limitsSkus: string[] }>;

  // Yearly targets overview - shows target vs actual for each month
  yearlyTargets: YearlyTargetMonth[];

  // Annual budget by SKU - sum of 12 monthly targets per SKU
  annualSkuTargets: AnnualSkuTarget[];
}

export interface YearlyTargetMonth {
  month: number;
  monthName: string;
  target: number;
  produced: number;
  isCurrent: boolean;
  isFuture: boolean;
}

export interface AnnualSkuTarget {
  sku: string;
  displayName: string;
  category: ProductCategory;
  monthlyTargets: number[];  // 12 elements, index 0 = January
  annualTarget: number;      // Sum of 12 monthly targets
  producedYTD: number;       // Units built year-to-date
  remaining: number;         // annualTarget - producedYTD (floored at 0)
}

// ============================================
// Helpers
// ============================================

function getQuarter(month: number): number {
  return Math.ceil(month / 3);
}

function getQuarterMonths(quarter: number): number[] {
  const start = (quarter - 1) * 3 + 1;
  return [start, start + 1, start + 2];
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function getESTDate(): { year: number; month: number; day: number; dateStr: string } {
  const estFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = estFormatter.formatToParts(new Date());
  const year = parseInt(parts.find((p) => p.type === "year")?.value || "2025");
  const month = parseInt(parts.find((p) => p.type === "month")?.value || "1");
  const day = parseInt(parts.find((p) => p.type === "day")?.value || "1");
  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { year, month, day, dateStr };
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function addMonths(year: number, month: number, add: number): { year: number; month: number } {
  let newMonth = month + add;
  let newYear = year;
  while (newMonth > 12) {
    newMonth -= 12;
    newYear++;
  }
  while (newMonth < 1) {
    newMonth += 12;
    newYear--;
  }
  return { year: newYear, month: newMonth };
}

// ============================================
// Main Handler
// ============================================

export async function GET(request: NextRequest) {
  // Auth check - requires admin session
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  const rateLimitResult = checkRateLimit(`production-planning:${ip}`, RATE_LIMITS.API);
  if (!rateLimitResult.success) {
    return rateLimitedResponse(rateLimitResult);
  }

  try {
    const supabase = getSupabaseClient();

    // Support demo mode: ?demo=2026-01
    const url = new URL(request.url);
    const demoParam = url.searchParams.get("demo");

    let year: number, month: number, day: number, dateStr: string;

    if (demoParam && /^\d{4}-\d{2}$/.test(demoParam)) {
      const [demoYear, demoMonth] = demoParam.split("-").map(Number);
      year = demoYear;
      month = demoMonth;
      day = 15;
      dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    } else {
      const estDate = getESTDate();
      year = estDate.year;
      month = estDate.month;
      day = estDate.day;
      dateStr = estDate.dateStr;
    }

    const quarter = getQuarter(month);
    const quarterMonths = getQuarterMonths(quarter);
    const daysInMonth = getDaysInMonth(year, month);

    // Calculate date ranges for historical data
    const sixMonthsAgo = addMonths(year, month, -6);
    const historicalStartDate = `${sixMonthsAgo.year}-${String(sixMonthsAgo.month).padStart(2, "0")}-01`;

    // ========================================
    // Parallel data fetches
    // ========================================
    const [
      targetsResult,
      productionResult,
      budgetsResult,
      bomResult,
      productsResult,
      componentOrdersResult,
      leadTimesResult,
      shipheroProducts,
    ] = await Promise.all([
      // All production targets (for current year + next year for forecast)
      supabase
        .from("production_targets")
        .select("year, month, sku, target")
        .gte("year", year)
        .lte("year", year + 1),

      // Production data for current year + historical
      supabase
        .from("assembly_sku_daily")
        .select("date, sku, quantity")
        .gte("date", historicalStartDate)
        .lte("date", dateStr),

      // Sales forecast from budgets
      supabase
        .from("budgets")
        .select("sku, year, month, budget")
        .eq("year", year)
        .eq("channel", "total"),

      // Bill of materials
      supabase.from("bill_of_materials").select("finished_good_sku, component_sku, quantity_required"),

      // Products for display names
      supabase.from("products").select("sku, display_name"),

      // Component orders (pending/in-transit)
      supabase
        .from("component_orders")
        .select("component_sku, quantity_ordered, quantity_received, expected_arrival, status, po_number, supplier")
        .in("status", ["ordered", "in_transit", "partial"]),

      // Component lead times
      supabase.from("component_lead_times").select("component_sku, supplier, lead_time_days, min_order_quantity"),

      // ShipHero inventory
      fetchAllProducts(),
    ]);

    // Handle errors
    if (targetsResult.error) throw new Error(`Targets error: ${targetsResult.error.message}`);
    if (productionResult.error) throw new Error(`Production error: ${productionResult.error.message}`);
    if (budgetsResult.error) throw new Error(`Budgets error: ${budgetsResult.error.message}`);
    if (bomResult.error) throw new Error(`BOM error: ${bomResult.error.message}`);

    const targets = (targetsResult.data || []) as ProductionTarget[];
    const production = (productionResult.data || []) as AssemblyDaily[];
    const budgets = (budgetsResult.data || []) as BudgetRow[];
    const bom = (bomResult.data || []) as BOMRow[];
    const products = productsResult.data || [];
    const componentOrders = (componentOrdersResult.data || []) as ComponentOrder[];
    const leadTimes = (leadTimesResult.data || []) as ComponentLeadTime[];

    // ========================================
    // Build lookup maps
    // ========================================

    // Display name map
    const displayNameMap: Record<string, string> = {};
    for (const p of products) {
      displayNameMap[p.sku] = p.display_name;
      displayNameMap[p.sku.toLowerCase()] = p.display_name;
    }

    // Component inventory from ShipHero
    const componentInventoryMap: Record<string, number> = {};
    for (const product of shipheroProducts) {
      const totalAvailable = (product.warehouse_products || []).reduce(
        (sum, wp) => sum + (wp.available || 0),
        0
      );
      componentInventoryMap[product.sku] = totalAvailable;
      componentInventoryMap[product.sku.toLowerCase()] = totalAvailable;
    }

    // BOM map: finished good -> components
    const bomMap = new Map<string, Array<{ component: string; qty: number }>>();
    for (const row of bom) {
      const key = row.finished_good_sku.toLowerCase();
      if (!bomMap.has(key)) bomMap.set(key, []);
      bomMap.get(key)!.push({ component: row.component_sku, qty: row.quantity_required });
    }

    // Reverse BOM map: component -> finished goods that use it
    const reverseBomMap = new Map<string, Array<{ finishedGood: string; qty: number }>>();
    for (const row of bom) {
      const key = row.component_sku.toLowerCase();
      if (!reverseBomMap.has(key)) reverseBomMap.set(key, []);
      reverseBomMap.get(key)!.push({ finishedGood: row.finished_good_sku, qty: row.quantity_required });
    }

    // Monthly targets map: "sku|year|month" -> target
    // IMPORTANT: Normalize SKUs to handle both short codes (10Trad) and full SKUs (Smith-CI-Skil10)
    const targetMap = new Map<string, number>();
    const originalSkuMap = new Map<string, string>(); // normalized -> original (for display names)
    for (const t of targets) {
      const normalizedSku = normalizeToShipHeroSku(t.sku);
      const key = `${normalizedSku}|${t.year}|${t.month}`;
      targetMap.set(key, t.target);
      originalSkuMap.set(normalizedSku, t.sku);
    }

    // Year sales forecast map (budgets also need normalization)
    const yearForecastMap = new Map<string, number>();
    for (const b of budgets) {
      const key = normalizeToShipHeroSku(b.sku);
      yearForecastMap.set(key, (yearForecastMap.get(key) || 0) + b.budget);
      if (!originalSkuMap.has(key)) originalSkuMap.set(key, b.sku);
    }

    // Component on-order aggregation
    const componentOnOrderMap = new Map<string, { qty: number; nextArrival: string | null }>();
    for (const order of componentOrders) {
      const key = order.component_sku.toLowerCase();
      // Guard: Prevent negative remaining if over-received
      const remaining = Math.max(0, order.quantity_ordered - order.quantity_received);
      const existing = componentOnOrderMap.get(key) || { qty: 0, nextArrival: null };
      existing.qty += remaining;
      if (order.expected_arrival) {
        if (!existing.nextArrival || order.expected_arrival < existing.nextArrival) {
          existing.nextArrival = order.expected_arrival;
        }
      }
      componentOnOrderMap.set(key, existing);
    }

    // Lead time map
    const leadTimeMap = new Map<string, number>();
    for (const lt of leadTimes) {
      const key = lt.component_sku.toLowerCase();
      if (!leadTimeMap.has(key) || lt.lead_time_days < leadTimeMap.get(key)!) {
        leadTimeMap.set(key, lt.lead_time_days);
      }
    }

    // ========================================
    // Calculate production by SKU by period
    // ========================================
    const productionBySkuByMonth = new Map<string, number>();
    const mtdBySkuMap = new Map<string, number>();
    const qtdBySkuMap = new Map<string, number>();
    const ytdBySkuMap = new Map<string, number>();

    const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const quarterStart = `${year}-${String(quarterMonths[0]).padStart(2, "0")}-01`;
    const yearStart = `${year}-01-01`;

    for (const p of production) {
      const sku = p.sku.toLowerCase();
      const qty = p.quantity || 0;
      const pDate = new Date(p.date);
      const pYear = pDate.getFullYear();
      const pMonth = pDate.getMonth() + 1;

      // Key for historical aggregation
      const monthKey = `${sku}|${pYear}|${pMonth}`;
      productionBySkuByMonth.set(monthKey, (productionBySkuByMonth.get(monthKey) || 0) + qty);

      // Current year aggregations
      if (p.date >= yearStart) {
        ytdBySkuMap.set(sku, (ytdBySkuMap.get(sku) || 0) + qty);
      }
      if (p.date >= quarterStart) {
        qtdBySkuMap.set(sku, (qtdBySkuMap.get(sku) || 0) + qty);
      }
      if (p.date >= monthStart) {
        mtdBySkuMap.set(sku, (mtdBySkuMap.get(sku) || 0) + qty);
      }
    }

    // ========================================
    // Get all manufactured SKUs (normalized to ShipHero format)
    // ========================================
    const allSkus = new Set<string>();
    for (const t of targets) {
      const normalized = normalizeToShipHeroSku(t.sku);
      // Check if the normalized SKU is a manufactured product
      if (isManufacturedProduct(normalized)) {
        allSkus.add(normalized);
      }
    }
    for (const b of budgets) {
      const normalized = normalizeToShipHeroSku(b.sku);
      if (isManufacturedProduct(normalized)) {
        allSkus.add(normalized);
      }
    }
    // Also add SKUs from assembly data that might not be in targets yet
    for (const p of production) {
      if (isManufacturedProduct(p.sku)) {
        allSkus.add(p.sku.toLowerCase());
      }
    }

    // Pre-populate with Glass Lids and CareKit so they appear in budget
    // even if no targets exist yet
    const alwaysTrackSkus = [
      "smith-ac-glid10",
      "smith-ac-glid11",
      "smith-ac-glid12",
      "smith-ac-glid14",
      "smith-ac-carekit",
    ];
    for (const sku of alwaysTrackSkus) {
      allSkus.add(sku);
    }

    // ========================================
    // Calculate total component demand across ALL SKUs
    // ========================================
    const componentDemandThisMonth = new Map<string, number>();
    const componentDemandNext3Months = new Map<string, number>();

    for (const skuLower of allSkus) {
      const components = bomMap.get(skuLower) || [];

      // Current month target
      const currentTarget = targetMap.get(`${skuLower}|${year}|${month}`) || 0;

      // Next 3 months targets
      let next3MonthsTarget = 0;
      for (let i = 1; i <= 3; i++) {
        const futureMonth = addMonths(year, month, i);
        const futureTarget = targetMap.get(`${skuLower}|${futureMonth.year}|${futureMonth.month}`) || 0;
        next3MonthsTarget += futureTarget;
      }

      for (const comp of components) {
        const compKey = comp.component.toLowerCase();
        componentDemandThisMonth.set(
          compKey,
          (componentDemandThisMonth.get(compKey) || 0) + currentTarget * comp.qty
        );
        componentDemandNext3Months.set(
          compKey,
          (componentDemandNext3Months.get(compKey) || 0) + (currentTarget + next3MonthsTarget) * comp.qty
        );
      }
    }

    // ========================================
    // Build SKU data with constraints
    // ========================================
    const skuData: SKUData[] = [];
    const constraintAlerts: ConstraintAlert[] = [];
    const componentLimitsMap = new Map<string, string[]>();

    for (const skuLower of allSkus) {
      // Get display name - try multiple sources:
      // 1. From products table (displayNameMap)
      // 2. From SKU_DISPLAY_NAMES mapping (shiphero.ts)
      // 3. Fallback to the SKU itself
      let displayName = displayNameMap[skuLower];
      if (!displayName) {
        // Try to find canonical SKU to get display name
        const upperSku = Object.keys(SKU_DISPLAY_NAMES).find(k => k.toLowerCase() === skuLower);
        displayName = upperSku ? SKU_DISPLAY_NAMES[upperSku] : skuLower;
      }
      const monthlyTarget = targetMap.get(`${skuLower}|${year}|${month}`) || 0;

      // Quarterly target
      let quarterlyTarget = 0;
      for (const m of quarterMonths) {
        quarterlyTarget += targetMap.get(`${skuLower}|${year}|${m}`) || 0;
      }

      const yearSalesForecast = yearForecastMap.get(skuLower) || 0;
      const producedMTD = mtdBySkuMap.get(skuLower) || 0;
      const producedQTD = qtdBySkuMap.get(skuLower) || 0;
      const producedYTD = ytdBySkuMap.get(skuLower) || 0;
      const remainingForYear = Math.max(0, yearSalesForecast - producedYTD);

      const percentToMonthlyTarget = monthlyTarget > 0 ? (producedMTD / monthlyTarget) * 100 : 0;
      const percentToQuarterlyTarget = quarterlyTarget > 0 ? (producedQTD / quarterlyTarget) * 100 : 0;
      const percentToYearTarget = yearSalesForecast > 0 ? (producedYTD / yearSalesForecast) * 100 : 0;

      // BOM constraint calculation
      let maxProducible = Infinity;
      let constrainingComponent = "";
      let constrainingQtyAvailable = 0;
      const bomComponents: BOMComponent[] = [];
      const components = bomMap.get(skuLower) || [];

      for (const comp of components) {
        // Warn on invalid BOM quantity (data error)
        if (comp.qty <= 0) {
          console.warn(`[BOM] Invalid quantity for ${skuLower}/${comp.component}: ${comp.qty} (treating as unlimited)`);
        }
        const available = componentInventoryMap[comp.component] ?? componentInventoryMap[comp.component.toLowerCase()] ?? 0;
        const possible = comp.qty > 0 ? Math.floor(available / comp.qty) : Infinity;

        if (possible < maxProducible) {
          maxProducible = possible;
          constrainingComponent = comp.component;
          constrainingQtyAvailable = available;
        }

        if (possible < monthlyTarget) {
          const limitsKey = comp.component.toLowerCase();
          if (!componentLimitsMap.has(limitsKey)) componentLimitsMap.set(limitsKey, []);
          componentLimitsMap.get(limitsKey)!.push(skuLower);
        }

        bomComponents.push({
          component: comp.component,
          qtyRequired: comp.qty,
          available,
          canMake: possible === Infinity ? -1 : possible,
          isConstraining: false,
          leadTimeDays: leadTimeMap.get(comp.component.toLowerCase()) ?? null,
        });
      }

      if (maxProducible === Infinity) maxProducible = -1;

      for (const bomComp of bomComponents) {
        if (bomComp.component === constrainingComponent) {
          bomComp.isConstraining = true;
        }
      }

      bomComponents.sort((a, b) => {
        if (a.isConstraining && !b.isConstraining) return -1;
        if (!a.isConstraining && b.isConstraining) return 1;
        return (a.canMake === -1 ? Infinity : a.canMake) - (b.canMake === -1 ? Infinity : b.canMake);
      });

      const hasConstraint = maxProducible >= 0 && maxProducible < monthlyTarget;
      const shortfall = hasConstraint ? monthlyTarget - maxProducible : 0;

      if (hasConstraint && shortfall > 0) {
        constraintAlerts.push({
          sku: skuLower,
          displayName,
          monthlyTarget,
          maxProducible,
          shortfall,
          constrainingComponent,
          componentAvailable: constrainingQtyAvailable,
        });
      }

      if (monthlyTarget > 0 || yearSalesForecast > 0) {
        skuData.push({
          sku: skuLower,
          displayName,
          category: getProductCategory(skuLower),
          monthlyTarget,
          producedMTD,
          percentToMonthlyTarget,
          quarterlyTarget,
          producedQTD,
          percentToQuarterlyTarget,
          yearSalesForecast,
          producedYTD,
          remainingForYear,
          percentToYearTarget,
          maxProducible,
          constrainingComponent,
          constrainingQtyAvailable,
          hasConstraint,
          shortfall,
          bomComponents,
        });
      }
    }

    // Sort SKU data
    const categoryOrder: Record<ProductCategory, number> = { cast_iron: 0, carbon_steel: 1, accessory: 2 };
    skuData.sort((a, b) => {
      if (categoryOrder[a.category] !== categoryOrder[b.category]) {
        return categoryOrder[a.category] - categoryOrder[b.category];
      }
      if (a.hasConstraint && !b.hasConstraint) return -1;
      if (!a.hasConstraint && b.hasConstraint) return 1;
      if (a.hasConstraint && b.hasConstraint) {
        if (b.shortfall !== a.shortfall) return b.shortfall - a.shortfall;
      }
      return a.percentToMonthlyTarget - b.percentToMonthlyTarget;
    });

    constraintAlerts.sort((a, b) => b.shortfall - a.shortfall);

    // ========================================
    // Build Component data with shared demand
    // ========================================
    const uniqueComponents = new Set<string>();
    for (const row of bom) uniqueComponents.add(row.component_sku);

    const components: ComponentData[] = [];
    const today = new Date(dateStr);

    for (const comp of uniqueComponents) {
      const compLower = comp.toLowerCase();
      const available = componentInventoryMap[comp] ?? componentInventoryMap[compLower] ?? 0;
      const onOrderInfo = componentOnOrderMap.get(compLower) || { qty: 0, nextArrival: null };
      const leadTimeDays = leadTimeMap.get(compLower) ?? null;
      const totalDemandThisMonth = componentDemandThisMonth.get(compLower) || 0;
      const totalDemandNext3Months = componentDemandNext3Months.get(compLower) || 0;

      // Which SKUs use this component
      const usedBySkus: ComponentData["usedBySkus"] = [];
      const reverseBom = reverseBomMap.get(compLower) || [];
      for (const usage of reverseBom) {
        const fgLower = usage.finishedGood.toLowerCase();
        const targetThisMonth = targetMap.get(`${fgLower}|${year}|${month}`) || 0;
        if (targetThisMonth > 0 || isManufacturedProduct(usage.finishedGood)) {
          usedBySkus.push({
            sku: usage.finishedGood,
            displayName: displayNameMap[fgLower] || usage.finishedGood,
            qtyPerUnit: usage.qty,
            demandThisMonth: targetThisMonth * usage.qty,
          });
        }
      }

      // Calculate runway (guard against zero daysInMonth)
      const dailyDemand = daysInMonth > 0 ? totalDemandThisMonth / daysInMonth : 0;
      const runwayDays = dailyDemand > 0 ? Math.floor(available / dailyDemand) : null;
      let runoutDate: string | null = null;
      if (runwayDays !== null && runwayDays < 365) {
        const runout = new Date(today);
        runout.setDate(runout.getDate() + runwayDays);
        runoutDate = runout.toISOString().split("T")[0];
      }

      // Order recommendation
      let orderRecommendation: ComponentData["orderRecommendation"] = null;
      const totalNeeded = totalDemandNext3Months;
      const totalSupply = available + onOrderInfo.qty;
      if (totalNeeded > totalSupply) {
        const shortfall = totalNeeded - totalSupply;
        let orderByDate: string | null = null;
        if (leadTimeDays !== null && runoutDate) {
          const orderBy = new Date(runoutDate);
          orderBy.setDate(orderBy.getDate() - leadTimeDays);
          if (orderBy > today) {
            orderByDate = orderBy.toISOString().split("T")[0];
          } else {
            orderByDate = "ASAP";
          }
        }
        orderRecommendation = {
          needed: true,
          quantity: Math.ceil(shortfall),
          orderByDate,
          reason: `Need ${shortfall.toLocaleString()} more to meet next 3 months demand`,
        };
      }

      components.push({
        sku: comp,
        available,
        onOrder: onOrderInfo.qty,
        nextArrival: onOrderInfo.nextArrival,
        leadTimeDays,
        totalDemandThisMonth,
        totalDemandNext3Months,
        usedBySkus: usedBySkus.sort((a, b) => b.demandThisMonth - a.demandThisMonth),
        runwayDays,
        runoutDate,
        orderRecommendation,
      });
    }

    // Sort components by urgency
    components.sort((a, b) => {
      // Components that need orders first
      if (a.orderRecommendation?.needed && !b.orderRecommendation?.needed) return -1;
      if (!a.orderRecommendation?.needed && b.orderRecommendation?.needed) return 1;
      // Then by runway days (shortest first)
      const aRunway = a.runwayDays ?? 999;
      const bRunway = b.runwayDays ?? 999;
      return aRunway - bRunway;
    });

    // ========================================
    // Build Forecast (next 6 months)
    // ========================================
    const forecast: MonthForecast[] = [];
    for (let i = 0; i <= 5; i++) {
      const futureMonth = addMonths(year, month, i);
      const skuTargets: MonthForecast["skuTargets"] = [];
      let totalTarget = 0;
      let constrainedCount = 0;

      for (const skuLower of allSkus) {
        const target = targetMap.get(`${skuLower}|${futureMonth.year}|${futureMonth.month}`) || 0;
        if (target > 0) {
          // For future months, calculate if we CAN produce based on current + on-order inventory
          const components = bomMap.get(skuLower) || [];
          let canProduce = Infinity;
          for (const comp of components) {
            // Warn on invalid BOM quantity (data error)
            if (comp.qty <= 0) {
              console.warn(`[BOM] Invalid quantity for ${skuLower}/${comp.component}: ${comp.qty} (treating as unlimited)`);
            }
            const available = componentInventoryMap[comp.component] ?? 0;
            const onOrder = componentOnOrderMap.get(comp.component.toLowerCase())?.qty || 0;
            const totalSupply = available + onOrder;
            const possible = comp.qty > 0 ? Math.floor(totalSupply / comp.qty) : Infinity;
            if (possible < canProduce) canProduce = possible;
          }
          if (canProduce === Infinity) canProduce = -1;

          const hasConstraint = canProduce >= 0 && canProduce < target;
          if (hasConstraint) constrainedCount++;

          skuTargets.push({
            sku: skuLower,
            displayName: displayNameMap[skuLower] || skuLower,
            target,
            canProduce,
            hasConstraint,
          });
          totalTarget += target;
        }
      }

      forecast.push({
        year: futureMonth.year,
        month: futureMonth.month,
        monthName: MONTH_NAMES[futureMonth.month - 1],
        skuTargets: skuTargets.sort((a, b) => b.target - a.target),
        totalTarget,
        constrainedSkuCount: constrainedCount,
      });
    }

    // ========================================
    // Build History (past 6 months)
    // ========================================
    const history: HistoricalMonth[] = [];
    for (let i = 1; i <= 6; i++) {
      const pastMonth = addMonths(year, month, -i);
      const skuPerformance: HistoricalMonth["skuPerformance"] = [];
      let totalTarget = 0;
      let totalProduced = 0;

      for (const skuLower of allSkus) {
        const target = targetMap.get(`${skuLower}|${pastMonth.year}|${pastMonth.month}`) || 0;
        const produced = productionBySkuByMonth.get(`${skuLower}|${pastMonth.year}|${pastMonth.month}`) || 0;

        if (target > 0 || produced > 0) {
          skuPerformance.push({
            sku: skuLower,
            displayName: displayNameMap[skuLower] || skuLower,
            target,
            produced,
            percentAchieved: target > 0 ? (produced / target) * 100 : 0,
          });
          totalTarget += target;
          totalProduced += produced;
        }
      }

      history.push({
        year: pastMonth.year,
        month: pastMonth.month,
        monthName: MONTH_NAMES[pastMonth.month - 1],
        totalTarget,
        totalProduced,
        percentAchieved: totalTarget > 0 ? (totalProduced / totalTarget) * 100 : 0,
        skuPerformance: skuPerformance.sort((a, b) => a.percentAchieved - b.percentAchieved),
      });
    }

    // ========================================
    // Build legacy component inventory
    // ========================================
    const componentInventory = components.map((c) => ({
      sku: c.sku,
      available: c.available,
      limitsSkus: componentLimitsMap.get(c.sku.toLowerCase()) || [],
    }));

    // ========================================
    // Build Accessories data (purchased from China)
    // ========================================
    const accessories: AccessoryData[] = [];
    const DEFAULT_CHINA_LEAD_TIME_DAYS = 90;
    const DEFAULT_SAFETY_STOCK_DAYS = 30;

    // Get unique accessory SKUs from budgets
    const accessorySkus = new Set<string>();
    for (const b of budgets) {
      if (isPurchasedAccessory(b.sku)) {
        accessorySkus.add(b.sku.toLowerCase());
      }
    }

    for (const skuLower of accessorySkus) {
      // Get display name
      const displayName = displayNameMap[skuLower] || skuLower;

      // Get inventory from ShipHero
      const available = componentInventoryMap[skuLower] ?? 0;

      // Get on-order info
      const onOrderInfo = componentOnOrderMap.get(skuLower) || { qty: 0, nextArrival: null };

      // Get lead time (or use default for China)
      const leadTimeDays = leadTimeMap.get(skuLower) ?? DEFAULT_CHINA_LEAD_TIME_DAYS;
      const safetyStockDays = DEFAULT_SAFETY_STOCK_DAYS;

      // Get sales forecast for this month and next 3 months
      let salesForecastThisMonth = 0;
      let salesForecastNext3Months = 0;
      for (const b of budgets) {
        if (b.sku.toLowerCase() === skuLower) {
          if (b.year === year && b.month === month) {
            salesForecastThisMonth = b.budget;
          }
          // Add to next 3 months if in range
          for (let i = 0; i <= 3; i++) {
            const futureMonth = addMonths(year, month, i);
            if (b.year === futureMonth.year && b.month === futureMonth.month) {
              salesForecastNext3Months += b.budget;
            }
          }
        }
      }

      // Calculate daily demand and runway (guard against zero daysInMonth)
      const dailyDemand = daysInMonth > 0 ? salesForecastThisMonth / daysInMonth : 0;
      const runwayDays = dailyDemand > 0 ? Math.floor(available / dailyDemand) : null;

      let runoutDate: string | null = null;
      if (runwayDays !== null && runwayDays < 365) {
        const runout = new Date(today);
        runout.setDate(runout.getDate() + runwayDays);
        runoutDate = runout.toISOString().split("T")[0];
      }

      // Calculate reorder point: (lead time + safety stock) * daily demand
      const reorderPoint = Math.ceil((leadTimeDays + safetyStockDays) * dailyDemand);
      const belowReorderPoint = available < reorderPoint;

      // Order recommendation
      let orderRecommendation: AccessoryData["orderRecommendation"] = null;
      if (belowReorderPoint || (available + onOrderInfo.qty) < salesForecastNext3Months) {
        // Calculate how much we need: 3 months forecast + safety stock - current supply
        const totalNeeded = salesForecastNext3Months + (safetyStockDays * dailyDemand);
        const totalSupply = available + onOrderInfo.qty;
        const shortfall = Math.max(0, totalNeeded - totalSupply);

        let orderByDate: string | null = null;
        if (runoutDate && leadTimeDays) {
          const orderBy = new Date(runoutDate);
          orderBy.setDate(orderBy.getDate() - leadTimeDays);
          if (orderBy > today) {
            orderByDate = orderBy.toISOString().split("T")[0];
          } else {
            orderByDate = "ASAP";
          }
        }

        orderRecommendation = {
          needed: true,
          quantity: Math.ceil(shortfall),
          orderByDate,
          reason: belowReorderPoint
            ? `Below reorder point (${reorderPoint.toLocaleString()} units)`
            : `Insufficient for next 3 months (need ${salesForecastNext3Months.toLocaleString()})`,
        };
      }

      accessories.push({
        sku: skuLower,
        displayName,
        available,
        onOrder: onOrderInfo.qty,
        nextArrival: onOrderInfo.nextArrival,
        leadTimeDays,
        salesForecastThisMonth,
        salesForecastNext3Months,
        dailyDemand,
        runwayDays,
        runoutDate,
        safetyStockDays,
        reorderPoint,
        belowReorderPoint,
        orderRecommendation,
      });
    }

    // Sort accessories: below reorder point first, then by runway
    accessories.sort((a, b) => {
      if (a.belowReorderPoint && !b.belowReorderPoint) return -1;
      if (!a.belowReorderPoint && b.belowReorderPoint) return 1;
      const aRunway = a.runwayDays ?? 999;
      const bRunway = b.runwayDays ?? 999;
      return aRunway - bRunway;
    });

    // ========================================
    // Inventory Curves - Projected inventory over the year
    // KEY INSIGHT: Inventory carries forward. Current ShipHero inventory is our starting point.
    // We project forward: inventory + production targets - budget (what we'll sell)
    // ========================================

    // Build monthly budget map: sku -> month -> budget
    const monthlyBudgetMap = new Map<string, Map<number, number>>();
    for (const b of budgets) {
      const skuLower = b.sku.toLowerCase();
      if (!monthlyBudgetMap.has(skuLower)) monthlyBudgetMap.set(skuLower, new Map());
      monthlyBudgetMap.get(skuLower)!.set(b.month, b.budget);
    }

    const inventoryCurves: InventoryCurve[] = [];
    const aggregateMonths: InventoryCurveMonth[] = [];

    // Initialize aggregate tracking
    for (let m = 1; m <= 12; m++) {
      aggregateMonths.push({
        month: m,
        monthName: MONTH_NAMES[m - 1],
        cumulativeBudget: 0,
        cumulativeProduction: 0,
        gap: 0,
        isActual: m < month, // Only past months are "actual"
      });
    }

    for (const skuLower of allSkus) {
      const displayName = displayNameMap[skuLower] || skuLower;
      const skuBudgets = monthlyBudgetMap.get(skuLower) || new Map();
      const yearBudget = Array.from(skuBudgets.values()).reduce((a, b) => a + b, 0);

      if (yearBudget === 0) continue; // Skip SKUs with no budget

      // Get CURRENT inventory from ShipHero - this is our starting point
      // This already accounts for all past production and sales
      const currentInventory = componentInventoryMap[skuLower] ?? 0;

      const months: InventoryCurveMonth[] = [];
      let minGap = Infinity;
      let minGapMonth = "";
      let currentGap = currentInventory; // Start with what we have
      let stockoutRisk = false;

      // Track cumulative from start of year for the chart
      let cumulativeBudget = 0;
      let cumulativeProduction = 0;

      // For past months, we show cumulative production vs budget
      // For current month, we use actual inventory
      // For future months, we project from current inventory

      for (let m = 1; m <= 12; m++) {
        const monthBudget = skuBudgets.get(m) || 0;
        const monthTarget = targetMap.get(`${skuLower}|${year}|${m}`) || 0;
        const monthActualProduction = productionBySkuByMonth.get(`${skuLower}|${year}|${m}`) || 0;

        cumulativeBudget += monthBudget;

        let projectedInventory: number;
        const isPastMonth = m < month;
        const isCurrentMonth = m === month;

        if (isPastMonth) {
          // Past month: show actual production
          cumulativeProduction += monthActualProduction;
          projectedInventory = cumulativeProduction - cumulativeBudget;
        } else if (isCurrentMonth) {
          // Current month: use actual current inventory from ShipHero
          // This accounts for actual sales and production to date
          projectedInventory = currentInventory;
          cumulativeProduction = projectedInventory + cumulativeBudget; // Back-calculate
        } else {
          // Future month: project from current inventory
          // Each month: previous inventory + target production - budget (sales)
          const monthsAhead = m - month;
          let futureInventory = currentInventory;

          // Add production targets and subtract budgets for each month from now until m
          for (let futureM = month; futureM < m; futureM++) {
            const futureBudget = skuBudgets.get(futureM) || 0;
            const futureTarget = targetMap.get(`${skuLower}|${year}|${futureM}`) || 0;
            futureInventory += futureTarget - futureBudget;
          }
          // Add this month's production, subtract this month's sales
          futureInventory += monthTarget - monthBudget;

          projectedInventory = futureInventory;
          cumulativeProduction = projectedInventory + cumulativeBudget; // For chart consistency
        }

        const gap = projectedInventory;

        // Track minimum gap (most at-risk point - lowest inventory)
        if (gap < minGap) {
          minGap = gap;
          minGapMonth = MONTH_NAMES[m - 1];
        }

        // If projected inventory goes negative, we have stockout risk
        if (gap < 0) {
          stockoutRisk = true;
        }

        // Track current gap
        if (isCurrentMonth) {
          currentGap = gap;
        }

        months.push({
          month: m,
          monthName: MONTH_NAMES[m - 1],
          cumulativeBudget,
          cumulativeProduction,
          gap,
          isActual: isPastMonth,
        });

        // Add to aggregate
        aggregateMonths[m - 1].cumulativeBudget += cumulativeBudget;
        aggregateMonths[m - 1].cumulativeProduction += cumulativeProduction;
        aggregateMonths[m - 1].gap += gap;
      }

      // Determine status based on current inventory and future risk
      let status: InventoryCurve["status"];
      if (currentGap < 0) {
        status = "critical"; // Currently out of stock
      } else if (stockoutRisk) {
        status = "behind"; // Will run out at some point
      } else if (minGap < yearBudget * 0.1) {
        status = "on_track"; // Cutting it close
      } else {
        status = "ahead"; // Comfortable buffer
      }

      const currentGapPercent = yearBudget > 0 ? (currentGap / yearBudget) * 100 : 0;

      inventoryCurves.push({
        sku: skuLower,
        displayName,
        category: getProductCategory(skuLower),
        year,
        months,
        currentGap,
        currentGapPercent,
        minGap: minGap === Infinity ? 0 : minGap,
        minGapMonth,
        stockoutRisk,
        status,
      });
    }

    // Sort curves: critical first, then by current gap
    inventoryCurves.sort((a, b) => {
      const statusOrder = { critical: 0, behind: 1, on_track: 2, ahead: 3 };
      if (statusOrder[a.status] !== statusOrder[b.status]) {
        return statusOrder[a.status] - statusOrder[b.status];
      }
      return a.currentGap - b.currentGap;
    });

    // Aggregate status
    const totalCurrentGap = aggregateMonths[month - 1]?.gap || 0;
    let aggregateStatus: InventoryCurve["status"];
    const hasAnyCritical = inventoryCurves.some(c => c.status === "critical");
    const hasAnyBehind = inventoryCurves.some(c => c.status === "behind");

    if (hasAnyCritical) {
      aggregateStatus = "critical";
    } else if (hasAnyBehind) {
      aggregateStatus = "behind";
    } else if (totalCurrentGap < 5000) {
      aggregateStatus = "on_track";
    } else {
      aggregateStatus = "ahead";
    }

    const aggregateCurve = {
      months: aggregateMonths,
      currentGap: totalCurrentGap,
      status: aggregateStatus,
    };

    // ========================================
    // Summary
    // ========================================
    const totalMonthlyTarget = skuData.reduce((sum, s) => sum + s.monthlyTarget, 0);
    const totalProducedMTD = skuData.reduce((sum, s) => sum + s.producedMTD, 0);
    const totalYearForecast = skuData.reduce((sum, s) => sum + s.yearSalesForecast, 0);
    const totalProducedYTD = skuData.reduce((sum, s) => sum + s.producedYTD, 0);

    const summary = {
      totalMonthlyTarget,
      totalProducedMTD,
      percentToMonthlyTarget: totalMonthlyTarget > 0 ? (totalProducedMTD / totalMonthlyTarget) * 100 : 0,
      totalYearForecast,
      totalProducedYTD,
      constrainedSkuCount: constraintAlerts.length,
    };

    // ========================================
    // Response
    // ========================================

    // Calculate daysElapsedInMonth based on whether this is past/current/future
    const actualToday = getESTDate();
    let daysElapsedInMonth: number;

    if (year < actualToday.year || (year === actualToday.year && month < actualToday.month)) {
      // Past month - all days elapsed
      daysElapsedInMonth = daysInMonth;
    } else if (year === actualToday.year && month === actualToday.month) {
      // Current month - use today's day
      daysElapsedInMonth = actualToday.day;
    } else {
      // Future month - no days elapsed yet
      daysElapsedInMonth = 0;
    }

    // ========================================
    // Yearly Targets Overview
    // ========================================
    // Aggregate targets and production by month for the displayed year
    const yearlyTargets: YearlyTargetMonth[] = [];

    for (let m = 1; m <= 12; m++) {
      // Sum targets for this month
      const monthTargets = targets.filter(t => t.year === year && t.month === m);
      const monthlyTargetTotal = monthTargets.reduce((sum, t) => sum + (t.target || 0), 0);

      // Sum production for this month
      const monthStart = `${year}-${String(m).padStart(2, "0")}-01`;
      const monthEnd = `${year}-${String(m).padStart(2, "0")}-${getDaysInMonth(year, m)}`;
      const monthProduction = production
        .filter(p => p.date >= monthStart && p.date <= monthEnd)
        .reduce((sum, p) => sum + (p.quantity || 0), 0);

      const isCurrent = year === actualToday.year && m === actualToday.month;
      const isFuture = year > actualToday.year || (year === actualToday.year && m > actualToday.month);

      yearlyTargets.push({
        month: m,
        monthName: MONTH_NAMES[m - 1],
        target: monthlyTargetTotal,
        produced: monthProduction,
        isCurrent,
        isFuture,
      });
    }

    // ========================================
    // Annual SKU Targets - per-SKU annual budget
    // ========================================
    const annualSkuTargets: AnnualSkuTarget[] = [];

    for (const skuLower of allSkus) {
      // Build monthly targets array (index 0 = January)
      const monthlyTargets: number[] = [];
      let annualTarget = 0;

      for (let m = 1; m <= 12; m++) {
        const monthTarget = targetMap.get(`${skuLower}|${year}|${m}`) || 0;
        monthlyTargets.push(monthTarget);
        annualTarget += monthTarget;
      }

      // Skip SKUs with no annual target
      if (annualTarget === 0) continue;

      const producedYTD = ytdBySkuMap.get(skuLower) || 0;
      const remaining = Math.max(0, annualTarget - producedYTD);

      // Get display name
      let displayName = displayNameMap[skuLower];
      if (!displayName) {
        const upperSku = Object.keys(SKU_DISPLAY_NAMES).find(k => k.toLowerCase() === skuLower);
        displayName = upperSku ? SKU_DISPLAY_NAMES[upperSku] : skuLower;
      }

      annualSkuTargets.push({
        sku: skuLower,
        displayName,
        category: getProductCategory(skuLower),
        monthlyTargets,
        annualTarget,
        producedYTD,
        remaining,
      });
    }

    // Sort by category then by annual target descending
    annualSkuTargets.sort((a, b) => {
      const categoryOrder: Record<ProductCategory, number> = { cast_iron: 0, carbon_steel: 1, accessory: 2 };
      if (categoryOrder[a.category] !== categoryOrder[b.category]) {
        return categoryOrder[a.category] - categoryOrder[b.category];
      }
      return b.annualTarget - a.annualTarget;
    });

    const response: ProductionPlanningResponse = {
      asOfDate: dateStr,
      period: {
        year,
        month,
        monthName: MONTH_NAMES[month - 1],
        quarter,
        daysInMonth,
        daysElapsedInMonth,
      },
      skuData,
      constraintAlerts,
      summary,
      components,
      accessories,
      forecast,
      history,
      inventoryCurves,
      aggregateCurve,
      componentInventory,
      yearlyTargets,
      annualSkuTargets,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Production planning API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
