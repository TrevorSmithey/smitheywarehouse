/**
 * Centralized date/time utilities for Smithey Warehouse Dashboard
 *
 * All functions use EST (America/New_York) timezone to match Smithey operations.
 * This ensures consistency regardless of server location (Vercel uses UTC).
 *
 * @module date-utils
 */

import { toZonedTime, formatInTimeZone } from "date-fns-tz";

const SMITHEY_TIMEZONE = "America/New_York";

// ============================================================================
// CORE DATE FUNCTIONS (EST-aware)
// ============================================================================

/**
 * Get current date/time in EST timezone
 */
export function getNowEST(): Date {
  return toZonedTime(new Date(), SMITHEY_TIMEZONE);
}

/**
 * Get today's date as YYYY-MM-DD string in EST timezone
 */
export function getTodayEST(): string {
  return formatInTimeZone(new Date(), SMITHEY_TIMEZONE, "yyyy-MM-dd");
}

/**
 * Get current year in EST timezone
 */
export function getCurrentYearEST(): number {
  return getNowEST().getFullYear();
}

/**
 * Get current day of year (1-365/366) in EST timezone
 */
export function getCurrentDayOfYearEST(): number {
  const now = getNowEST();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

/**
 * Get last completed day of year in EST timezone
 * Returns 0 on January 1st (no completed days yet)
 */
export function getLastCompletedDayOfYearEST(): number {
  const today = getCurrentDayOfYearEST();
  return Math.max(0, today - 1);
}

/**
 * Get current quarter (1-4) in EST timezone
 */
export function getCurrentQuarterEST(): number {
  const month = getNowEST().getMonth();
  if (month <= 2) return 1;
  if (month <= 5) return 2;
  if (month <= 8) return 3;
  return 4;
}

// ============================================================================
// YEAR & LEAP YEAR UTILITIES
// ============================================================================

/**
 * Check if a year is a leap year
 */
export function isLeapYearNumber(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Get total days in a year (365 or 366)
 */
export function getDaysInYear(year: number): number {
  return isLeapYearNumber(year) ? 366 : 365;
}

// ============================================================================
// CALENDAR DATE ALIGNMENT (Critical for YoY comparisons)
// ============================================================================

/**
 * Get the corresponding date in another year for YoY comparison.
 * Handles leap year edge cases properly:
 * - Feb 29 in leap year maps to Feb 28 in non-leap year
 * - All other dates align by calendar date, not day-of-year
 *
 * @param dateStr - Source date as YYYY-MM-DD
 * @param targetYear - The year to map to
 * @returns Target date as YYYY-MM-DD
 */
export function getCorrespondingDate(dateStr: string, targetYear: number): string {
  const [, monthStr, dayStr] = dateStr.split("-");
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  // Handle Feb 29 → Feb 28 for non-leap target year
  if (month === 2 && day === 29 && !isLeapYearNumber(targetYear)) {
    return `${targetYear}-02-28`;
  }

  // Otherwise, same month/day
  return `${targetYear}-${monthStr}-${dayStr}`;
}

/**
 * Get day-of-year from a date string (YYYY-MM-DD)
 */
export function getDayOfYearFromDate(dateStr: string): number {
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  const daysInMonth = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (isLeapYearNumber(year)) {
    daysInMonth[2] = 29;
  }

  let dayOfYear = day;
  for (let m = 1; m < month; m++) {
    dayOfYear += daysInMonth[m];
  }

  return dayOfYear;
}

// ============================================================================
// QUARTER UTILITIES (Dynamic, handles leap years)
// ============================================================================

/**
 * Get quarter boundaries for a specific year (handles leap years)
 */
export function getQuarterBoundaries(year: number): Array<{
  q: number;
  start: number;
  end: number;
  label: string;
  months: string;
}> {
  const isLeap = isLeapYearNumber(year);

  // Q1: Jan 1 - Mar 31 (90 days in non-leap, 91 in leap due to Feb 29)
  // Q2: Apr 1 - Jun 30 (91 days)
  // Q3: Jul 1 - Sep 30 (92 days)
  // Q4: Oct 1 - Dec 31 (92 days)

  const q1End = isLeap ? 91 : 90;
  const q2End = q1End + 91;
  const q3End = q2End + 92;
  const q4End = isLeap ? 366 : 365;

  return [
    { q: 1, start: 1, end: q1End, label: "Q1", months: "Jan-Mar" },
    { q: 2, start: q1End + 1, end: q2End, label: "Q2", months: "Apr-Jun" },
    { q: 3, start: q2End + 1, end: q3End, label: "Q3", months: "Jul-Sep" },
    { q: 4, start: q3End + 1, end: q4End, label: "Q4", months: "Oct-Dec" },
  ];
}

/**
 * Get quarter number (1-4) from a date string (YYYY-MM-DD)
 */
export function getQuarterFromDate(dateStr: string): number {
  const [, monthStr] = dateStr.split("-");
  const month = parseInt(monthStr, 10);

  if (month <= 3) return 1;
  if (month <= 6) return 2;
  if (month <= 9) return 3;
  return 4;
}

// ============================================================================
// TTM (TRAILING TWELVE MONTHS) UTILITIES
// ============================================================================

const MONTH_NAMES_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Get TTM (Trailing Twelve Months) boundaries
 *
 * Returns the last 12 COMPLETE months (excluding current partial month)
 * and the corresponding prior 12-month period for YoY comparison.
 *
 * Example: If today is Jan 5, 2026
 * - TTM = Jan 2025 through Dec 2025 (12 complete months)
 * - Prior TTM = Jan 2024 through Dec 2024
 *
 * @returns Object with current/prior date ranges and month labels for charts
 */
export function getTTMBoundaries(): {
  current: { start: string; end: string };
  prior: { start: string; end: string };
  monthLabels: { yearMonth: string; shortLabel: string }[];
  displayLabel: string;
  priorDisplayLabel: string;
} {
  const now = getNowEST();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-indexed

  // End month = last complete month
  let endYear = currentYear;
  let endMonth = currentMonth - 1;
  if (endMonth === 0) {
    // January: last complete month is December of prior year
    endMonth = 12;
    endYear = currentYear - 1;
  }

  // Start month = 12 months before end month (inclusive)
  // End month minus 11 months = start month
  let startYear = endYear;
  let startMonth = endMonth - 11;
  if (startMonth <= 0) {
    startMonth += 12;
    startYear -= 1;
  }

  // Format as YYYY-MM
  const formatYearMonth = (y: number, m: number) =>
    `${y}-${String(m).padStart(2, "0")}`;

  // Build month labels array for chart X-axis
  const monthLabels: { yearMonth: string; shortLabel: string }[] = [];
  let y = startYear;
  let m = startMonth;
  for (let i = 0; i < 12; i++) {
    monthLabels.push({
      yearMonth: formatYearMonth(y, m),
      shortLabel: `${MONTH_NAMES_SHORT[m - 1]} ${String(y).slice(2)}`,
    });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }

  // Build display labels (e.g., "Jan 2025 - Dec 2025")
  const displayLabel = `${MONTH_NAMES_SHORT[startMonth - 1]} ${startYear} - ${MONTH_NAMES_SHORT[endMonth - 1]} ${endYear}`;
  const priorDisplayLabel = `${MONTH_NAMES_SHORT[startMonth - 1]} ${startYear - 1} - ${MONTH_NAMES_SHORT[endMonth - 1]} ${endYear - 1}`;

  return {
    current: {
      start: formatYearMonth(startYear, startMonth),
      end: formatYearMonth(endYear, endMonth),
    },
    prior: {
      start: formatYearMonth(startYear - 1, startMonth),
      end: formatYearMonth(endYear - 1, endMonth),
    },
    monthLabels,
    displayLabel,
    priorDisplayLabel,
  };
}

/**
 * Get "Last N Months" boundaries for rolling metrics
 *
 * @param months Number of complete months to include (default: 3)
 * @returns Object with date range and labels
 */
export function getLastNMonthsBoundaries(months: number = 3): {
  current: { start: string; end: string };
  prior: { start: string; end: string };
  displayLabel: string;
} {
  const now = getNowEST();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // End month = last complete month
  let endYear = currentYear;
  let endMonth = currentMonth - 1;
  if (endMonth === 0) {
    endMonth = 12;
    endYear = currentYear - 1;
  }

  // Start month = N months before end month (inclusive)
  let startYear = endYear;
  let startMonth = endMonth - (months - 1);
  if (startMonth <= 0) {
    startMonth += 12;
    startYear -= 1;
  }

  const formatYearMonth = (y: number, m: number) =>
    `${y}-${String(m).padStart(2, "0")}`;

  const displayLabel = months === 1
    ? `${MONTH_NAMES_SHORT[endMonth - 1]} ${endYear}`
    : `${MONTH_NAMES_SHORT[startMonth - 1]} - ${MONTH_NAMES_SHORT[endMonth - 1]} ${endYear}`;

  return {
    current: {
      start: formatYearMonth(startYear, startMonth),
      end: formatYearMonth(endYear, endMonth),
    },
    prior: {
      start: formatYearMonth(startYear - 1, startMonth),
      end: formatYearMonth(endYear - 1, endMonth),
    },
    displayLabel,
  };
}

// ============================================================================
// DATE FORMATTING
// ============================================================================

/**
 * Format date as YYYY-MM-DD
 */
export function formatDateISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Get date string for a specific day of year
 */
export function getDateFromDayOfYear(year: number, dayOfYear: number): string {
  const date = new Date(year, 0, dayOfYear);
  return formatDateISO(date);
}

/**
 * Convert day-of-year to approximate month abbreviation
 * (for chart labels, not critical date logic)
 */
export function dayToMonthLabel(day: number): string {
  const months = [
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
  const monthIndex = Math.min(11, Math.floor((day - 1) / 30.44));
  return months[monthIndex];
}
