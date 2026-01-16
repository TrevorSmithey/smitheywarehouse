/**
 * Wholesale Forecasting Logic
 *
 * Contains constants and calculation functions for the Driver tab.
 * All values validated against 3-year historical data (2023-2025).
 */

import type {
  ForecastDoorScenario,
  ForecastMonthlyUnits,
  ForecastSkuMix,
  ForecastQuarterActuals,
} from "@/lib/types";

// ============================================================================
// SEASONALITY CONSTANTS (Validated from 3-Year Averages 2023-2025)
// ============================================================================

/**
 * B2B quarterly seasonality distribution.
 * Based on 3-year average (2023-2025).
 * Standard deviation is low (1.3-3.4%), indicating stable patterns.
 */
export const B2B_SEASONALITY = {
  q1: 0.20, // 20.4% avg, std dev 2.6
  q2: 0.21, // 20.5% avg, std dev 1.3
  q3: 0.22, // 22.2% avg, std dev 3.4
  q4: 0.37, // 36.9% avg, std dev 2.2
} as const;

/**
 * Corporate quarterly seasonality distribution.
 * Based on 3-year average (2023-2025).
 * High variability in Q3/Q4 (std dev 10-12%) - corporate is unpredictable.
 */
export const CORP_SEASONALITY = {
  q1: 0.20, // 20.1% avg, std dev 4.4
  q2: 0.06, // 5.6% avg, std dev 0.4
  q3: 0.16, // 16.1% avg, std dev 10.7
  q4: 0.58, // 58.2% avg, std dev 12.0
} as const;

/**
 * Monthly distribution within each quarter.
 * Assumes relatively even spread within quarter.
 * B2B tends to be more back-weighted, Corporate even more so in Q4.
 */
export const MONTHLY_WITHIN_QUARTER = {
  default: [0.30, 0.33, 0.37], // Slightly back-weighted
  q4: [0.28, 0.32, 0.40], // More back-weighted (holiday push)
} as const;

// ============================================================================
// DOOR ECONOMICS BENCHMARKS (Validated from Historical Data)
// ============================================================================

/**
 * Door economics benchmarks based on 3-year historical analysis.
 * These are defaults for new forecasts - users can override.
 */
export const DOOR_BENCHMARKS = {
  // Retention metrics (2023-2024 average)
  avgRetentionRate: 0.83, // 83% of doors return year-over-year
  avgChurnRate: 0.17, // 17% annual churn

  // Revenue growth from retained doors
  sameStoreGrowth: 0.11, // 11% avg revenue growth from retained doors

  // New door economics
  newDoorFirstYearYield: 6000, // Conservative estimate ($5,900 in 2024)
  returningDoorAvgYield: 11500, // Avg revenue from returning doors

  // Door counts (end of 2025)
  currentDoorCount: 436, // Active B2B doors at end of 2025
} as const;

/**
 * SKU mix by revenue share (B2B only, Full Year 2025).
 * Based on $5.93M total B2B revenue Jan-Dec 2025.
 * Covers ~75% of B2B revenue (top cookware + accessories + lids).
 *
 * IMPORTANT: sku_name must match canonical SKU_DISPLAY_NAMES from lib/shiphero.ts
 * See BUSINESS_LOGIC.md "SKU Reference Table" for official SKU → Internal Name mapping.
 */
export const DEFAULT_SKU_MIX: Omit<ForecastSkuMix, "id" | "forecast_id">[] = [
  // === CAST IRON COOKWARE ===
  { sku: "Smith-CI-Skil12", sku_name: "12Trad", revenue_share_pct: 0.117, avg_unit_price: 123 },
  { sku: "Smith-CI-Skil10", sku_name: "10Trad", revenue_share_pct: 0.063, avg_unit_price: 98 },
  { sku: "Smith-CI-Skil14", sku_name: "14Dual", revenue_share_pct: 0.048, avg_unit_price: 137 },
  { sku: "Smith-CI-Griddle18", sku_name: "Double Burner Griddle", revenue_share_pct: 0.040, avg_unit_price: 173 },
  { sku: "Smith-CI-DSkil11", sku_name: "11Deep", revenue_share_pct: 0.040, avg_unit_price: 125 },
  { sku: "Smith-CI-Chef10", sku_name: "10Chef", revenue_share_pct: 0.031, avg_unit_price: 86 },
  { sku: "Smith-CI-Dutch5", sku_name: "5.5 Dutch", revenue_share_pct: 0.031, avg_unit_price: 174 },
  { sku: "Smith-CI-Skil8", sku_name: "8Chef", revenue_share_pct: 0.026, avg_unit_price: 65 },
  { sku: "Smith-CI-Dutch7", sku_name: "7.25 Dutch", revenue_share_pct: 0.020, avg_unit_price: 207 },
  { sku: "Smith-CI-Flat12", sku_name: "12Flat", revenue_share_pct: 0.019, avg_unit_price: 78 },
  { sku: "Smith-CI-Tradskil14", sku_name: "14Trad", revenue_share_pct: 0.019, avg_unit_price: 136 },
  { sku: "Smith-CI-Grill12", sku_name: "12Grill", revenue_share_pct: 0.019, avg_unit_price: 122 },
  { sku: "Smith-CI-Dual12", sku_name: "12Dual", revenue_share_pct: 0.019, avg_unit_price: 123 },
  { sku: "Smith-CI-Dutch4", sku_name: "4 Dutch", revenue_share_pct: 0.010, avg_unit_price: 127 },
  { sku: "Smith-CI-Skil6", sku_name: "6Skillet", revenue_share_pct: 0.007, avg_unit_price: 46 },
  { sku: "Smith-CI-Flat10", sku_name: "10Flat", revenue_share_pct: 0.005, avg_unit_price: 68 },
  { sku: "Smith-CI-Dual6", sku_name: "6Dual", revenue_share_pct: 0.004, avg_unit_price: 46 },

  // === CARBON STEEL COOKWARE ===
  { sku: "Smith-CS-Deep12", sku_name: "Deep Farm", revenue_share_pct: 0.033, avg_unit_price: 192 },
  { sku: "Smith-CS-Farm12", sku_name: "Farmhouse Skillet", revenue_share_pct: 0.022, avg_unit_price: 176 },
  { sku: "Smith-CS-WokM", sku_name: "Wok", revenue_share_pct: 0.020, avg_unit_price: 192 },
  { sku: "Smith-CS-OvalM", sku_name: "Oval Roaster", revenue_share_pct: 0.014, avg_unit_price: 172 },
  { sku: "Smith-CS-Farm9", sku_name: "Little Farm", revenue_share_pct: 0.014, avg_unit_price: 118 },
  { sku: "Smith-CS-RRoastM", sku_name: "Round Roaster", revenue_share_pct: 0.010, avg_unit_price: 171 },
  { sku: "Smith-CS-Round17N", sku_name: "17 Round", revenue_share_pct: 0.009, avg_unit_price: 220 },
  { sku: "Smith-CS-Fish", sku_name: "Fish Skillet", revenue_share_pct: 0.005, avg_unit_price: 174 },

  // === ACCESSORIES ===
  { sku: "Smith-AC-SpatB1", sku_name: "Mighty Spat", revenue_share_pct: 0.009, avg_unit_price: 23 },
  { sku: "Smith-AC-Scrub1", sku_name: "Chainmail Scrubber", revenue_share_pct: 0.007, avg_unit_price: 10 },
  { sku: "Smith-AC-SpatW1", sku_name: "Slotted Spat", revenue_share_pct: 0.006, avg_unit_price: 17 },
  { sku: "Smith-AC-Sleeve2", sku_name: "Long Sleeve", revenue_share_pct: 0.004, avg_unit_price: 14 },
  { sku: "Smith-AC-Sleeve1", sku_name: "Short Sleeve", revenue_share_pct: 0.004, avg_unit_price: 13 },
  { sku: "Smith-AC-CareKit", sku_name: "Care Kit", revenue_share_pct: 0.004, avg_unit_price: 32 },

  // === GLASS LIDS ===
  { sku: "Smith-AC-Glid12", sku_name: "12Lid", revenue_share_pct: 0.006, avg_unit_price: 27 },
  { sku: "Smith-AC-Glid14", sku_name: "14Lid", revenue_share_pct: 0.005, avg_unit_price: 29 },
  { sku: "Smith-AC-Glid10", sku_name: "10Lid", revenue_share_pct: 0.004, avg_unit_price: 24 },
];

/**
 * Blended average unit price across all SKUs.
 * Used as fallback when specific SKU prices are missing.
 */
export const BLENDED_AUP = 120;

// ============================================================================
// CORPORATE ENGRAVING ECONOMICS (Added 2026-01-16)
// ============================================================================

/**
 * Corporate-specific engraving economics.
 *
 * Corporate customers frequently order engraved products for gifting.
 * Engraving (SMITH-ENG) is a SERVICE, not a physical product.
 *
 * For accurate unit projections:
 * - Separate physical products from engraving revenue
 * - Use physical AUP for production planning
 * - Use attach rate for engraving capacity planning
 *
 * Based on 2024-Present corporate transaction data ($1.95M revenue).
 * See BUSINESS_LOGIC.md "Wholesale Forecasting" for full methodology.
 */
export const CORPORATE_ENGRAVING = {
  /** 14.4% of physical corporate units get engraved */
  attachRate: 0.144,

  /** Average engraving price ($18.31) */
  averagePrice: 18.31,

  /** Engraving is 15.4% of total corporate revenue */
  revenueShare: 0.154,

  /** Physical products are 84.6% of corporate revenue */
  physicalRevenueShare: 0.846,

  /** Physical product AUP (excluding engraving) */
  physicalAUP: 14.44,
} as const;

/**
 * Compute corporate unit projection from revenue target.
 * Separates physical units (for production) from engraving (for capacity).
 *
 * @param corporateRevenue - Target corporate revenue
 * @returns Physical units, engraving units, and totals
 */
export function computeCorporateUnits(corporateRevenue: number): {
  physicalRevenue: number;
  engravingRevenue: number;
  physicalUnits: number;
  engravingUnits: number;
  totalRevenue: number;
} {
  const physicalRevenue = corporateRevenue * CORPORATE_ENGRAVING.physicalRevenueShare;
  const engravingRevenue = corporateRevenue * CORPORATE_ENGRAVING.revenueShare;
  const physicalUnits = Math.round(physicalRevenue / CORPORATE_ENGRAVING.physicalAUP);
  const engravingUnits = Math.round(physicalUnits * CORPORATE_ENGRAVING.attachRate);

  return {
    physicalRevenue: Math.round(physicalRevenue),
    engravingRevenue: Math.round(engravingRevenue),
    physicalUnits,
    engravingUnits,
    totalRevenue: corporateRevenue,
  };
}

// ============================================================================
// CALCULATION FUNCTIONS
// ============================================================================

/**
 * Compute quarterly revenue targets from annual total using seasonality.
 */
export function computeQuarterlyTargets(
  annualTarget: number,
  seasonality: { q1: number; q2: number; q3: number; q4: number } = B2B_SEASONALITY
): { q1: number; q2: number; q3: number; q4: number } {
  return {
    q1: Math.round(annualTarget * seasonality.q1),
    q2: Math.round(annualTarget * seasonality.q2),
    q3: Math.round(annualTarget * seasonality.q3),
    q4: Math.round(annualTarget * seasonality.q4),
  };
}

/**
 * Compute monthly revenue from quarterly total.
 * Returns array of 3 monthly values for the quarter.
 */
export function computeMonthlyFromQuarterly(
  quarterlyRevenue: number,
  quarter: 1 | 2 | 3 | 4
): number[] {
  const distribution =
    quarter === 4 ? MONTHLY_WITHIN_QUARTER.q4 : MONTHLY_WITHIN_QUARTER.default;

  return distribution.map((pct) => Math.round(quarterlyRevenue * pct));
}

/**
 * Compute monthly unit forecast from monthly revenue and SKU mix.
 */
export function computeMonthlyUnits(
  monthlyRevenue: number,
  month: string, // Short month name ("Jan", "Feb", etc.) for dashboard; passed through as-is
  skuMix: Array<Omit<ForecastSkuMix, "id" | "forecast_id">>
): ForecastMonthlyUnits[] {
  return skuMix.map((sku) => {
    const skuRevenue = monthlyRevenue * sku.revenue_share_pct;
    const units = Math.round(skuRevenue / (sku.avg_unit_price || BLENDED_AUP));

    // Confidence decreases for smaller SKUs (less data = more variance)
    const confidencePct = sku.revenue_share_pct > 0.05 ? 10 : sku.revenue_share_pct > 0.02 ? 15 : 20;

    return {
      month,
      sku: sku.sku,
      sku_name: sku.sku_name,
      units,
      revenue: Math.round(skuRevenue),
      confidence_pct: confidencePct,
    };
  });
}

/**
 * Generate full year monthly unit forecast.
 */
export function computeFullYearUnits(
  annualB2BTarget: number,
  fiscalYear: number,
  skuMix: Array<Omit<ForecastSkuMix, "id" | "forecast_id">> = DEFAULT_SKU_MIX
): ForecastMonthlyUnits[] {
  const quarterly = computeQuarterlyTargets(annualB2BTarget, B2B_SEASONALITY);
  const allMonthlyUnits: ForecastMonthlyUnits[] = [];

  // Q1: Jan, Feb, Mar
  const q1Monthly = computeMonthlyFromQuarterly(quarterly.q1, 1);
  [1, 2, 3].forEach((m, i) => {
    const month = `${fiscalYear}-${String(m).padStart(2, "0")}`;
    allMonthlyUnits.push(...computeMonthlyUnits(q1Monthly[i], month, skuMix));
  });

  // Q2: Apr, May, Jun
  const q2Monthly = computeMonthlyFromQuarterly(quarterly.q2, 2);
  [4, 5, 6].forEach((m, i) => {
    const month = `${fiscalYear}-${String(m).padStart(2, "0")}`;
    allMonthlyUnits.push(...computeMonthlyUnits(q2Monthly[i], month, skuMix));
  });

  // Q3: Jul, Aug, Sep
  const q3Monthly = computeMonthlyFromQuarterly(quarterly.q3, 3);
  [7, 8, 9].forEach((m, i) => {
    const month = `${fiscalYear}-${String(m).padStart(2, "0")}`;
    allMonthlyUnits.push(...computeMonthlyUnits(q3Monthly[i], month, skuMix));
  });

  // Q4: Oct, Nov, Dec
  const q4Monthly = computeMonthlyFromQuarterly(quarterly.q4, 4);
  [10, 11, 12].forEach((m, i) => {
    const month = `${fiscalYear}-${String(m).padStart(2, "0")}`;
    allMonthlyUnits.push(...computeMonthlyUnits(q4Monthly[i], month, skuMix));
  });

  return allMonthlyUnits;
}

// ============================================================================
// DOOR DRIVER SCENARIO ANALYSIS
// ============================================================================

export interface DoorDriverParams {
  existingDoorsStart: number;
  newDoorsTarget: number;
  expectedChurnDoors: number;
  organicGrowthPct: number;
  newDoorFirstYearYield: number;
  returningDoorAvgYield?: number;
  annualB2BTarget: number;
}

/**
 * Compute implied revenue from door drivers and compare to target.
 */
export function computeDoorScenario(
  params: DoorDriverParams,
  scenarioName: string = "Base Plan"
): ForecastDoorScenario {
  const {
    existingDoorsStart,
    newDoorsTarget,
    expectedChurnDoors,
    organicGrowthPct,
    newDoorFirstYearYield,
    returningDoorAvgYield = DOOR_BENCHMARKS.returningDoorAvgYield,
    annualB2BTarget,
  } = params;

  // Calculate ending door count
  const endingDoors = existingDoorsStart - expectedChurnDoors + newDoorsTarget;

  // Revenue from existing book (retained doors with organic growth)
  const retainedDoors = existingDoorsStart - expectedChurnDoors;
  const existingBookRevenue = Math.round(
    retainedDoors * returningDoorAvgYield * (1 + organicGrowthPct)
  );

  // Revenue from new doors (partial year, apply seasonality factor)
  // Assume new doors acquired evenly through year, so ~50% of annual yield
  const seasonalityFactor = 0.5;
  const newDoorRevenue = Math.round(
    newDoorsTarget * newDoorFirstYearYield * seasonalityFactor
  );

  // Total implied revenue
  const totalImpliedRevenue = existingBookRevenue + newDoorRevenue;

  // Gap to target
  const gapToTarget = annualB2BTarget - totalImpliedRevenue;

  return {
    scenario_name: scenarioName,
    existing_doors_start: existingDoorsStart,
    expected_churn: expectedChurnDoors,
    new_doors: newDoorsTarget,
    organic_growth_pct: organicGrowthPct,
    new_door_yield: newDoorFirstYearYield,
    ending_doors: endingDoors,
    existing_book_revenue: existingBookRevenue,
    new_door_revenue: newDoorRevenue,
    total_implied_revenue: totalImpliedRevenue,
    gap_to_target: gapToTarget,
    is_achievable: gapToTarget <= 0,
  };
}

/**
 * Generate multiple scenarios varying key assumptions.
 * Useful for sensitivity analysis.
 */
export function computeDoorScenarios(
  baseParams: DoorDriverParams
): ForecastDoorScenario[] {
  const scenarios: ForecastDoorScenario[] = [];

  // 1. Base scenario
  scenarios.push(computeDoorScenario(baseParams, "Base Plan"));

  // 2. Conservative organic growth (5% instead of base)
  scenarios.push(
    computeDoorScenario(
      { ...baseParams, organicGrowthPct: 0.05 },
      "Conservative (5% organic)"
    )
  );

  // 3. Aggressive new door acquisition (+25%)
  scenarios.push(
    computeDoorScenario(
      { ...baseParams, newDoorsTarget: Math.round(baseParams.newDoorsTarget * 1.25) },
      "Aggressive (+25% new doors)"
    )
  );

  // 4. Higher churn scenario (+50%)
  scenarios.push(
    computeDoorScenario(
      {
        ...baseParams,
        expectedChurnDoors: Math.round(baseParams.expectedChurnDoors * 1.5),
      },
      "Higher Churn (+50%)"
    )
  );

  // 5. Optimistic scenario (all factors favorable)
  scenarios.push(
    computeDoorScenario(
      {
        ...baseParams,
        organicGrowthPct: baseParams.organicGrowthPct * 1.2,
        newDoorsTarget: Math.round(baseParams.newDoorsTarget * 1.15),
        expectedChurnDoors: Math.round(baseParams.expectedChurnDoors * 0.8),
      },
      "Optimistic"
    )
  );

  return scenarios;
}

// ============================================================================
// QUARTERLY ACTUALS HELPERS
// ============================================================================

/**
 * Get quarter number from month (1-12 → 1-4)
 */
export function getQuarterFromMonth(month: number): 1 | 2 | 3 | 4 {
  if (month <= 3) return 1;
  if (month <= 6) return 2;
  if (month <= 9) return 3;
  return 4;
}

/**
 * Get days in a quarter for a given year
 */
export function getDaysInQuarter(quarter: 1 | 2 | 3 | 4, year: number): number {
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

  switch (quarter) {
    case 1:
      return isLeapYear ? 91 : 90; // Jan 31 + Feb 28/29 + Mar 31
    case 2:
      return 91; // Apr 30 + May 31 + Jun 30
    case 3:
      return 92; // Jul 31 + Aug 31 + Sep 30
    case 4:
      return 92; // Oct 31 + Nov 30 + Dec 31
  }
}

/**
 * Calculate pacing status based on variance percentage
 */
export function getPacingStatus(
  variancePct: number
): "ahead" | "on_track" | "behind" {
  if (variancePct >= 5) return "ahead";
  if (variancePct >= -5) return "on_track";
  return "behind";
}

/**
 * Build quarterly actuals comparison from targets and actual revenue
 */
export function buildQuarterlyActuals(
  b2bTargets: { q1: number; q2: number; q3: number; q4: number },
  corpTargets: { q1: number; q2: number; q3: number; q4: number },
  b2bActuals: { q1: number; q2: number; q3: number; q4: number },
  corpActuals: { q1: number; q2: number; q3: number; q4: number },
  currentDate: Date = new Date()
): ForecastQuarterActuals[] {
  const year = currentDate.getFullYear();
  const currentQuarter = getQuarterFromMonth(currentDate.getMonth() + 1);
  const dayOfMonth = currentDate.getDate();

  return ([1, 2, 3, 4] as const).map((q) => {
    const isComplete = q < currentQuarter;
    const isCurrent = q === currentQuarter;

    // Days calculation
    const daysTotal = getDaysInQuarter(q, year);
    let daysElapsed = 0;

    if (isComplete) {
      daysElapsed = daysTotal;
    } else if (isCurrent) {
      // Calculate days elapsed in current quarter
      const quarterStartMonth = (q - 1) * 3;
      const monthsElapsed = currentDate.getMonth() - quarterStartMonth;

      // Days from completed months in quarter
      for (let m = 0; m < monthsElapsed; m++) {
        const monthDate = new Date(year, quarterStartMonth + m, 1);
        daysElapsed += new Date(
          monthDate.getFullYear(),
          monthDate.getMonth() + 1,
          0
        ).getDate();
      }
      // Add current day
      daysElapsed += dayOfMonth;
    }

    const b2bTarget = b2bTargets[`q${q}` as keyof typeof b2bTargets];
    const b2bActual = b2bActuals[`q${q}` as keyof typeof b2bActuals];
    const corpTarget = corpTargets[`q${q}` as keyof typeof corpTargets];
    const corpActual = corpActuals[`q${q}` as keyof typeof corpActuals];

    return {
      quarter: q,
      b2b_target: b2bTarget,
      b2b_actual: b2bActual,
      b2b_variance: b2bActual - b2bTarget,
      b2b_variance_pct: b2bTarget > 0 ? ((b2bActual - b2bTarget) / b2bTarget) * 100 : 0,
      corp_target: corpTarget,
      corp_actual: corpActual,
      corp_variance: corpActual - corpTarget,
      corp_variance_pct: corpTarget > 0 ? ((corpActual - corpTarget) / corpTarget) * 100 : 0,
      is_complete: isComplete,
      days_elapsed: daysElapsed,
      days_total: daysTotal,
    };
  });
}
