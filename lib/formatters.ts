/**
 * Unified formatting utilities for the Smithey Warehouse Dashboard
 *
 * Consolidates duplicate formatting functions across dashboard components
 * to ensure consistent display throughout the application.
 */

/**
 * Format currency as compact (K/M) notation for headers and badges
 * - $1,234,567 → "$1.23M"
 * - $45,678 → "$45.7K"
 * - $789 → "$789"
 */
export function formatCurrency(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(2)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

/**
 * Format currency with full precision and commas for tables and detail views
 * - $1,234,567.89 → "$1,234,568"
 */
export function formatCurrencyFull(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/**
 * Format currency with cents for invoices and line items
 * - $1,234.56 → "$1,234.56"
 */
export function formatCurrencyWithCents(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Format percentage with one decimal place
 * - 0.1234 → "12.3%" (if input is a decimal)
 * - 12.34 → "12.3%" (if input is already a percentage)
 * - null/undefined → "—"
 */
export function formatPct(n: number | null | undefined, isDecimal = false): string {
  if (n === null || n === undefined) return "—";
  const value = isDecimal ? n * 100 : n;
  return `${value.toFixed(1)}%`;
}

/**
 * Format percentage change with +/- prefix
 * - 12.34 → "+12.3%"
 * - -5.67 → "-5.7%"
 * - null/undefined → "—"
 */
export function formatPctChange(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

/**
 * Format a decimal rate as percentage (e.g., for open/click rates)
 * - 0.234 → "23.4%"
 * - null/undefined → "—"
 */
export function formatRate(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

/**
 * Format a decimal rate as whole percentage
 * - 0.234 → "23%"
 * - null/undefined → "—"
 */
export function formatRateWhole(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${(n * 100).toFixed(0)}%`;
}

/**
 * Format number with commas for thousands
 * - 1234567 → "1,234,567"
 */
export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Format number as compact (K/M) notation
 * - 1234567 → "1.23M"
 * - 45678 → "45.7K"
 * - 789 → "789"
 */
export function formatNumberCompact(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toFixed(0);
}

/**
 * Format a date as relative time ("2d ago", "3mo ago")
 */
export function formatRelativeTime(date: Date | string | null): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

/**
 * Format a delta value with + or - prefix and appropriate color class
 * Returns { value: string, className: string }
 */
export function formatDelta(n: number, isGood: "positive" | "negative" = "positive"): {
  value: string;
  isPositive: boolean;
  className: string;
} {
  const isPositive = n > 0;
  const prefix = isPositive ? "+" : "";
  const value = `${prefix}${n.toFixed(1)}%`;

  // Determine if this delta is "good" based on context
  // e.g., +20% revenue is good, but +20% churn is bad
  const isGoodDelta = isGood === "positive" ? isPositive : !isPositive;

  return {
    value,
    isPositive,
    className: isGoodDelta ? "text-status-good" : n < 0 && isGood === "positive" ? "text-status-bad" : "text-neutral-400",
  };
}
