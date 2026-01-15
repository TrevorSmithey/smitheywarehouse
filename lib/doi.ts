/**
 * Days of Inventory (DOI) Calculator
 *
 * Uses WEEKLY WEIGHTS to model seasonal demand patterns.
 * Projects stockout date by consuming inventory against weekly demand.
 *
 * Algorithm:
 * 1. annual_budget = sum of 12 monthly 'total' channel budgets for SKU
 * 2. weekly_demand = annual_budget × weekly_weight[week]
 * 3. daily_demand = weekly_demand / 7
 * 4. Consume inventory forward from current week until depleted
 *
 * ARCHITECTURE:
 * - Weekly weights come from database (weekly_weights table)
 * - Annual budget computed from budgets table (channel='total')
 * - Weights represent 3-year historical average of demand distribution
 */

// Type for weekly weights lookup (week 1-52 -> decimal weight)
export type WeeklyWeightsLookup = Map<number, number>;

// Type for annual budget lookup (SKU -> year -> total annual budget)
export type AnnualBudgetLookup = Map<string, Map<number, number>>;

export interface DOIResult {
  doi: number;              // Days to stockout
  stockoutWeek: number;     // Week number when stockout occurs
  stockoutYear: number;     // Year when stockout occurs
}

/**
 * Build weekly weights lookup from database rows
 * @param rows - Array of { week, weight } from weekly_weights table
 */
export function buildWeeklyWeightsLookup(
  rows: Array<{ week: number; weight: number }>
): WeeklyWeightsLookup {
  const lookup = new Map<number, number>();
  for (const row of rows) {
    lookup.set(row.week, row.weight);
  }
  return lookup;
}

/**
 * Build annual budget lookup from database rows
 * Sums all 12 monthly budgets per SKU/year for channel='total'
 *
 * @param rows - Array of { sku, year, month, budget } from budgets table (channel='total')
 */
export function buildAnnualBudgetLookup(
  rows: Array<{ sku: string; year: number; month: number; budget: number }>
): AnnualBudgetLookup {
  const lookup: AnnualBudgetLookup = new Map();

  for (const row of rows) {
    const skuLower = row.sku.toLowerCase();
    if (!lookup.has(skuLower)) {
      lookup.set(skuLower, new Map());
    }
    const yearMap = lookup.get(skuLower)!;
    const currentTotal = yearMap.get(row.year) || 0;
    yearMap.set(row.year, currentTotal + row.budget);
  }

  return lookup;
}

/**
 * Get annual budget for a SKU/year from lookup
 */
function getAnnualBudget(
  lookup: AnnualBudgetLookup,
  sku: string,
  year: number
): number | undefined {
  const yearMap = lookup.get(sku.toLowerCase());
  if (!yearMap) return undefined;
  return yearMap.get(year);
}

/**
 * Get current date components in EST timezone
 */
function getESTDateComponents(): { year: number; month: number; dayOfMonth: number; dayOfWeek: number; week: number } {
  const now = new Date();

  // Get date components in EST
  const estFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",  // Added to get actual day of week
  });
  const estParts = estFormatter.formatToParts(now);
  const year = parseInt(estParts.find(p => p.type === "year")?.value || "2025");
  const month = parseInt(estParts.find(p => p.type === "month")?.value || "1");
  const dayOfMonth = parseInt(estParts.find(p => p.type === "day")?.value || "1");

  // Get actual day of week (1=Sunday, 7=Saturday) from weekday name
  const weekdayName = estParts.find(p => p.type === "weekday")?.value || "Sun";
  const weekdayMap: Record<string, number> = {
    "Sun": 1, "Mon": 2, "Tue": 3, "Wed": 4, "Thu": 5, "Fri": 6, "Sat": 7
  };
  const dayOfWeek = weekdayMap[weekdayName] || 1;

  // Calculate week number
  const estDate = new Date(year, month - 1, dayOfMonth);
  const startOfYear = new Date(year, 0, 1);
  const days = Math.floor((estDate.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
  const week = Math.min(52, Math.max(1, Math.ceil((days + startOfYear.getDay() + 1) / 7)));

  return { year, month, dayOfMonth, dayOfWeek, week };
}

/**
 * Calculate Days of Inventory using WEEKLY WEIGHTS
 *
 * Algorithm:
 * 1. Get annual budget for SKU (sum of 12 monthly 'total' budgets)
 * 2. Start from current week (EST timezone)
 * 3. For each week: weekly_demand = annual_budget × weight
 * 4. Calculate days remaining in current week, consume inventory
 * 5. Continue through subsequent weeks until inventory depleted
 * 6. Return total days and stockout info
 *
 * @param sku - Product SKU
 * @param currentInventory - Total inventory on hand
 * @param weeklyWeights - Weekly weights from database (use buildWeeklyWeightsLookup)
 * @param annualBudgetLookup - Annual budget lookup from database (use buildAnnualBudgetLookup)
 * @returns DOI result or undefined if no data available
 */
export function calculateDOI(
  sku: string,
  currentInventory: number,
  weeklyWeights?: WeeklyWeightsLookup,
  annualBudgetLookup?: AnnualBudgetLookup
): DOIResult | undefined {
  if (!weeklyWeights || weeklyWeights.size === 0) return undefined;
  if (!annualBudgetLookup) return undefined;

  const { year: currentYear, dayOfWeek, week: currentWeek } = getESTDateComponents();

  // Try current year first, then next year if no budget
  let annualBudget = getAnnualBudget(annualBudgetLookup, sku, currentYear);
  let budgetYear = currentYear;

  if (!annualBudget || annualBudget === 0) {
    // Try next year's budget
    annualBudget = getAnnualBudget(annualBudgetLookup, sku, currentYear + 1);
    budgetYear = currentYear + 1;
  }

  if (!annualBudget || annualBudget === 0) {
    return undefined;
  }

  let remainingInventory = currentInventory;
  let totalDays = 0;
  const maxDays = 730; // 2 years max projection

  // Start at current week
  let week = currentWeek;
  let year = currentYear;

  // Calculate what day of the week we're on (1-7, where 1 = Sunday)
  // For first week, calculate remaining days
  const daysRemainingInFirstWeek = 7 - ((dayOfWeek - 1) % 7);
  let isFirstWeek = true;

  while (remainingInventory > 0 && totalDays < maxDays) {
    // Get weight for this week (use budget year's weight pattern)
    const weight = weeklyWeights.get(week);

    if (!weight || weight === 0) {
      // No weight for this week - advance to next week with minimal consumption
      const daysInWeek = isFirstWeek ? daysRemainingInFirstWeek : 7;
      totalDays += daysInWeek;
      isFirstWeek = false;

      week++;
      if (week > 52) {
        week = 1;
        year++;
        // Get next year's annual budget if available
        const nextYearBudget = getAnnualBudget(annualBudgetLookup, sku, year);
        if (nextYearBudget && nextYearBudget > 0) {
          annualBudget = nextYearBudget;
        }
      }
      continue;
    }

    // Calculate demand for this week
    const weeklyDemand = annualBudget * weight;
    const dailyDemand = weeklyDemand / 7;

    // For first week, only count remaining days
    const daysInThisSegment = isFirstWeek ? daysRemainingInFirstWeek : 7;
    const demandInSegment = dailyDemand * daysInThisSegment;

    if (remainingInventory <= demandInSegment) {
      // Stock out happens this week
      const daysUntilStockout = dailyDemand > 0 ? remainingInventory / dailyDemand : daysInThisSegment;
      totalDays += daysUntilStockout;

      return {
        doi: Math.round(totalDays),
        stockoutWeek: week,
        stockoutYear: year,
      };
    }

    // Consume this week's demand and continue
    remainingInventory -= demandInSegment;
    totalDays += daysInThisSegment;
    isFirstWeek = false;

    // Move to next week
    week++;
    if (week > 52) {
      week = 1;
      year++;
      // Get next year's annual budget if available
      const nextYearBudget = getAnnualBudget(annualBudgetLookup, sku, year);
      if (nextYearBudget && nextYearBudget > 0) {
        annualBudget = nextYearBudget;
      }
    }
  }

  // Inventory lasts beyond projection window (2+ years) - return max
  if (totalDays >= maxDays) {
    return {
      doi: maxDays,
      stockoutWeek: week,
      stockoutYear: year,
    };
  }

  return undefined;
}

/**
 * Get current ISO week number (1-52) in EST timezone
 */
export function getCurrentWeek(): number {
  const { week } = getESTDateComponents();
  return week;
}

/**
 * Calculate remaining annual demand from current week to end of year
 * Uses weekly weights to model seasonal demand
 */
export function getRemainingAnnualDemand(
  annualForecast: number,
  fromWeek: number,
  weeklyWeights: WeeklyWeightsLookup
): number {
  let totalWeight = 0;
  for (let w = fromWeek; w <= 52; w++) {
    totalWeight += weeklyWeights.get(w) || 0;
  }
  return annualForecast * totalWeight;
}

/**
 * Get weekly demand for a specific week
 */
export function getWeeklyDemand(
  annualForecast: number,
  week: number,
  weeklyWeights: WeeklyWeightsLookup
): number {
  const weight = weeklyWeights.get(week) || 0;
  return annualForecast * weight;
}
