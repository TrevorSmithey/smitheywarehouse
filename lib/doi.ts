/**
 * Days of Inventory (DOI) Calculator
 *
 * Uses monthly budgets from database for demand forecasting.
 * Projects stockout date by consuming inventory against monthly demand.
 *
 * CLEAN ARCHITECTURE:
 * - Weekly weights are statistical data (rarely changes) - kept here
 * - Forecasts and budgets come from database - passed as parameters
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

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export interface DOIResult {
  doi: number;              // Days to stockout
  stockoutWeek: number;     // Week number when stockout occurs
  stockoutYear: number;     // Year when stockout occurs
}

// Budget data by SKU -> year -> month (1-indexed) -> budget
export type BudgetLookup = Map<string, Map<number, Map<number, number>>>;

/**
 * Build budget lookup from database rows
 * @param rows - Array of { sku, year, month, budget } from budgets table
 */
export function buildBudgetLookup(rows: Array<{ sku: string; year: number; month: number; budget: number }>): BudgetLookup {
  const lookup: BudgetLookup = new Map();

  for (const row of rows) {
    const skuLower = row.sku.toLowerCase();
    if (!lookup.has(skuLower)) {
      lookup.set(skuLower, new Map());
    }
    const skuMap = lookup.get(skuLower)!;
    if (!skuMap.has(row.year)) {
      skuMap.set(row.year, new Map());
    }
    skuMap.get(row.year)!.set(row.month, row.budget);
  }

  return lookup;
}

/**
 * Get budget for a SKU/year/month from lookup
 */
function getBudget(lookup: BudgetLookup, sku: string, year: number, month: number): number | undefined {
  const skuMap = lookup.get(sku.toLowerCase());
  if (!skuMap) return undefined;
  const yearMap = skuMap.get(year);
  if (!yearMap) return undefined;
  return yearMap.get(month);
}

/**
 * Calculate Days of Inventory using monthly budgets from database
 *
 * Algorithm:
 * 1. Start from today (EST timezone)
 * 2. For remaining days in current month, use daily rate from monthly budget
 * 3. Continue through subsequent months until inventory depleted
 * 4. Return total days and stockout date
 *
 * @param sku - Product SKU
 * @param currentInventory - Total inventory on hand
 * @param budgetLookup - Budget data from database (use buildBudgetLookup)
 * @returns DOI result or undefined if no budget available
 */
export function calculateDOI(
  sku: string,
  currentInventory: number,
  budgetLookup?: BudgetLookup
): DOIResult | undefined {
  if (!budgetLookup) return undefined;

  // Use EST timezone for accurate day/month calculations
  const now = new Date();
  const estFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const estParts = estFormatter.formatToParts(now);
  let year = parseInt(estParts.find(p => p.type === "year")?.value || "2025");
  let month = parseInt(estParts.find(p => p.type === "month")?.value || "1"); // 1-indexed for DB
  let dayOfMonth = parseInt(estParts.find(p => p.type === "day")?.value || "1");

  let remainingInventory = currentInventory;
  let totalDays = 0;
  const maxDays = 730; // 2 years max projection
  let foundAnyBudget = false;

  while (remainingInventory > 0 && totalDays < maxDays) {
    const month0 = month - 1; // 0-indexed for DAYS_IN_MONTH
    const daysInThisMonth = DAYS_IN_MONTH[month0];
    const daysRemainingInMonth = daysInThisMonth - dayOfMonth + 1;

    // Get monthly budget from lookup
    const monthBudget = getBudget(budgetLookup, sku, year, month);

    if (monthBudget === undefined || monthBudget === 0) {
      // No budget for this month - skip to next
      totalDays += daysRemainingInMonth;
      month++;
      if (month > 12) {
        month = 1;
        year++;
      }
      dayOfMonth = 1;
      continue;
    }

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
      const stockoutDate = new Date(year, month0, dayOfMonth + Math.floor(daysUntilStockout));
      const stockoutWeek = getWeekNumber(stockoutDate);

      return {
        doi: Math.round(totalDays),
        stockoutWeek: stockoutWeek,
        stockoutYear: stockoutDate.getFullYear(),
      };
    }

    // Consume this month's remaining demand and continue
    remainingInventory -= demandRemainingInMonth;
    totalDays += daysRemainingInMonth;

    // Move to next month
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
    dayOfMonth = 1;
  }

  // If no budget data was found, return undefined (show N/A)
  if (!foundAnyBudget) {
    return undefined;
  }

  // Inventory lasts beyond projection window (2+ years)
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
 * Get current ISO week number (1-52) in EST timezone
 */
export function getCurrentWeek(): number {
  const now = new Date();
  const estFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const estParts = estFormatter.formatToParts(now);
  const year = parseInt(estParts.find(p => p.type === "year")?.value || "2025");
  const month = parseInt(estParts.find(p => p.type === "month")?.value || "1") - 1;
  const day = parseInt(estParts.find(p => p.type === "day")?.value || "1");

  const estDate = new Date(year, month, day);
  const startOfYear = new Date(year, 0, 1);
  const days = Math.floor((estDate.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
  return Math.ceil((days + startOfYear.getDay() + 1) / 7);
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
