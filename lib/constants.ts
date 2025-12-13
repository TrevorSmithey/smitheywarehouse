/**
 * Centralized Constants
 *
 * All magic numbers and configuration values should be defined here.
 * This provides a single source of truth and makes changes easier.
 */

/**
 * ShipHero Warehouse IDs
 * These are the numeric IDs used in the inventory and fulfillment tables.
 * The GraphQL API uses base64-encoded versions (see WAREHOUSE_GRAPHQL_IDS).
 */
export const WAREHOUSE_IDS = {
  pipefitter: 120758,
  hobson: 77373,
  selery: 93742,
} as const;

/**
 * ShipHero Warehouse GraphQL IDs
 * Base64-encoded versions used in GraphQL queries.
 * Decoded: V2FyZWhvdXNlOjEyMDc1OA== = "Warehouse:120758"
 */
export const WAREHOUSE_GRAPHQL_IDS = {
  pipefitter: "V2FyZWhvdXNlOjEyMDc1OA==",
  hobson: "V2FyZWhvdXNlOjc3Mzcz",
  selery: "V2FyZWhvdXNlOjkzNzQy",
} as const;

/**
 * Sync Window Configuration
 * Default time windows for syncing historical data.
 */
export const SYNC_WINDOWS = {
  /** Default sync window in days for B2B and metrics queries */
  DEFAULT_DAYS: 7,
  /** Milliseconds in one day */
  MS_PER_DAY: 24 * 60 * 60 * 1000,
} as const;

/**
 * Vercel Edge Function Timeouts
 * NOTE: These cannot be used for Next.js segment config exports (maxDuration)
 * because Next.js requires those to be static literals for build-time analysis.
 * Use literal values (300, 60) directly in route files instead.
 * These constants are kept for reference and for non-segment-config usage.
 */
export const VERCEL_TIMEOUTS = {
  /** Standard cron job timeout (5 minutes) */
  STANDARD: 300,
  /** Short timeout for simple operations (1 minute) */
  SHORT: 60,
} as const;

/**
 * Batch Processing Sizes
 * Chunk sizes for bulk database operations.
 */
export const BATCH_SIZES = {
  /** Default upsert batch size */
  DEFAULT: 500,
  /** Shopify API page size (max 250) */
  SHOPIFY_PAGE: 250,
} as const;

/**
 * API Rate Limiting Delays
 * Milliseconds to wait between API calls to avoid rate limits.
 */
export const RATE_LIMIT_DELAYS = {
  /** Shopify API delay between requests */
  SHOPIFY: 500,
  /** ShipHero GraphQL delay between requests */
  SHIPHERO: 100,
} as const;

/**
 * Query Limits Constants
 *
 * Centralized limits for all database queries.
 * These should be set high enough to never truncate real data.
 * If a limit is reached, a warning is logged.
 */
export const QUERY_LIMITS = {
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

  // Engraving queue - unfulfilled only, should be ~2k max
  ENGRAVING_QUEUE: 10000,

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
