// Inventory types (ShipHero → Supabase)
export interface ProductInventory {
  sku: string;
  displayName: string;
  category: InventoryCategory;
  pipefitter: number;
  hobson: number;
  selery: number;
  total: number;
  doi?: number; // Days of Inventory using weekly weights methodology
  stockoutWeek?: number; // ISO week number when stockout occurs
  stockoutYear?: number; // Year when stockout occurs
  isBackordered?: boolean; // True if total inventory is negative (more sold than in stock)
  monthSold?: number; // Units fulfilled this month
  monthBudget?: number; // Monthly budget based on forecast + weekly weights
  monthPct?: number; // % of monthly budget sold (monthSold / monthBudget * 100)
}

export type InventoryCategory =
  | "cast_iron"
  | "carbon_steel"
  | "accessory"
  | "glass_lid"
  | "factory_second";

export interface InventoryTotals {
  pipefitter: number;
  hobson: number;
  selery: number;
  total: number;
}

export interface SkuSalesVelocity {
  sku: string;
  displayName: string;
  category: InventoryCategory;
  sales3DayTotal: number;
  sales3DayAvg: number;
  prior3DayAvg: number;
  delta: number; // percentage change vs prior period
}

export interface InventoryResponse {
  inventory: ProductInventory[];
  totals: InventoryTotals;
  byCategory: Record<InventoryCategory, ProductInventory[]>;
  salesVelocity: {
    cast_iron: SkuSalesVelocity[];
    carbon_steel: SkuSalesVelocity[];
    accessory: SkuSalesVelocity[];
    glass_lid: SkuSalesVelocity[];
  };
  lastSynced: string | null;
}

// Supabase table types for inventory
export interface SupabaseProduct {
  id: string;
  sku: string;
  display_name: string;
  category: InventoryCategory;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SupabaseInventory {
  id: string;
  sku: string;
  warehouse_id: number;
  on_hand: number;
  available: number;
  reserved: number;
  synced_at: string;
}

export interface SupabaseWarehouse {
  id: number;
  name: string;
  code: string;
}

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

// Daily backlog data (net change in unfulfilled orders)
export interface DailyBacklog {
  date: string; // YYYY-MM-DD
  created: number; // orders created
  fulfilled: number; // orders fulfilled
  netChange: number; // created - fulfilled (positive = backlog grew)
  runningBacklog: number; // cumulative unfulfilled at end of day
}

// Daily orders created (for warehouse distribution analysis)
export interface DailyOrders {
  date: string; // YYYY-MM-DD
  total: number;
  smithey: number;
  selery: number;
  smithey_pct: number;
  selery_pct: number;
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
  tracking_number?: string;
  tracking_numbers?: string[];
  tracking_company?: string;
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

// Shipment tracking
export interface Shipment {
  id: number;
  order_id: number;
  tracking_number: string;
  carrier: string | null;
  shipped_at: string;
  status: string;
  last_scan_at: string | null;
  last_scan_location: string | null;
  days_without_scan: number;
  easypost_tracker_id: string | null;
  checked_at: string | null;
}

export interface StuckShipment {
  order_id: number;
  order_name: string;
  warehouse: string;
  tracking_number: string;
  carrier: string | null;
  shipped_at: string;
  days_since_shipped: number;
  days_without_scan: number;
  last_scan_location: string | null;
}

// Fulfillment lead time analytics
export interface FulfillmentLeadTime {
  warehouse: string;
  avg_hours: number;
  avg_days: number;
  median_hours: number;
  total_fulfilled: number;
  // SLA buckets - % of orders fulfilled within timeframe
  within_24h: number;
  within_48h: number;
  within_72h: number;
  over_72h: number;
  // Trend: compare last 7 days vs previous 7 days
  trend_pct: number; // positive = slower, negative = faster
}

// Transit time analytics
export interface TransitAnalytics {
  warehouse: string;
  avg_transit_days: number;
  total_delivered: number;
  by_state: StateTransitStats[];
}

export interface StateTransitStats {
  state: string;
  avg_transit_days: number;
  shipment_count: number;
}

// Engraving queue metrics
export interface EngravingQueue {
  total_units: number; // total unfulfilled engraving units
  estimated_days: number; // total_units / 250 (daily capacity)
  order_count: number; // number of orders with engravings
}

// Order aging by bucket for bar chart
export interface OrderAging {
  bucket: string; // "0", "1", "2", "3", "4", "5+"
  smithey: number;
  selery: number;
}

// API response types
export interface MetricsResponse {
  warehouses: WarehouseMetrics[];
  daily: DailyFulfillment[];
  dailyOrders: DailyOrders[];
  dailyBacklog: DailyBacklog[];
  weekly: WeeklyFulfillment[];
  queueHealth: QueueHealth[];
  topSkusInQueue: SkuInQueue[];
  stuckShipments: StuckShipment[];
  fulfillmentLeadTime: FulfillmentLeadTime[];
  transitAnalytics: TransitAnalytics[];
  engravingQueue: EngravingQueue;
  orderAging: OrderAging[];
  lastUpdated: string;
}

// Holiday tracking types (Q4 comparison)
export interface HolidayData {
  day_number: number;
  date_2024: string | null;
  orders_2024: number | null;
  sales_2024: number | null;
  cumulative_orders_2024: number | null;
  cumulative_sales_2024: number | null;
  date_2025: string | null;
  orders_2025: number | null;
  sales_2025: number | null;
  cumulative_orders_2025: number | null;
  cumulative_sales_2025: number | null;
  daily_orders_delta: number | null;
  daily_sales_delta: number | null;
  cumulative_orders_delta: number | null;
  cumulative_sales_delta: number | null;
}

export interface HolidaySummary {
  totalOrders2025: number;
  totalRevenue2025: number;
  totalOrders2024: number;
  totalRevenue2024: number;
  ordersGrowth: number;
  revenueGrowth: number;
  daysWithData: number;
  latestDate: string | null;
  avgDailyOrders2025: number;
  avgDailyRevenue2025: number;
  avgOrderValue2025: number;
  avgOrderValue2024: number;
}

export interface HolidayResponse {
  data: HolidayData[];
  summary: HolidaySummary;
  lastSynced: string | null;
}

// Assembly Tracking Types
export interface DailyAssembly {
  date: string;
  daily_total: number;
  day_of_week: string | null;
  week_num: number | null;
  month: number | null;
  year: number | null;
  synced_at?: string;
}

export interface AssemblyTarget {
  sku: string;
  display_name: string; // From products table
  current_inventory: number;
  demand: number;
  current_shortage: number;
  original_plan: number;
  revised_plan: number;
  assembled_since_cutoff: number;
  deficit: number;
  category: string;
  t7?: number; // Trailing 7 days production
}

export interface AssemblyConfig {
  manufacturing_cutoff: string;
  cutoff_start_date: string;
  revised_manufacturing_need: number;
  assembled_since_cutoff: number;
}

export interface AssemblySummary {
  yesterdayProduction: number;
  yesterdayDelta: number;
  dailyAverage7d: number;
  dailyAverageDelta: number;
  currentWeekTotal: number;
  currentWeekDays: number;
  currentWeekDelta: number;
  dailyTarget: number;
  weeklyTarget: number;
  daysRemaining: number;
  totalDeficit: number;
  totalAssembled: number;
  totalRevisedPlan: number;
  progressPct: number;
  latestDate: string | null;
}

export interface WeeklyAssembly {
  week_num: number;
  year: number;
  total: number;
  days_worked: number;
  daily_avg: number;
}

export interface DayOfWeekAvg {
  day: string;
  avg: number;
  count: number;
}

export interface AssemblyResponse {
  daily: DailyAssembly[];
  targets: AssemblyTarget[];
  summary: AssemblySummary;
  weeklyData: WeeklyAssembly[];
  dayOfWeekAvg: DayOfWeekAvg[];
  config: AssemblyConfig;
  lastSynced: string | null;
}

// Budget vs Actual Types
export type BudgetDateRange = "mtd" | "2months" | "qtd" | "ytd" | "6months" | "custom";

export type BudgetCategory = "accessories" | "carbon_steel" | "cast_iron" | "glass_lid";

export interface BudgetSkuRow {
  displayName: string;
  sku: string;
  budget: number;
  actual: number;
  variance: number;
  variancePct: number;  // raw % of budget achieved (actual / budget * 100)
  pace: number;         // pace-adjusted % (are we on track? >100 = hot, <100 = slow)
}

export interface BudgetCategoryData {
  category: BudgetCategory;
  displayName: string;
  skus: BudgetSkuRow[];
  totals: {
    budget: number;
    actual: number;
    variance: number;
    variancePct: number;
    pace: number;
  };
}

export interface BudgetResponse {
  categories: BudgetCategoryData[];
  cookwareTotal: {
    budget: number;
    actual: number;
    variance: number;
    variancePct: number;
    pace: number;
  };
  grandTotal: {
    budget: number;
    actual: number;
    variance: number;
    variancePct: number;
    pace: number;
  };
  dateRange: BudgetDateRange;
  periodLabel: string;
  periodProgress: number; // e.g., 8/31 = 0.26 (26% through month)
  daysInPeriod: number;
  daysElapsed: number;
}
