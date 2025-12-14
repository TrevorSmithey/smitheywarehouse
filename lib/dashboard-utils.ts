/**
 * Shared utility functions for dashboard components
 */

export type DateRangeOption = "today" | "yesterday" | "3days" | "7days" | "30days" | "90days" | "custom";

/**
 * Calculate date range bounds based on selection
 */
export function getDateBounds(option: DateRangeOption, customStart?: Date, customEnd?: Date): { start: Date; end: Date } {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  switch (option) {
    case "today": {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case "yesterday": {
      const start = new Date(now);
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      const yesterdayEnd = new Date(start);
      yesterdayEnd.setHours(23, 59, 59, 999);
      return { start, end: yesterdayEnd };
    }
    case "3days": {
      const start = new Date(now);
      start.setDate(start.getDate() - 2);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case "7days": {
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case "30days": {
      const start = new Date(now);
      start.setDate(start.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case "90days": {
      const start = new Date(now);
      start.setDate(start.getDate() - 89);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case "custom": {
      if (customStart && customEnd) {
        const start = new Date(customStart);
        start.setHours(0, 0, 0, 0);
        const endDate = new Date(customEnd);
        endDate.setHours(23, 59, 59, 999);
        return { start, end: endDate };
      }
      // Default to 7 days if no custom dates
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
  }
}

/**
 * Format a number with locale-aware commas
 */
export function formatNumber(num: number | undefined | null): string {
  if (num === undefined || num === null || isNaN(num)) return "0";
  return num.toLocaleString("en-US");
}

/**
 * Format a number with compact notation (K, M abbreviations)
 * Useful for large numbers in constrained UI spaces
 */
export function formatNumberCompact(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return n.toLocaleString("en-US");
}

/**
 * Parse date string (YYYY-MM-DD) as local date, not UTC
 * This fixes timezone issues where "2025-12-05" parsed as UTC shows as 12/4 in EST
 */
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Calculate percentage change between two values
 */
export function getChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

/**
 * Get number of days in the selected date range
 */
export function getDaysInRange(option: DateRangeOption): number {
  switch (option) {
    case "today": return 1;
    case "yesterday": return 1;
    case "3days": return 3;
    case "7days": return 7;
    case "30days": return 30;
    case "90days": return 90;
    case "custom": return 7; // Fallback for custom
    default: return 7;
  }
}

/**
 * Get comparison label based on date range
 */
export function getComparisonLabel(option: DateRangeOption): string {
  switch (option) {
    case "today": return "vs yesterday";
    case "yesterday": return "vs prev day";
    case "3days": return "vs prev 3d";
    case "7days": return "vs prev 7d";
    case "30days": return "vs prev 30d";
    case "90days": return "vs prev 90d";
    case "custom": return "vs prev period";
    default: return "vs prev period";
  }
}

/**
 * Get short range label for display (e.g., "today", "3d", "7d")
 */
export function getShortRangeLabel(option: DateRangeOption): string {
  switch (option) {
    case "today": return "today";
    case "yesterday": return "yesterday";
    case "3days": return "3d";
    case "7days": return "7d";
    case "30days": return "30d";
    case "90days": return "90d";
    case "custom": return "period";
    default: return "period";
  }
}

/**
 * Format currency value
 */
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Format percentage value
 */
export function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}
