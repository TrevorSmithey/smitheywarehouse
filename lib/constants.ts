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
  /** Shopify GraphQL page size (max 100 for most endpoints) */
  SHOPIFY_GRAPHQL_PAGE: 100,
} as const;

/**
 * Service SKUs
 * SKUs that represent services rather than physical products.
 * These should be excluded from inventory counts and draft order line items.
 */
export const SERVICE_SKUS = ["Gift-Note", "Smith-Eng"] as const;

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
 *
 * IMPORTANT: These limits were increased for peak season (Nov-Dec 2026).
 * At 2000+ orders/day during Q4, previous 50k limits would truncate data.
 * Silent data truncation is a critical integrity failure.
 */
export const QUERY_LIMITS = {
  // Daily fulfillments - 150k covers ~75 days at 2000/day peak season
  // Previous 50k limit would truncate during Q4 (was hitting ~100k/50days)
  DAILY_FULFILLMENTS: 150000,

  // Oldest orders per warehouse - fetch extra to allow for filtering
  OLDEST_ORDERS_SMITHEY: 100,
  OLDEST_ORDERS_SELERY: 100,

  // SKU queue - 100k line items
  SKU_QUEUE: 100000,

  // Stuck shipments - 100 is reasonable for display
  STUCK_SHIPMENTS: 100,

  // Transit data - 30k shipments over 30 days (peak: 1000/day delivered)
  TRANSIT_DATA: 30000,

  // Lead time data - 150k orders (peak season: 2000/day for 75 days)
  // Previous 50k limit would truncate during Q4
  LEAD_TIME: 150000,

  // Engraving queue - unfulfilled only, should be ~2k max
  ENGRAVING_QUEUE: 10000,

  // Aging data - 30k unfulfilled orders (peak backlog)
  AGING_DATA: 30000,

  // Budget API
  BUDGETS: 1000000,
  RETAIL_ORDERS_PAGE: 1000,
  B2B_ORDERS: 100000,

  // Support Tickets API
  SUPPORT_TICKETS: 50000,

  // Inventory API - line items and B2B fulfilled
  INVENTORY_RETAIL_SALES: 500000,
  INVENTORY_B2B_SALES: 100000,
  INVENTORY_VELOCITY: 100000,

  // Wholesale API - CRITICAL: Without limits, Supabase defaults to 1000 rows
  // 2025 had 3,298 transactions → would silently truncate 70% of data!
  // Verified via audit query on 2026-01-09
  WHOLESALE_CUSTOMERS: 2000, // ~749 customers with transactions, 3x buffer
  WHOLESALE_TRANSACTIONS_YTD: 10000, // ~3,298 YTD 2025, 3x buffer
  WHOLESALE_TRANSACTIONS_24M: 15000, // 24-month queries need more headroom
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

/**
 * Wholesale Customer Thresholds
 *
 * Business logic thresholds for wholesale customer analysis.
 * These determine visual flags, health status, and sales team actions.
 */
export const WHOLESALE_THRESHOLDS = {
  /**
   * New customer nurturing threshold ($4,000 YTD revenue)
   *
   * New customers (first order this year) with YTD revenue below this
   * threshold are flagged for proactive sales outreach. Rationale:
   * - Customers spending < $4k in their first year often need onboarding support
   * - Historical data shows customers > $4k first-year revenue have higher retention
   * - Visual indicator: pulsing amber highlight (ss-violation class)
   */
  NEW_CUSTOMER_NURTURING: 4000,
} as const;
