/**
 * Days of Inventory (DOI) Calculator
 *
 * Uses monthly budget data directly for accurate demand forecasting.
 * Projects stockout date by consuming inventory against monthly budgets.
 */

// Weekly weights based on 3-year average of cast iron movement
// Week 1 = first week of January, Week 52 = last week of December
// Sum of all weights = 1.0
export const WEEKLY_WEIGHTS: Record<number, number> = {
  1: 0.018468241890594237,
  2: 0.01377762585010537,
  3: 0.014258067439397597,
  4: 0.014452917928717758,
  5: 0.014367345253142025,
  6: 0.015747369854114623,
  7: 0.013849357446803934,
  8: 0.012811481527560509,
  9: 0.01394024834546793,
  10: 0.013003935686060245,
  11: 0.011248574783109583,
  12: 0.010977015843894431,
  13: 0.010505219197220285,
  14: 0.01092270705635822,
  15: 0.009886969786037562,
  16: 0.009477131566053756,
  17: 0.010361118685839252,
  18: 0.013293108537089562,
  19: 0.01142084107111365,
  20: 0.008726324765797953,
  21: 0.010253730507212918,
  22: 0.011716019744524287,
  23: 0.012370771039581193,
  24: 0.009669382165997147,
  25: 0.007628764149923252,
  26: 0.008307867133236677,
  27: 0.009402728641223197,
  28: 0.008648179231491238,
  29: 0.008004511688562557,
  30: 0.008693668025334831,
  31: 0.008315521958529859,
  32: 0.00966872117557041,
  33: 0.009327113141759047,
  34: 0.00874177941633244,
  35: 0.012784288565524963,
  36: 0.011929247137166296,
  37: 0.01017820287708128,
  38: 0.0099998060705142,
  39: 0.010025808086867698,
  40: 0.010823413458962029,
  41: 0.012261596631931791,
  42: 0.01527329912909709,
  43: 0.01732824028035048,
  44: 0.017826505123611766,
  45: 0.022396095877602044,
  46: 0.028529581221997932,
  47: 0.07269037295709502,  // BFCM week - 7.3%
  48: 0.10152565971619675,  // Peak BFCM week - 10.2%
  49: 0.08830931469499602,
  50: 0.09629734166335885,
  51: 0.05246182381927866,
  52: 0.0271150421546096,
};

// 2025 Annual Forecasts by SKU (derived from Dec-25 budgets)
export const FORECASTS_2025: Record<string, number> = {
  "Smith-AC-Scrub1": 32621,
  "Smith-AC-FGph": 4683,
  "Smith-AC-Sleeve1": 17796,
  "Smith-AC-Sleeve2": 12784,
  "Smith-AC-SpatW1": 11626,
  "Smith-AC-SpatB1": 19177,
  "Smith-AC-PHTLg": 2506,
  "Smith-AC-KeeperW": 2370,
  "Smith-AC-Season": 32900,
  "Smith-AC-Brush": 8324,
  "Smith-Bottle1": 1381,
  "Smith-AC-Glid10": 8819,
  "Smith-AC-Glid12": 17540,
  "Smith-AC-Glid14": 7859,
  "Smith-AC-CSlid12": 0,
  "Smith-CS-Farm12": 5663,
  "Smith-CS-Deep12": 6382,
  "Smith-CS-RRoastM": 1491,
  "Smith-CS-OvalM": 1785,
  "Smith-CS-WokM": 3538,
  "Smith-CS-Round17N": 1058,
  "Smith-CS-Farm9": 5026,
  "Smith-CS-Fish": 2261,
  "Smith-CI-Skil8": 13694,
  "Smith-CI-Chef10": 10570,
  "Smith-CI-Flat10": 3841,
  "Smith-CI-Flat12": 10760,
  "Smith-CI-Skil6": 5505,
  "Smith-CI-Skil10": 19863,
  "Smith-CI-Skil12": 32096,
  "Smith-CI-TradSkil14": 6577,
  "Smith-CI-Skil14": 8196,
  "Smith-CI-DSkil11": 8196,
  "Smith-CI-Grill12": 3643,
  "Smith-CI-Dutch4": 2917,
  "Smith-CI-Dutch5": 5105,
  "Smith-CI-Dutch7": 4200,
  "Smith-CI-Dual6": 2917,
  "Smith-CI-Griddle18": 12057,
  "Smith-CI-Dual12": 4748,
  "Smith-CI-Sauce1": 0,
};

// 2026 Annual Forecasts by SKU
export const FORECASTS_2026: Record<string, number> = {
  "Smith-AC-Scrub1": 43446,
  "Smith-AC-FGph": 6273,
  "Smith-AC-Sleeve1": 23728,
  "Smith-AC-Sleeve2": 17069,
  "Smith-AC-SpatW1": 15448,
  "Smith-AC-SpatB1": 25607,
  "Smith-AC-PHTLg": 3330,
  "Smith-AC-KeeperW": 3142,
  "Smith-AC-Season": 44043,
  "Smith-AC-Brush": 11055,
  "Smith-Bottle1": 1877,
  "Smith-CS-Farm12": 7383,
  "Smith-CS-Deep12": 8411,
  "Smith-CS-RRoastM": 1929,
  "Smith-CS-OvalM": 2269,
  "Smith-CS-WokM": 4581,
  "Smith-CS-Round17N": 1354,
  "Smith-CS-Farm9": 6616,
  "Smith-CS-Fish": 2996,
  "Smith-CI-Skil8": 17996,
  "Smith-CI-Chef10": 13721,
  "Smith-CI-Flat10": 5092,
  "Smith-CI-Flat12": 14059,
  "Smith-CI-Skil6": 7161,
  "Smith-CI-Skil10": 25749,
  "Smith-CI-Skil12": 41841,
  "Smith-CI-TradSkil14": 8689,
  "Smith-CI-Skil14": 10534,
  "Smith-CI-DSkil11": 10534,
  "Smith-CI-Grill12": 4622,
  "Smith-CI-Dutch4": 3805,
  "Smith-CI-Dutch5": 6656,
  "Smith-CI-Dutch7": 5502,
  "Smith-CI-Dual6": 3805,
  "Smith-CI-Griddle18": 15888,
  "Smith-CI-Dual12": 6247,
  "Smith-CI-Sauce1": 974,
  "Smith-AC-CSlid12": 2392,
  "Smith-AC-Glid10": 11604,
  "Smith-AC-Glid12": 23039,
  "Smith-AC-Glid14": 10273,
};

/**
 * Get current ISO week number (1-52)
 */
export function getCurrentWeek(): number {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
  return Math.ceil((days + startOfYear.getDay() + 1) / 7);
}

interface DOIResult {
  doi: number;              // Days to stockout
  stockoutWeek: number;     // Week number when stockout occurs
  stockoutYear: number;     // Year when stockout occurs
  weeklyDemand: number;     // Average weekly demand at stockout
  interpolatedDays: number; // Exact fractional days
}

// Monthly budget data structure (loaded from JSON)
type MonthlyBudgets = Record<string, Record<string, Record<string, number>>>;

// Cache for monthly budgets
let cachedBudgets: MonthlyBudgets | null = null;

/**
 * Load monthly budgets from JSON file
 */
function loadBudgets(): MonthlyBudgets | null {
  if (cachedBudgets) return cachedBudgets;

  try {
    // In Node.js environment, use require
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path');
    const filePath = path.join(process.cwd(), 'data', 'monthly-budgets.json');
    const data = fs.readFileSync(filePath, 'utf-8');
    cachedBudgets = JSON.parse(data);
    return cachedBudgets;
  } catch {
    return null;
  }
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Get monthly budget for a SKU/year/month
 */
function getMonthBudget(budgets: MonthlyBudgets, sku: string, year: number, month: number): number | undefined {
  const yearData = budgets[year.toString()];
  if (!yearData) return undefined;

  // Try direct lookup first
  let skuData = yearData[sku];

  // Case-insensitive fallback
  if (!skuData) {
    const lowerSku = sku.toLowerCase();
    for (const key of Object.keys(yearData)) {
      if (key.toLowerCase() === lowerSku) {
        skuData = yearData[key];
        break;
      }
    }
  }

  if (!skuData) return undefined;

  const monthName = MONTH_NAMES[month];
  return skuData[monthName];
}

/**
 * Calculate Days of Inventory using monthly budgets
 *
 * Algorithm:
 * 1. Start from today
 * 2. For remaining days in current month, use daily rate from monthly budget
 * 3. Continue through subsequent months until inventory depleted
 * 4. Return total days and stockout date
 *
 * @param sku - Product SKU
 * @param currentInventory - Total inventory on hand
 * @returns DOI result or undefined if no budget available
 */
export function calculateDOI(sku: string, currentInventory: number): DOIResult | undefined {
  const budgets = loadBudgets();
  if (!budgets) return undefined;

  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth(); // 0-indexed
  let dayOfMonth = now.getDate();

  let remainingInventory = currentInventory;
  let totalDays = 0;
  const maxDays = 730; // 2 years max projection
  let foundAnyBudget = false; // Track if we found budget data

  while (remainingInventory > 0 && totalDays < maxDays) {
    const daysInThisMonth = DAYS_IN_MONTH[month];
    const daysRemainingInMonth = daysInThisMonth - dayOfMonth + 1;

    // Get monthly budget
    const monthBudget = getMonthBudget(budgets, sku, year, month);

    if (monthBudget === undefined || monthBudget === 0) {
      // No budget for this month - try next year's same month or skip
      if (year === 2025 && month === 11) {
        // End of 2025, move to Jan 2026
        year = 2026;
        month = 0;
        dayOfMonth = 1;
        continue;
      }
      // Skip to next month
      totalDays += daysRemainingInMonth;
      month++;
      if (month > 11) {
        month = 0;
        year++;
      }
      dayOfMonth = 1;
      continue;
    }

    // Found budget data for this SKU
    foundAnyBudget = true;

    // Daily demand rate for this month
    const dailyDemand = monthBudget / daysInThisMonth;

    // Demand for remaining days in this month
    const demandRemainingInMonth = dailyDemand * daysRemainingInMonth;

    if (remainingInventory <= demandRemainingInMonth) {
      // Stock out happens this month
      const daysUntilStockout = remainingInventory / dailyDemand;
      totalDays += daysUntilStockout;

      // Calculate stockout date
      const stockoutDate = new Date(year, month, dayOfMonth + Math.floor(daysUntilStockout));
      const stockoutWeek = getWeekNumber(stockoutDate);

      return {
        doi: Math.round(totalDays),
        stockoutWeek: stockoutWeek,
        stockoutYear: stockoutDate.getFullYear(),
        weeklyDemand: Math.round(dailyDemand * 7),
        interpolatedDays: totalDays,
      };
    }

    // Consume this month's remaining demand and continue
    remainingInventory -= demandRemainingInMonth;
    totalDays += daysRemainingInMonth;

    // Move to next month
    month++;
    if (month > 11) {
      month = 0;
      year++;
    }
    dayOfMonth = 1;
  }

  // If no budget data was found, return undefined (show N/A)
  if (!foundAnyBudget) {
    return undefined;
  }

  // Inventory lasts beyond projection window (2+ years)
  // Return undefined to show N/A instead of misleading 730d
  return undefined;
}

/**
 * Get ISO week number for a date
 */
function getWeekNumber(date: Date): number {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((date.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
  return Math.ceil((days + startOfYear.getDay() + 1) / 7);
}

/**
 * Normalize SKU casing for consistent lookups
 * Handles variations like "Tradskil14" vs "TradSkil14"
 */
function normalizeSkuCase(sku: string): string {
  return sku;
}

/**
 * Get 2025 forecast with case-insensitive matching
 */
function getForecast2025(sku: string): number | undefined {
  // Direct lookup
  if (FORECASTS_2025[sku]) return FORECASTS_2025[sku];

  // Case-insensitive lookup for known variations
  const lowerSku = sku.toLowerCase();
  for (const [key, value] of Object.entries(FORECASTS_2025)) {
    if (key.toLowerCase() === lowerSku) {
      return value;
    }
  }

  return undefined;
}

/**
 * Get 2026 forecast with case-insensitive matching
 */
function getForecast2026(sku: string): number | undefined {
  // Direct lookup
  if (FORECASTS_2026[sku]) return FORECASTS_2026[sku];

  // Case-insensitive lookup for known variations
  const lowerSku = sku.toLowerCase();
  for (const [key, value] of Object.entries(FORECASTS_2026)) {
    if (key.toLowerCase() === lowerSku) {
      return value;
    }
  }

  return undefined;
}

/**
 * Calculate remaining annual demand from current week to end of year
 */
export function getRemainingAnnualDemand(annualForecast: number, fromWeek: number): number {
  let totalWeight = 0;
  for (let w = fromWeek; w <= 52; w++) {
    totalWeight += WEEKLY_WEIGHTS[w] || 0;
  }
  return annualForecast * totalWeight;
}

/**
 * Get weekly demand for a specific week
 */
export function getWeeklyDemand(annualForecast: number, week: number): number {
  const weight = WEEKLY_WEIGHTS[week] || 0;
  return annualForecast * weight;
}

/**
 * Get ISO weeks that fall within a given month/year
 */
function getWeeksInMonth(year: number, month: number): number[] {
  const weeks: number[] = [];
  const seen = new Set<number>();

  // Iterate through each day of the month
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    // Get ISO week
    const jan4 = new Date(d.getFullYear(), 0, 4);
    const dayOfYear = Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / 86400000) + 1;
    const week = Math.ceil((dayOfYear + jan4.getDay() - 1) / 7);

    if (!seen.has(week) && week >= 1 && week <= 52) {
      seen.add(week);
      weeks.push(week);
    }
  }

  return weeks;
}

/**
 * Calculate monthly budget for a SKU based on weekly weights
 * Returns the expected demand for the current month
 */
export function getMonthlyBudget(sku: string): number | undefined {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  // Get forecast for current year
  const forecast = year === 2025
    ? getForecast2025Direct(sku)
    : year === 2026
    ? getForecast2026Direct(sku)
    : undefined;

  if (!forecast) return undefined;

  // Get weeks in current month
  const weeks = getWeeksInMonth(year, month);

  // Sum weights for those weeks
  let totalWeight = 0;
  for (const week of weeks) {
    totalWeight += WEEKLY_WEIGHTS[week] || 0;
  }

  // Return monthly budget
  return Math.round(forecast * totalWeight);
}

// Direct forecast lookups (case-insensitive)
function getForecast2025Direct(sku: string): number | undefined {
  if (FORECASTS_2025[sku]) return FORECASTS_2025[sku];
  const lowerSku = sku.toLowerCase();
  for (const [key, value] of Object.entries(FORECASTS_2025)) {
    if (key.toLowerCase() === lowerSku) return value;
  }
  return undefined;
}

function getForecast2026Direct(sku: string): number | undefined {
  if (FORECASTS_2026[sku]) return FORECASTS_2026[sku];
  const lowerSku = sku.toLowerCase();
  for (const [key, value] of Object.entries(FORECASTS_2026)) {
    if (key.toLowerCase() === lowerSku) return value;
  }
  return undefined;
}
