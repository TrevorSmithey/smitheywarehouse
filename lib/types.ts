import type { DashboardRole, DashboardTab } from "@/lib/auth/permissions";

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
  // B2B Draft Orders - SKUs on open draft orders
  draftOrderSkus?: B2BDraftOrderSku[];
  draftOrderTotals?: {
    totalUnits: number;
    totalSkus: number;
    totalOrders: number;
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
  fulfilled_today: number; // Fixed to today (EST), always visible regardless of date filter
  fulfilled_in_range: number; // Respects date filter selection ("SHIPPED" metric)
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
  closed_at: string | null; // When order was archived/closed
  fulfillment_status: string | null; // null, 'partial', 'fulfilled'
  fulfillments: ShopifyFulfillment[];
  line_items: ShopifyLineItem[];
  // Enhanced fields for ecommerce analytics
  customer?: {
    id: number;
    email?: string;
    first_name?: string;
    last_name?: string;
    orders_count?: number;
  } | null;
  total_price?: string;
  subtotal_price?: string;
  total_discounts?: string;
  total_tax?: string;
  total_shipping_price_set?: {
    shop_money?: {
      amount: string;
    };
  };
  discount_codes?: Array<{
    code: string;
    amount: string;
    type: string;
  }>;
  referring_site?: string | null;
  source_name?: string | null;
  landing_site?: string | null;
  financial_status?: string | null;
  payment_gateway_names?: string[];
  shipping_address?: {
    city?: string | null;
    province?: string | null;
    province_code?: string | null;
    country?: string | null;
    country_code?: string | null;
    zip?: string | null;
  } | null;
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
  // Smithey queue breakdown - engravings only go to Smithey
  smithey_engraving_orders: number; // unfulfilled Smithey orders with engraving line items
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

// ============================================================
// Revenue Tracker Types (Full-year sales comparison)
// ============================================================

/**
 * Channel filter for Revenue Tracker dashboard
 * - "total": Combined D2C + B2B revenue
 * - "retail": D2C/Shopify sales only
 * - "b2b": Wholesale/NetSuite sales only
 */
export type RevenueTrackerChannel = "total" | "retail" | "b2b";

export interface DaySalesData {
  dayOfYear: number;
  date: string;
  quarter: number;
  ordersCurrent: number;
  ordersComparison: number;
  revenueCurrent: number;
  revenueComparison: number;
  // Current year cumulative: null for days beyond last completed day (line stops)
  cumulativeOrdersCurrent: number | null;
  cumulativeRevenueCurrent: number | null;
  // Comparison year cumulative: always has value (historical data is complete)
  cumulativeOrdersComparison: number;
  cumulativeRevenueComparison: number;
}

export interface QuarterSummary {
  quarter: number;
  label: string;
  months: string;
  ordersCurrent: number;
  ordersComparison: number;
  ordersGrowth: number | null;
  revenueCurrent: number;
  revenueComparison: number;
  revenueGrowth: number | null;
  daysComplete: number;
  daysTotal: number;
  isComplete: boolean;
  isCurrent: boolean;
}

export interface YTDSummary {
  ordersCurrent: number;
  ordersComparison: number;
  ordersGrowth: number | null;
  revenueCurrent: number;
  revenueComparison: number;
  revenueGrowth: number | null;
  daysComplete: number;
  avgDailyOrders: number;
  avgDailyRevenue: number;
  avgOrderValue: number;
}

export interface RevenueTrackerResponse {
  currentYear: number;
  comparisonYear: number;
  dailyData: DaySalesData[];
  quarterSummaries: QuarterSummary[];
  ytdSummary: YTDSummary;
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

export interface AnnualTarget {
  sku: string;
  display_name: string;
  annual_target: number;
  ytd_built: number;
  t7: number;
  pct_complete: number;
}

export interface DefectRate {
  sku: string;
  display_name: string;
  fq_qty: number;           // First quality quantity (all time)
  defect_qty: number;       // Defect quantity (all time)
  total_qty: number;        // Total quantity (all time)
  defect_rate: number;      // All-time defect rate (percentage)
  recent_fq: number;        // FQ in last 60 days
  recent_defect: number;    // Defects in last 60 days
  recent_rate: number;      // 60-day defect rate (percentage)
  is_elevated: boolean;     // True if recent rate is significantly higher than all-time
}

export interface AssemblyResponse {
  daily: DailyAssembly[];
  targets: AssemblyTarget[];
  annualTargets: AnnualTarget[];
  defectRates: DefectRate[];
  summary: AssemblySummary;
  weeklyData: WeeklyAssembly[];
  dayOfWeekAvg: DayOfWeekAvg[];
  config: AssemblyConfig;
  lastSynced: string | null;
}

// Budget vs Actual Types
export type BudgetDateRange = "mtd" | "last_month" | "qtd" | "ytd" | "6months" | "custom";

export type BudgetCategory = "accessories" | "carbon_steel" | "cast_iron" | "glass_lid";

export type BudgetChannel = "retail" | "wholesale" | "combined";

// Comparison period types
export type CompareType = "previous_period" | "same_period_last_year" | "custom";

export interface ComparisonTotals {
  budget: number;
  actual: number;
  variance: number;
  variancePct: number;
  pace: number;
  // Delta vs comparison period
  delta: number;       // raw difference (current actual - comparison actual)
  deltaPct: number;    // percentage change vs comparison ((current - comparison) / comparison * 100)
}

export interface BudgetSkuComparison {
  displayName: string;
  sku: string;
  budget: number;
  actual: number;
  comparisonActual: number;
  delta: number;
  deltaPct: number;
}

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

// Channel-specific actuals (retail/wholesale breakdown)
export interface ChannelActuals {
  retail: number;
  wholesale: number;
  total: number;
}

// Channel-specific pace (for red/green dot indicators)
export interface ChannelPace {
  retail: number;
  wholesale: number;
  total: number;
}

// Channel-specific budgets (retail/wholesale breakdown)
export interface ChannelBudgets {
  retail: number;
  wholesale: number;
  total: number;
}

export interface BudgetSkuRowWithChannels extends BudgetSkuRow {
  channelActuals: ChannelActuals;
  channelBudgets: ChannelBudgets;
  channelPace: ChannelPace;
}

export interface BudgetCategoryDataWithChannels extends Omit<BudgetCategoryData, 'skus'> {
  skus: BudgetSkuRowWithChannels[];
  channelActuals: ChannelActuals;
  channelBudgets: ChannelBudgets;
  channelPace: ChannelPace;
}

export interface BudgetResponse {
  categories: BudgetCategoryDataWithChannels[];
  cookwareTotal: {
    budget: number;
    actual: number;
    variance: number;
    variancePct: number;
    pace: number;
    channelActuals: ChannelActuals;
    channelBudgets: ChannelBudgets;
    channelPace: ChannelPace;
  };
  grandTotal: {
    budget: number;
    actual: number;
    variance: number;
    variancePct: number;
    pace: number;
    channelActuals: ChannelActuals;
    channelBudgets: ChannelBudgets;
    channelPace: ChannelPace;
  };
  dateRange: BudgetDateRange;
  periodLabel: string;
  periodProgress: number; // e.g., 8/31 = 0.26 (26% through month)
  daysInPeriod: number;
  daysElapsed: number;
  // Comparison data (optional - only when compare mode is enabled)
  comparison?: {
    periodLabel: string;
    daysInPeriod: number;
    daysElapsed: number;
    categories: BudgetCategoryComparison[];
    cookwareTotal: ComparisonTotals;
    grandTotal: ComparisonTotals;
  };
}

export interface BudgetCategoryComparison {
  category: BudgetCategory;
  displayName: string;
  skus: BudgetSkuComparison[];
  totals: ComparisonTotals;
}

// Support Ticket Types (Re:amaze → Claude AI → Supabase)
export type TicketCategory =
  | "Spam"
  | "Product Inquiry"
  | "Product Recommendation"
  | "Ordering Inquiry"
  | "Engraving Question"
  | "Order Status"
  | "Shipping Status"
  | "Order Cancellation or Edit"
  | "Cooking Advice"
  | "Seasoning & Care"
  | "Seasoning Issue" // Legacy - mapped to "Seasoning & Care"
  | "Dutch Oven Issue"
  | "Website Issue"
  | "Quality Issue"
  | "Glass Lid Issue"
  | "Promotion or Sale Inquiry"
  | "Factory Seconds Question"
  | "Shipping Setup Issue"
  | "Delivery Delay or Problem"
  | "Return or Exchange"
  | "Wholesale Request"
  | "Metal Testing"
  | "New Product Inquiry"
  | "Positive Feedback"
  | "Phone Call (No Context)"
  | "Other";

export type TicketSentiment = "Positive" | "Negative" | "Neutral" | "Mixed";

export type TicketUrgency = "High" | "Normal" | null;

export interface SupportTicket {
  id: number;
  reamaze_id: string;
  created_at: string;
  subject: string | null;
  message_body: string | null;
  channel: string | null;
  perma_url: string | null;
  // AI classification
  category: TicketCategory;
  sentiment: TicketSentiment;
  summary: string;
  urgency: TicketUrgency;
  // Metadata
  analyzed_at: string;
  synced_at: string;
}

export interface TicketCategoryCount {
  category: TicketCategory;
  count: number;
  delta: number; // vs prior period
}

export interface TicketSentimentBreakdown {
  positive: number;
  neutral: number;
  negative: number;
  mixed: number;
  positivePct: number;
  neutralPct: number;
  negativePct: number;
  mixedPct: number;
}

export interface TicketAlertCounts {
  qualityNegative: number; // Quality Issue + Negative sentiment
  deliveryProblems: number; // Delivery Delay or Problem
  returnRequests: number; // Return or Exchange
  allNegative: number; // All tickets with Negative sentiment
}

export interface PurchaseTimingBreakdown {
  prePurchase: number; // Tickets where order_count = 0
  postPurchase: number; // Tickets where order_count > 0
  unknown: number; // Tickets without customer data
  prePurchasePct: number;
  postPurchasePct: number;
  // By category breakdown (top 5 pre-purchase categories)
  topPrePurchaseCategories: { category: string; count: number; pct: number }[];
  topPostPurchaseCategories: { category: string; count: number; pct: number }[];
}

export interface WordCloudItem {
  text: string;
  value: number; // frequency/weight
  sentiment: "positive" | "negative" | "neutral" | "mixed"; // dominant sentiment for this word
  sentimentScore: number; // -1 to 1 scale
}

export interface TopicTheme {
  name: string;
  count: number;
  previousCount: number; // previous period count for delta
  delta: number; // change from previous period
  deltaPct: number; // percentage change
  sentiment: "positive" | "negative" | "neutral" | "mixed";
  categories: string[];
}

export interface VOCInsight {
  type: "alert" | "trend" | "positive" | "info";
  title: string;
  description: string;
  metric?: string; // e.g., "+23%" or "105 tickets"
  action?: string; // suggested action
}

export interface CSATMetrics {
  totalRatings: number;
  averageScore: number; // 1-5 scale
  distribution: { [key: number]: number }; // 1-5 distribution
  satisfactionRate: number; // % of 4-5 ratings (CSAT score)
  previousSatisfactionRate?: number; // for delta
}

export interface TORTrendPoint {
  date: string; // YYYY-MM-DD
  tickets: number;
  orders: number;
  tor: number; // Ticket-to-Order Ratio as percentage
}

export interface TicketsResponse {
  tickets: SupportTicket[];
  totalCount: number;
  previousTotalCount: number; // for delta
  orderCount: number; // orders in same period for TOR
  previousOrderCount: number;
  ticketToOrderRatio: number; // TOR as percentage
  previousTOR: number;
  categoryCounts: TicketCategoryCount[];
  sentimentBreakdown: TicketSentimentBreakdown;
  alertCounts: TicketAlertCounts;
  wordCloud: WordCloudItem[];
  topicThemes: TopicTheme[];
  insights: VOCInsight[];
  torTrend: TORTrendPoint[]; // Daily TOR trend data for line chart
  purchaseTiming?: PurchaseTimingBreakdown; // Pre vs post-purchase breakdown
  csat?: CSATMetrics; // Optional - only when Re:amaze credentials are configured
  lastSynced: string | null;
}

// Re:amaze API types
export interface ReamazeConversation {
  slug: string; // unique identifier
  created_at: string;
  subject: string | null;
  category: {
    channel: number;
    name?: string;
  };
  message: {
    body: string;
  };
  perma_url: string;
}

export interface ReamazeConversationsResponse {
  conversations: ReamazeConversation[];
  page_count: number;
  page_size: number;
}

// ============================================================
// Klaviyo Marketing Types
// ============================================================

export type KlaviyoChannel = "email" | "sms";

export interface KlaviyoCampaignSummary {
  klaviyo_id: string;
  name: string;
  channel: KlaviyoChannel;
  send_time: string;
  recipients: number;
  delivered: number;
  opens: number;
  clicks: number;
  conversions: number;
  conversion_value: number;
  open_rate: number | null;
  click_rate: number | null;
  conversion_rate: number | null;
  unsubscribes: number;
}

export interface KlaviyoMonthlySummary {
  month_start: string;
  // Email campaign metrics
  email_campaigns_sent: number;
  email_recipients: number;
  email_delivered: number;
  email_opens: number;
  email_clicks: number;
  email_conversions: number;
  email_revenue: number;
  email_unsubscribes: number;
  email_avg_open_rate: number | null;
  email_avg_click_rate: number | null;
  // Flow metrics
  flow_revenue: number;
  flow_conversions: number;
  // Subscriber counts
  subscribers_120day: number | null;
  subscribers_365day: number | null;
  // Combined
  total_revenue: number;
  total_conversions: number;
}

export interface KlaviyoUpcomingCampaign {
  klaviyo_id: string;
  name: string;
  channel: KlaviyoChannel;
  scheduled_time: string;
  audience_size: number | null;
  predicted_opens: number | null;
  predicted_conversions: number | null;
  predicted_revenue: number | null;
}

export interface KlaviyoFlow {
  klaviyo_id: string;
  name: string;
  status: "draft" | "manual" | "live";
  trigger_type: string | null;
  total_recipients: number;
  total_conversions: number;
  total_revenue: number;
  conversion_rate: number | null;
}

export interface KlaviyoStats {
  // Period totals
  campaign_revenue: number;
  flow_revenue: number;
  total_revenue: number;
  total_conversions: number;
  campaigns_sent: number;
  // Subscriber counts
  subscribers_120day: number;
  subscribers_365day: number;
  // Averages
  avg_open_rate: number;
  avg_click_rate: number;
  // Email % of web revenue
  email_pct_of_revenue: number;
  // Period comparison
  revenue_delta: number; // vs previous period
  revenue_delta_pct: number;
  // Advanced KPIs
  campaign_rpr: number; // Revenue Per Recipient (campaigns)
  flow_rpr: number; // Revenue Per Recipient (flows)
  total_recipients: number; // Total recipients in period
  unsubscribe_rate: number; // Unsubscribes / Delivered
  placed_order_rate: number; // Conversions / Delivered
  // Deliverability metrics
  total_delivered: number;
  total_bounces: number;
  bounce_rate: number; // Bounces / Recipients
  delivery_rate: number; // Delivered / Recipients
  // List health score (0-100)
  list_health_score: number;
  // Revenue per email sent
  revenue_per_email: number;
}

// Send time analysis - which hours/days perform best
export interface SendTimeAnalysis {
  byHour: Array<{
    hour: number; // 0-23
    campaigns: number;
    avg_open_rate: number;
    avg_click_rate: number;
    total_revenue: number;
  }>;
  byDayOfWeek: Array<{
    day: number; // 0=Sunday, 6=Saturday
    dayName: string;
    campaigns: number;
    avg_open_rate: number;
    avg_click_rate: number;
    total_revenue: number;
  }>;
  bestHour: number;
  bestDay: string;
}

// Flow performance breakdown by category
export interface FlowBreakdown {
  welcome: { revenue: number; conversions: number; flowCount: number };
  abandoned_cart: { revenue: number; conversions: number; flowCount: number };
  abandoned_checkout: { revenue: number; conversions: number; flowCount: number };
  browse_abandonment: { revenue: number; conversions: number; flowCount: number };
  post_purchase: { revenue: number; conversions: number; flowCount: number };
  winback: { revenue: number; conversions: number; flowCount: number };
  other: { revenue: number; conversions: number; flowCount: number };
}

export interface KlaviyoResponse {
  // Monthly stats for trend chart
  monthly: KlaviyoMonthlySummary[];
  // Recent campaigns
  campaigns: KlaviyoCampaignSummary[];
  // Upcoming scheduled campaigns
  upcoming: KlaviyoUpcomingCampaign[];
  // Flows
  flows: KlaviyoFlow[];
  // Period summary stats
  stats: KlaviyoStats;
  // Send time analysis
  sendTimeAnalysis: SendTimeAnalysis;
  // Flow breakdown by category
  flowBreakdown: FlowBreakdown;
  // Metadata
  lastSynced: string | null;
}

// ============================================================
// Wholesale Analytics Types (NetSuite → Supabase)
// ============================================================

export type WholesalePeriod = "mtd" | "last_month" | "qtd" | "ytd" | "30d" | "90d" | "12m";

export type CustomerHealthStatus =
  | "thriving"      // Growing revenue, frequent orders
  | "stable"        // Consistent ordering pattern
  | "declining"     // Decreasing order frequency/value
  | "at_risk"       // Significant decline, needs attention
  | "churning"      // No orders in 6+ months after previous activity
  | "churned"       // No orders in 12+ months (includes accounts that never ordered)
  | "new"           // First order within last 90 days
  | "one_time";     // Only one order ever

export type CustomerSegment =
  | "major"       // $50K+ lifetime revenue
  | "large"       // $20-50K lifetime revenue
  | "mid"         // $10-20K lifetime revenue
  | "small"       // $5-10K lifetime revenue
  | "starter"     // $2-5K lifetime revenue
  | "minimal";    // <$2K lifetime revenue

// 4-bucket retention health - time-based classification (aligned with Door Health tab)
// This is the PRIMARY classification for cross-tab "At Risk" / "Churned" alignment
export type RetentionHealthBucket =
  | "healthy"     // <180 days since last order
  | "at_risk"     // 180-269 days since last order
  | "churning"    // 270-364 days since last order
  | "churned";    // 365+ days since last order

export interface WholesaleCustomer {
  ns_customer_id: number;
  entity_id: string;
  company_name: string;
  email: string | null;
  phone: string | null;
  first_sale_date: string | null;
  last_sale_date: string | null;
  total_revenue: number;
  ytd_revenue: number;
  order_count: number;
  // Calculated health metrics
  health_status: CustomerHealthStatus; // 8-bucket detailed classification
  retention_health?: RetentionHealthBucket; // 4-bucket time-based (matches Door Health)
  segment: CustomerSegment;
  avg_order_value: number;
  days_since_last_order: number | null;
  // Growth metrics
  revenue_trend: number; // % change vs prior period
  order_trend: number; // % change vs prior period
  is_declining?: boolean; // YoY revenue drop >20% (for Door Health badge)
  // Corporate customer flag - replaces segment badge display when true
  is_corporate_gifting: boolean;
  // Manual churn flag - excludes from ordering anomaly alerts
  is_manually_churned?: boolean;
}

export interface WholesaleTransaction {
  ns_transaction_id: number;
  tran_id: string;
  transaction_type: "CashSale" | "CustInvc";
  tran_date: string;
  ns_customer_id: number;
  company_name: string;
  foreign_total: number;
  status: string | null;
}

export interface WholesaleLineItem {
  ns_line_id: number;
  ns_transaction_id: number;
  sku: string;
  quantity: number;
  rate: number | null;
  net_amount: number | null;
  item_type: string | null;
}

export interface WholesaleMonthlyStats {
  month: string; // YYYY-MM-01
  transaction_count: number;
  unique_customers: number;
  total_units: number;
  total_revenue: number;
  avg_order_value: number;
  // Revenue breakdown by customer type
  corporate_revenue: number;
  regular_revenue: number;
  // YoY comparison (calculated in API)
  yoy_revenue_change: number | null;
  yoy_customer_change: number | null;
}

export interface WholesaleSkuStats {
  sku: string;
  item_type: string | null;
  order_count: number;
  total_units: number;
  total_revenue: number;
  first_sold: string;
  last_sold: string;
}

export interface WholesaleHealthDistribution {
  thriving: number;
  stable: number;
  declining: number;
  at_risk: number;
  churning: number;
  churned: number;
  new: number;
  one_time: number;
}

// 4-bucket retention distribution (aligned with Door Health tab)
// Uses pure time-based thresholds for cross-tab consistency
export interface WholesaleRetentionDistribution {
  healthy: number;      // <180 days since last order
  at_risk: number;      // 180-269 days since last order
  churning: number;     // 270-364 days since last order
  churned: number;      // 365+ days since last order
  healthy_declining: number; // Healthy by time, but >20% YoY revenue drop
}

export interface WholesaleSegmentDistribution {
  major: number;
  large: number;
  mid: number;
  small: number;
  starter: number;
  minimal: number;
}

// Revenue breakdown by business type (corporate vs standard B2B)
export interface WholesaleRevenueByType {
  corporate: {
    revenue: number;
    customer_count: number;
    order_count: number;
    revenue_pct: number;
  };
  standard_b2b: {
    revenue: number;
    customer_count: number;
    order_count: number;
    revenue_pct: number;
  };
}

export interface WholesaleStats {
  // Period totals
  total_revenue: number;
  total_orders: number;
  total_customers: number;
  active_customers: number;
  avg_order_value: number;
  // Comparison vs previous period
  revenue_delta: number;
  revenue_delta_pct: number;
  orders_delta: number;
  orders_delta_pct: number;
  customers_delta: number;
  customers_delta_pct: number;
  avg_order_value_delta: number;
  avg_order_value_delta_pct: number;
  prev_avg_order_value: number;
  // Customer breakdown
  health_distribution: WholesaleHealthDistribution; // 8-bucket detailed
  segment_distribution: WholesaleSegmentDistribution;
  // Revenue breakdown by business type
  revenue_by_type?: WholesaleRevenueByType;
  // Aligned 4-bucket retention distribution (matches Door Health tab)
  retention_distribution?: WholesaleRetentionDistribution;
  // Dual Revenue at Risk metrics (per alignment decision)
  revenue_at_risk_retention?: number; // Time-based (180-364d customers)
  revenue_at_risk_growth?: number;    // Trend-based (declining YoY customers)
}

export interface WholesaleAtRiskCustomer {
  ns_customer_id: number;
  company_name: string;
  segment: CustomerSegment;
  total_revenue: number;
  last_order_date: string | null;
  days_since_last_order: number;
  order_count: number;
  avg_order_value: number;
  risk_score: number;
  recommended_action: string;
  is_churned: boolean;
  is_corporate_gifting: boolean;
}

export type OpportunityType = "upsell" | "cross_sell" | "volume_increase" | "new_category";

// Customers with accounts but zero orders - sales opportunities
export interface WholesaleNeverOrderedCustomer {
  ns_customer_id: number;
  entity_id: string;
  company_name: string;
  email: string | null;
  phone: string | null;
  date_created: string | null;
  days_since_created: number | null;
  category: string | null;
  is_inactive: boolean;
}

export interface WholesaleGrowthOpportunity {
  ns_customer_id: number;
  company_name: string;
  segment: CustomerSegment;
  current_revenue: number;
  growth_potential: number;
  revenue_trend: number;
  order_trend: number;
  opportunity_type: OpportunityType;
}

// Customers who are overdue based on their own ordering pattern
// This is the RIGHT way to detect at-risk customers - per-customer behavioral analysis
export type OrderingAnomalySeverity = "critical" | "warning" | "watch";

export interface WholesaleOrderingAnomaly {
  ns_customer_id: number;
  company_name: string;
  segment: CustomerSegment;
  total_revenue: number;
  order_count: number;
  // Their typical ordering pattern
  avg_order_interval_days: number;
  // Current state
  last_order_date: string;
  days_since_last_order: number;
  // Anomaly metrics
  expected_order_date: string; // When we expected them to order
  days_overdue: number; // How many days past their expected order (negative = not overdue)
  overdue_ratio: number; // days_since_last_order / avg_order_interval (>1 means late)
  // Severity: critical (>2x late), warning (>1.5x late), watch (>1.2x late)
  severity: OrderingAnomalySeverity;
  // Churned flag (365+ days since last order)
  is_churned: boolean;
  // Corporate gifting customer
  is_corporate_gifting: boolean;
}

// New customer acquisition comparison - YoY with outlier handling
export interface WholesaleNewCustomerAcquisition {
  // Current period (YTD or selected period)
  currentPeriod: {
    startDate: string;
    endDate: string;
    newCustomerCount: number;
    totalRevenue: number;
    avgOrderValue: number;
  };
  // Same period prior year
  priorPeriod: {
    startDate: string;
    endDate: string;
    newCustomerCount: number;
    totalRevenue: number;
    avgOrderValue: number;
  };
  // YoY comparison (raw, includes outliers)
  yoyComparison: {
    customerCountDelta: number;
    customerCountDeltaPct: number;
    revenueDelta: number;
    revenueDeltaPct: number;
  };
  // Outliers - large single orders that skew comparison
  outliers: Array<{
    ns_customer_id: number;
    company_name: string;
    revenue: number;
    orderDate: string;
    period: "current" | "prior";
    // Why it's an outlier (e.g., ">3x average order value")
    reason: string;
  }>;
  // Adjusted comparison (excludes outliers for apples-to-apples)
  adjustedComparison: {
    currentRevenue: number;
    priorRevenue: number;
    revenueDelta: number;
    revenueDeltaPct: number;
    outliersExcluded: number;
  };
}

export interface WholesaleResponse {
  // Monthly revenue trend for charts
  monthly: WholesaleMonthlyStats[];
  // Period summary stats
  stats: WholesaleStats;
  // Customer lists
  topCustomers: WholesaleCustomer[];
  atRiskCustomers: WholesaleAtRiskCustomer[];
  growthOpportunities: WholesaleGrowthOpportunity[];
  neverOrderedCustomers: WholesaleNeverOrderedCustomer[];
  // Ordering anomalies - customers late based on their own pattern (the RIGHT way)
  orderingAnomalies: WholesaleOrderingAnomaly[];
  // New customers - first-time buyers in last 90 days (excludes corporate gifting)
  newCustomers: WholesaleCustomer[];
  // Corporate gifting customers - all accounts flagged as corporate (show all, no slicing)
  corporateCustomers: WholesaleCustomer[];
  // Churned customers - 365+ days since last order (excludes corporate/major accounts)
  churnedCustomers: WholesaleCustomer[];
  // Recent transactions
  recentTransactions: WholesaleTransaction[];
  // Top SKUs
  topSkus: WholesaleSkuStats[];
  // New customer acquisition YoY comparison with outlier handling
  newCustomerAcquisition: WholesaleNewCustomerAcquisition | null;
  // Customers grouped by health status for drill-down views
  customersByHealth: {
    thriving: WholesaleCustomer[];
    stable: WholesaleCustomer[];
    declining: WholesaleCustomer[];
    at_risk: WholesaleCustomer[];
    churning: WholesaleCustomer[];
    churned: WholesaleCustomer[];
    new: WholesaleCustomer[];
    one_time: WholesaleCustomer[];
  };
  // Metadata
  lastSynced: string | null;
  // Partial errors - indicates which data sections failed to load
  partialErrors?: {
    section: string;
    message: string;
  }[];
}

// ============================================================
// AI Pattern Recognition Types
// ============================================================

export type ChurnSignalType =
  | "interval_extended"
  | "size_declining"
  | "frequency_dropped"
  | "pattern_break"
  | "combined_warning";

export type ChurnRiskLevel = "critical" | "high" | "medium" | "low";

export interface ChurnSignal {
  type: ChurnSignalType;
  severity: "critical" | "warning" | "watch";
  description: string;
  evidence: string;
}

export interface ChurnPrediction {
  ns_customer_id: number;
  company_name: string;
  segment: CustomerSegment;
  churnRiskScore: number;
  riskLevel: ChurnRiskLevel;
  signals: ChurnSignal[];
  narrative: string;
  revenueAtRisk: number;
  recommendedAction: string;
  confidenceLevel: number;
}

export interface PatternInsightsResponse {
  predictions: ChurnPrediction[];
  summary: {
    totalAnalyzed: number;
    criticalRisk: number;
    highRisk: number;
    mediumRisk: number;
    lowRisk: number;
    totalRevenueAtRisk: number;
    avgConfidence: number;
  };
  patternStats: {
    avgOrderInterval: number;
    avgOrderSize: number;
    customersWithConsistentPatterns: number;
    customersWithSeasonalPatterns: number;
    customersWithSizeTrend: number;
  };
  topSignals: {
    intervalExtended: number;
    sizeDeclining: number;
    frequencyDropped: number;
    patternBreak: number;
    combinedWarning: number;
  };
  lastAnalyzed: string;
}

// ============================================================
// Typeform Lead Tracking Types
// ============================================================

export type LeadStatus = "new" | "contacted" | "qualified" | "converted" | "lost" | "archived";

export type LeadFormType = "wholesale" | "corporate";

export type LeadMatchStatus = "pending" | "auto_matched" | "manual_matched" | "no_match" | "rejected";

export interface TypeformLead {
  id: number;
  typeform_response_id: string;
  typeform_form_id: string;
  form_type: LeadFormType;
  // Submission data - Core
  company_name: string;
  contact_first_name: string | null;
  contact_last_name: string | null;
  contact_title: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  // Address
  address: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  country: string | null;
  // Business details
  store_type: string | null; // "Brick and mortar", "Online only", "Both brick and mortar and online presence"
  location_count: string | null;
  industry: string | null;
  years_in_business: string | null;
  ein: string | null;
  // Social/Web
  instagram_url: string | null;
  has_instagram: boolean | null;
  has_website: boolean | null;
  // Lead qualification
  referral_source: string | null; // "How did you first hear about Smithey?"
  fit_reason: string | null; // "Why might Smithey be a good fit?"
  notes: string | null; // Additional notes from submission
  submitted_at: string;
  raw_payload: Record<string, unknown>;
  // Lead status
  status: LeadStatus;
  assigned_to: string | null;
  // Matching
  match_status: LeadMatchStatus;
  matched_customer_id: number | null;
  match_confidence: number | null;
  match_candidates: MatchCandidate[] | null;
  matched_at: string | null;
  matched_by: string | null; // "auto" or user ID
  // Conversion tracking
  converted_at: string | null;
  first_order_id: number | null;
  first_order_date: string | null;
  first_order_amount: number | null;
  days_to_conversion: number | null;
  // AI Analysis
  ai_summary: string | null;
  ai_fit_score: number | null; // 1-5 score
  ai_analyzed_at: string | null;
  // Timestamps
  synced_at: string;
  updated_at: string;
}

export interface MatchCandidate {
  ns_customer_id: number;
  company_name: string;
  confidence: number; // 0-100 similarity score
  match_reasons: string[]; // e.g., ["company_name: 92%", "email_domain: 100%"]
}

// Metrics for a single form type (wholesale or corporate)
export interface FormTypeFunnelMetrics {
  total: number; // All leads of this type
  converted: number; // Leads that converted (matched + placed order)
  conversion_rate: number; // converted / matched * 100 (only trackable leads)
  avg_days_to_conversion: number | null;
}

export interface LeadFunnelMetrics {
  // Overall totals
  total_leads: number;
  converted_leads: number;
  conversion_rate: number; // converted / total * 100
  avg_days_to_conversion: number | null;
  // By form type - simplified funnel
  wholesale: FormTypeFunnelMetrics;
  corporate: FormTypeFunnelMetrics;
  // Legacy fields kept for backwards compatibility
  new_leads: number;
  contacted_leads: number;
  qualified_leads: number;
  lost_leads: number;
  wholesale_leads: number;
  corporate_leads: number;
  auto_matched: number;
  manual_matched: number;
  pending_match: number;
  total_conversion_revenue: number;
  leads_delta: number;
  leads_delta_pct: number;
  conversion_rate_delta: number;
  // AI fit score distribution (1-5 scale + pending)
  ai_score_distribution: {
    poor: number;   // Score 1
    weak: number;   // Score 2
    maybe: number;  // Score 3
    good: number;   // Score 4
    great: number;  // Score 5
    pending: number; // Not yet analyzed
  };
}

export interface LeadVolumeByPeriod {
  period: string; // YYYY-MM or YYYY-MM-DD depending on granularity
  wholesale: number;
  corporate: number;
  total: number;
  converted: number;
  conversion_rate: number;
}

export interface LeadsResponse {
  // Lead list (paginated)
  leads: TypeformLead[];
  total_count: number;
  // Funnel metrics
  funnel: LeadFunnelMetrics;
  // Volume trend
  volume_trend: LeadVolumeByPeriod[];
  // Leads needing review (pending match, sorted by confidence desc)
  pending_review: TypeformLead[];
  // Metadata
  lastSynced: string | null;
}

// ============================================================
// Customer Detail View Types (Sales Tab)
// ============================================================

export interface CustomerOrderingPattern {
  avg_order_interval_days: number | null;  // Median days between orders (user-facing "Typical interval")
  interval_range_high: number | null;  // P75 - used internally for overdue detection (more conservative than median)
  days_since_last_order: number | null;
  last_order_date: string | null;
  first_order_date: string | null;
  customer_tenure_years: number | null;
  overdue_ratio: number | null;  // days_since_last / p75_interval
  expected_order_date: string | null;
}

export interface CustomerRevenueTrend {
  t12_revenue: number;       // Trailing 12 months
  prior_t12_revenue: number; // Prior trailing 12 months (13-24 months ago)
  yoy_change_pct: number | null;
  avg_order_value: number | null;
  total_revenue: number;
  order_count: number;
}

export interface CustomerProductMix {
  sku: string;
  item_type: string | null;
  total_units: number;
  total_revenue: number;
  last_purchased: string | null;
}

export interface CustomerOrderHistory {
  ns_transaction_id: number;
  tran_id: string;
  tran_date: string;
  foreign_total: number;
  status: string | null;
}

export interface CustomerDetailResponse {
  // Core customer data
  customer: WholesaleCustomer;
  // Ordering pattern metrics
  orderingPattern: CustomerOrderingPattern;
  // Revenue trend
  revenueTrend: CustomerRevenueTrend;
  // Product mix (top SKUs purchased)
  productMix: CustomerProductMix[];
  // Order history
  orderHistory: CustomerOrderHistory[];
}

// ============================================================
// B2B Draft Orders Types (Shopify B2B → Supabase)
// ============================================================

export interface B2BDraftOrderSku {
  sku: string;
  displayName: string;
  category: InventoryCategory | null;
  quantity: number;        // Total units across all draft orders
  orderCount: number;      // Number of draft orders containing this SKU
  avgPrice: number | null; // Average unit price across orders
}

// ============================================================
// Door Health / Churn Analytics Types
// ============================================================

/**
 * Lifespan bucket for grouping churned customers by tenure
 */
export type LifespanBucket = "<1yr" | "1-2yr" | "2-3yr" | "3+yr";

/**
 * Core metrics for the Door Health dashboard
 */
export interface DoorHealthMetrics {
  totalB2BCustomers: number;      // All non-corporate wholesale customers
  activeCustomers: number;        // < 180 days since last order
  inactiveCustomers: number;      // >= 180 days (at_risk + churning + churned)
  churnedCustomers: number;       // >= 365 days
  churnRateYtd: number;           // % of customers that churned this calendar year
  churnRatePriorYear: number;     // % of customers that churned last year
  churnRateChange: number;        // YoY change in percentage points
  avgLifespanMonths: number;      // Average months from first to last order (churned only)
  avgLifespanMonthsPriorYear: number;
  lostRevenue: number;            // Total lifetime revenue of churned customers
  revenueAtRisk: number;          // Lifetime revenue of at-risk + churning customers (180-365d)
}

/**
 * Retention funnel counts matching health_status thresholds:
 * - active: < 180 days (thriving + stable)
 * - atRisk: 180-269 days
 * - churning: 270-364 days
 * - churned: >= 365 days
 */
export interface DoorHealthFunnel {
  active: number;
  atRisk: number;
  churning: number;
  churned: number;
  /** Count of active customers with YoY revenue decline >20% */
  healthyDeclining: number;
}

/**
 * Churn breakdown by year with pool-adjusted rate
 * Pool shrinks each year as customers churn out
 */
export interface ChurnedByYear {
  year: number;
  count: number;
  revenue: number;
  poolSize: number;       // Customers at START of this year (excludes prior churned)
  churnRate: number;      // count / poolSize * 100
}

/**
 * Dud rate by acquisition cohort
 * Dud = one-time buyer who hasn't reordered within maturity window (133 days)
 */
export interface DudRateByCohort {
  cohort: string;           // "2023", "2024", "2025 H1", "2025 H2"
  totalAcquired: number;    // Customers acquired in this cohort
  matureCustomers: number;  // Customers with 133+ days since first order
  matureOneTime: number;    // One-time buyers among mature customers
  dudRate: number | null;   // null if not enough mature customers
  isMature: boolean;        // Whether cohort has had enough time to assess
}

/**
 * Churn breakdown by customer segment
 */
export interface ChurnedBySegment {
  segment: CustomerSegment;
  count: number;
  revenue: number;
  avgLifespanMonths: number;
}

/**
 * Churn breakdown by customer lifespan
 */
export interface ChurnedByLifespan {
  bucket: LifespanBucket;
  count: number;
  revenue: number;
}

/**
 * Individual churned customer for drill-down tables
 */
export interface DoorHealthCustomer {
  ns_customer_id: number;
  company_name: string;
  segment: CustomerSegment;
  first_sale_date: string | null;
  last_sale_date: string | null;
  days_since_last_order: number | null;
  total_revenue: number;
  order_count: number;
  lifespan_months: number | null;
  churn_year: number | null;
  /** True if customer has YoY revenue decline >20% */
  is_declining?: boolean;
}

/**
 * Cohort retention analysis - the REAL churn story
 * Shows what % of each acquisition cohort is still active vs churned
 */
export interface CohortRetention {
  year: number;               // Acquisition year (2023, 2024, 2025)
  acquired: number;           // Total customers acquired in this cohort
  healthy: number;            // Still ordering (<180 days since last)
  atRisk: number;             // 180-269 days since last order
  churning: number;           // 270-364 days since last order
  churned: number;            // 365+ days since last order
  retained: number;           // healthy + atRisk + churning (not yet lost)
  retentionPct: number;       // retained / acquired * 100
  churnPct: number;           // churned / acquired * 100
  isMaturing: boolean;        // true if cohort hasn't had full year to churn
}

/**
 * Full API response for Door Health dashboard
 */
export interface DoorHealthResponse {
  metrics: DoorHealthMetrics;
  funnel: DoorHealthFunnel;
  churnedByYear: ChurnedByYear[];
  churnedBySegment: ChurnedBySegment[];
  churnedByLifespan: ChurnedByLifespan[];
  dudRateByCohort: DudRateByCohort[];
  cohortRetention: CohortRetention[];  // NEW: Honest cohort-level retention
  customers: DoorHealthCustomer[];
  lastSynced: string | null;
}

// ============================================================================
// ADMIN DASHBOARD TYPES
// ============================================================================

export interface DashboardUser {
  id: string;
  name: string;
  email: string | null;
  role: DashboardRole;
  pin: string;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
  last_active_at: string | null;
  notes: string | null;
  default_page_override: string | null;
  additional_tabs: string[] | null;
}

export interface UserActivitySummary {
  userId: string;
  daysActive: number;
  dailyActivity: boolean[];
  lastActiveAt: string | null;
  isActiveNow: boolean;
}

export interface AdminStats {
  totalUsers: number;
  activeThisWeek: number;
  activeToday: number;
  mostViewedTab: { tab: string; views: number } | null;
  failedLoginsToday: number;
  activitySummaries: Record<string, UserActivitySummary>;
}

export interface DashboardConfig {
  tab_order: DashboardTab[];
  hidden_tabs: DashboardTab[];
  role_permissions: Record<DashboardRole, string[]>;
  role_defaults: Record<DashboardRole, DashboardTab>;
  role_tab_orders: Record<DashboardRole, DashboardTab[]>;
}

export interface ActivityEntry {
  id: string;
  userId: string;
  userName: string;
  userRole: string | null;
  action: string;
  tab: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface SyncInfo {
  type: string;
  status: string;
  lastRun: string | null;
  recordsExpected: number | null;
  recordsSynced: number | null;
  successRate: number;
  durationMs: number | null;
  hoursSinceSuccess: number | null;
  error: string | null;
  isStale: boolean;
  staleThreshold: number;
  schedule: string | null;
}

export interface SyncHealthResponse {
  status: "healthy" | "warning" | "critical";
  syncs: SyncInfo[];
  checkedAt: string;
}

export interface Announcement {
  id: string;
  title: string;
  message: string | null;
  severity: "info" | "warning" | "critical";
  starts_at: string;
  expires_at: string | null;
  created_by: string;
  created_at: string;
  is_archived: boolean;
}
