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
  | "churned"       // No orders in 12+ months
  | "new"           // First order within last 90 days
  | "one_time"      // Only one order ever
  | "never_ordered"; // Account exists but has never placed an order - sales opportunity

export type CustomerSegment =
  | "major"       // $50K+ lifetime revenue
  | "large"       // $20-50K lifetime revenue
  | "mid"         // $10-20K lifetime revenue
  | "small"       // $5-10K lifetime revenue
  | "starter"     // $2-5K lifetime revenue
  | "minimal";    // <$2K lifetime revenue

export interface WholesaleCustomer {
  ns_customer_id: number;
  entity_id: string;
  company_name: string;
  email: string | null;
  phone: string | null;
  first_sale_date: string | null;
  last_sale_date: string | null;
  total_revenue: number;
  order_count: number;
  // Calculated health metrics
  health_status: CustomerHealthStatus;
  segment: CustomerSegment;
  avg_order_value: number;
  days_since_last_order: number | null;
  // Growth metrics
  revenue_trend: number; // % change vs prior period
  order_trend: number; // % change vs prior period
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
  never_ordered: number;
}

export interface WholesaleSegmentDistribution {
  major: number;
  large: number;
  mid: number;
  small: number;
  starter: number;
  minimal: number;
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
  // Customer breakdown
  health_distribution: WholesaleHealthDistribution;
  segment_distribution: WholesaleSegmentDistribution;
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
  // New customers - first-time buyers in last 90 days
  newCustomers: WholesaleCustomer[];
  // Churned customers - 365+ days since last order (excludes corporate/major accounts)
  churnedCustomers: WholesaleCustomer[];
  // Recent transactions
  recentTransactions: WholesaleTransaction[];
  // Top SKUs
  topSkus: WholesaleSkuStats[];
  // Metadata
  lastSynced: string | null;
}
