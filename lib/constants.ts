/**
 * Query Limits Constants
 *
 * Centralized limits for all database queries.
 * These should be set high enough to never truncate real data.
 * If a limit is reached, a warning is logged.
 */

// Metrics API limits
export const QUERY_LIMITS = {
  // Restoration items - 20k should cover all restoration SKUs
  RESTORATION_ITEMS: 20000,

  // Daily fulfillments - 50k covers ~33 days at 1500/day peak
  DAILY_FULFILLMENTS: 50000,

  // Oldest orders per warehouse - fetch extra to allow for filtering
  OLDEST_ORDERS_SMITHEY: 100,
  OLDEST_ORDERS_SELERY: 100,

  // SKU queue - 100k line items
  SKU_QUEUE: 100000,

  // Stuck shipments - 100 is reasonable for display
  STUCK_SHIPMENTS: 100,

  // Transit data - 10k shipments over 30 days
  TRANSIT_DATA: 10000,

  // Lead time data - 50k orders
  LEAD_TIME: 50000,

  // Engraving queue - 50k line items
  ENGRAVING_QUEUE: 50000,

  // Aging data - 10k unfulfilled orders
  AGING_DATA: 10000,

  // Budget API
  BUDGETS: 1000000,
  RETAIL_ORDERS_PAGE: 1000,
  B2B_ORDERS: 100000,

  // Support Tickets API
  SUPPORT_TICKETS: 50000,
} as const;

/**
 * Check if query result was truncated and log warning
 * Returns true if data was likely truncated
 */
export function checkQueryLimit(
  resultCount: number,
  limit: number,
  queryName: string
): boolean {
  if (resultCount >= limit) {
    console.warn(
      `[QUERY LIMIT WARNING] ${queryName}: Returned ${resultCount} rows (limit: ${limit}). ` +
      `Data may be truncated! Consider increasing limit or implementing pagination.`
    );
    return true;
  }
  return false;
}

/**
 * Safe array access with fallback
 * Returns undefined if array is empty or index out of bounds
 */
export function safeArrayAccess<T>(arr: T[] | null | undefined, index: number): T | undefined {
  if (!arr || arr.length === 0 || index < 0 || index >= arr.length) {
    return undefined;
  }
  return arr[index];
}
