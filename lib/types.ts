// Order from Shopify, stored in Supabase
export interface Order {
  id: number; // Shopify order ID (bigint)
  order_name: string; // Human-readable #12345
  warehouse: string | null; // 'smithey' or 'selery' (from tags)
  fulfillment_status: FulfillmentStatus | null; // null = unfulfilled, 'partial', 'fulfilled'
  canceled: boolean;
  created_at: string; // ISO timestamp - when order was placed
  fulfilled_at: string | null; // ISO timestamp - when fully fulfilled
  updated_at: string;
}

export type FulfillmentStatus = "partial" | "fulfilled";

// Line item within an order
export interface LineItem {
  id: number; // Shopify line item ID
  order_id: number; // FK to orders.id
  sku: string | null;
  title: string | null;
  quantity: number;
  fulfilled_quantity: number;
  created_at: string;
}

// Dashboard metrics by warehouse
export interface WarehouseMetrics {
  warehouse: string;
  unfulfilled_count: number;
  partial_count: number;
  fulfilled_today: number;
  // Enhanced metrics
  fulfilled_7d: number;
  fulfilled_30d: number;
  avg_per_day_7d: number;
  avg_per_day_30d: number;
  fulfilled_this_week: number;
  fulfilled_last_week: number;
  week_over_week_change: number; // percentage
}

// Daily fulfillment data for charts
export interface DailyFulfillment {
  date: string; // YYYY-MM-DD
  warehouse: string;
  count: number;
}

// Queue health - aging analysis
export interface QueueHealth {
  warehouse: string;
  waiting_1_day: number;
  waiting_3_days: number;
  waiting_7_days: number;
  oldest_order_days: number;
  oldest_order_name: string | null;
}

// SKU breakdown in unfulfilled queue
export interface SkuInQueue {
  sku: string;
  title: string | null;
  warehouse: string;
  quantity: number; // total units waiting
  order_count: number; // number of orders containing this SKU
}

// Weekly totals for trend chart
export interface WeeklyFulfillment {
  week_start: string; // YYYY-MM-DD (Monday)
  warehouse: string;
  count: number;
}

// Shopify webhook payload types
export interface ShopifyOrder {
  id: number;
  name: string; // #1234
  tags: string; // comma-separated
  created_at: string;
  cancelled_at: string | null;
  fulfillment_status: string | null; // null, 'partial', 'fulfilled'
  fulfillments: ShopifyFulfillment[];
  line_items: ShopifyLineItem[];
}

export interface ShopifyFulfillment {
  id: number;
  created_at: string;
  status: string;
  line_items: ShopifyFulfillmentLineItem[];
}

export interface ShopifyFulfillmentLineItem {
  id: number;
  quantity: number;
}

export interface ShopifyLineItem {
  id: number;
  sku: string | null;
  title: string;
  quantity: number;
  fulfillable_quantity: number;
}

// API response types
export interface MetricsResponse {
  warehouses: WarehouseMetrics[];
  daily: DailyFulfillment[];
  weekly: WeeklyFulfillment[];
  queueHealth: QueueHealth[];
  topSkusInQueue: SkuInQueue[];
  lastUpdated: string;
}
