# Smithey Warehouse Dashboard - Technical Documentation

> For Trevor. Complete technical reference with exact calculations, data flows, and source code references.

---

## Table of Contents
1. [Inventory Tab](#1-inventory-tab)
2. [D2C / Fulfillment Tab](#2-d2c--fulfillment-tab)
3. [Assembly Tab](#3-assembly-tab)
4. [Holiday Tab](#4-holiday-tab)
5. [Budget vs Actual Tab](#5-budget-vs-actual-tab)
6. [Sales (Wholesale) Tab](#6-sales-wholesale-tab)
7. [Marketing (Klaviyo) Tab](#7-marketing-klaviyo-tab)
8. [Cron Jobs & Sync Schedule](#8-cron-jobs--sync-schedule)
9. [File Paths Reference](#9-file-paths-reference)
10. [SWOT Analysis](#10-swot-analysis) *(opinion/analysis)*

---

# 1. Inventory Tab

## Data Source: ShipHero → Supabase

**API Endpoint**: `/api/inventory`
**Sync Frequency**: Every 15 minutes (Vercel cron)
**Source Files**: `lib/shiphero.ts`, `app/api/cron/sync-inventory/route.ts`

### What ShipHero Returns

**GraphQL Query** (`lib/shiphero.ts:93-119`):
```graphql
query GetProducts($cursor: String) {
  products {
    data(first: 100, after: $cursor) {
      edges {
        node {
          sku
          name
          warehouse_products {
            warehouse_id
            on_hand      # Physical units in warehouse
            available    # Sellable units (on_hand - allocated)
            allocated    # Reserved for pending orders
            backorder    # Sold but not yet available (oversold)
          }
        }
      }
    }
  }
}
```

### Inventory Calculation

**Source**: `lib/shiphero.ts:216-223`

```typescript
// Net = available - backorder (can be negative when backordered)
const getNetAvailable = (warehouseId: string): number => {
  const wp = product.warehouse_products.find(w => w.warehouse_id === warehouseId);
  if (!wp) return 0;
  return wp.available - wp.backorder;
};
```

**Key Points**:
- `on_hand` = physical units in warehouse
- `available` = on_hand - allocated (sellable units)
- `backorder` = units sold beyond available (oversold)
- **Dashboard shows**: `available - backorder`
- **Negative number** = we owe customers more than we have

### Warehouse IDs
| Warehouse | ShipHero Numeric ID | Base64 GraphQL ID |
|-----------|---------------------|-------------------|
| Pipefitter | 120758 | V2FyZWhvdXNlOjEyMDc1OA== |
| Hobson | 77373 | V2FyZWhvdXNlOjc3Mzcz |
| Selery | 93742 | V2FyZWhvdXNlOjkzNzQy |

---

## DOI (Days of Inventory) Calculation

**Source**: `lib/doi.ts:128-217`

### IMPORTANT: DOI Uses BUDGETS, Not Velocity

**DOI is NOT based on historical sales velocity.** It uses **monthly budget targets** from the `budgets` database table - the planned units we expect to sell each month.

| Metric | Source | Purpose |
|--------|--------|---------|
| **Velocity** | ShipHero orders (3-day rolling avg) | Shows recent actual sales rate |
| **DOI** | `budgets` table (monthly targets) | Projects stockout based on planned demand |

This means DOI reflects our sales plan, not past performance. If we budget 600 units/month but only sell 300, DOI will still project based on the 600.

### Algorithm Step-by-Step

```
INPUT:
  - sku: Product SKU
  - currentInventory: Sum of (available - backorder) across warehouses
  - budgetLookup: Map of SKU → Year → Month → Budget (units from budgets table)

ALGORITHM:
  1. Get today's date in EST timezone
  2. Look up this month's BUDGET for this SKU from database
  3. daily_demand = monthly_budget / days_in_month
  4. remaining_demand_this_month = daily_demand × days_left_in_month

  5. IF inventory ≤ remaining_demand_this_month:
       stockout_days = inventory / daily_demand
       RETURN stockout_days

  6. ELSE:
       remaining_inventory = inventory - remaining_demand_this_month
       days_counted = days_left_in_month
       Move to next month, GOTO step 2

  7. Continue until inventory = 0 or 730 days (2 years max)

OUTPUT:
  - doi: Days until stockout (rounded integer)
  - stockoutWeek: ISO week number when stockout occurs
  - stockoutYear: Year of stockout
  - undefined: If no budget data exists for SKU
```

### Concrete Example

```
SKU: Smith-CI-Skil12
Inventory: 500 units
Today: December 11, 2025 (20 days left in December)

Step 1: December budget = 600 units
  daily_demand = 600 / 31 = 19.35/day
  remaining_december_demand = 19.35 × 20 = 387 units
  500 > 387, so we survive December
  remaining_after_dec = 500 - 387 = 113 units

Step 2: January budget = 400 units
  daily_demand = 400 / 31 = 12.9/day
  days_into_january = 113 / 12.9 = 8.76 days

RESULT: DOI = 20 + 9 = 29 days (stockout ~Jan 9)
```

### DOI Color Thresholds

**Source**: `app/page.tsx:2656-2663`

| DOI | Status | Hex Color | Meaning |
|-----|--------|-----------|---------|
| Backorder (total < 0) | Critical | #F87171 | We owe customers |
| < 7 days | Urgent | #F87171 | Reorder immediately |
| 7-29 days | Watch | #F59E0B | Plan reorder |
| 30-59 days | OK | #FBBF24 | Monitor |
| 60+ days | Healthy | #34D399 | Good position |
| undefined | No data | #6B7280 | No budget in DB |

---

## Sales Velocity Calculation

**Source**: `app/api/inventory/route.ts:338-370`

### Formula

```
Current Period: (today - 3 days) to (today - 1 day) [excludes today]
Prior Period: (today - 6 days) to (today - 4 days)

velocity = sum(line_items.quantity for current_period) / 3
prior_velocity = sum(line_items.quantity for prior_period) / 3
delta_pct = ((velocity - prior_velocity) / prior_velocity) × 100
```

### Code

```typescript
const sales3DayTotal = sales3DayBySku.get(skuLower) || 0;
const prior3DayTotal = salesPrior3DayBySku.get(skuLower) || 0;
const sales3DayAvg = Math.round(sales3DayTotal / 3);
const prior3DayAvg = Math.round(prior3DayTotal / 3);

const delta = prior3DayAvg > 0
  ? Math.round(((sales3DayAvg - prior3DayAvg) / prior3DayAvg) * 100)
  : sales3DayAvg > 0 ? 100 : 0;
```

### Example

```
SKU: Smith-CI-Skil12
Dec 8-10 sales: 45 units → velocity = 15/day
Dec 5-7 sales: 36 units → prior = 12/day
Delta = ((15 - 12) / 12) × 100 = +25%

Display: "15/day (+25%)"
```

---

## Safety Stock & Row Highlighting

### Safety Stock Values

**Source**: `lib/shiphero.ts:333-362` (hardcoded from "Safety Stock Q4 25.xlsx")

| Cast Iron | SS | Carbon Steel | SS |
|-----------|----|--------------|----|
| Smith-CI-Skil12 | 144 | Smith-CS-Farm12 | 35 |
| Smith-CI-Skil10 | 144 | Smith-CS-Farm9 | 45 |
| Smith-CI-Chef10 | 144 | Smith-CS-Fish | 14 |
| Smith-CI-Griddle18 | 88 | Smith-CS-OvalM | 36 |
| Smith-CI-Flat12 | 72 | Smith-CS-Round17N | 20 |
| Smith-CI-Skil8 | 72 | Smith-CS-Deep12 | 35 |
| Smith-CI-Skil6 | 72 | Smith-CS-WokM | 32 |
| Smith-CI-Dual12 | 72 | Smith-CS-RRoastM | 36 |
| Smith-CI-Flat10 | 72 | | |
| Smith-CI-Dual6 | 72 | | |
| Smith-CI-DSkil11 | 64 | | |
| Smith-CI-Dutch4 | 60 | | |
| Smith-CI-Dutch7 | 60 | | |
| Smith-CI-Skil14 | 50 | | |
| Smith-CI-TradSkil14 | 50 | | |
| Smith-CI-Dutch5 | 50 | | |
| Smith-CI-Grill12 | 72 | | |

### Row Highlighting Logic

**Source**: `app/page.tsx:2836-2846`

```typescript
// Priority (first match wins):
const isNegative = product.total < 0;
const hasWarehouseNegative = product.hobson < 0 || product.selery < 0;
const safetyStock = SAFETY_STOCK[product.sku];
const isBelowSafetyStock = safetyStock && product.total < safetyStock;

const rowBg =
  (isNegative || hasWarehouseNegative) ? "bg-red-500/15"     // SOLID RED
  : isBelowSafetyStock                 ? "ss-violation"      // PULSING AMBER
  : idx % 2 === 1                      ? "bg-bg-tertiary/10" // Zebra stripe
  : "";
```

### Pulsing Animation

**Source**: `app/globals.css:181-197`

```css
.ss-violation {
  animation: ss-pulse 4s ease-in-out infinite;
}

@keyframes ss-pulse {
  0%, 100% { background-color: rgba(251, 191, 36, 0.06); }
  50% { background-color: rgba(251, 191, 36, 0.14); }
}
```

---

# 2. D2C / Fulfillment Tab

## Data Source

**API Endpoint**: `/api/metrics`
**Source File**: `app/api/metrics/route.ts`
**Data Tables**: `orders`, `line_items`, `shipments`, `tracking`

### Key Metrics Explained

#### Unfulfilled Count

```typescript
// Query: orders WHERE fulfillment_status IS NULL AND canceled = false
// Per warehouse (smithey, selery)
// MINUS restoration orders (SKUs containing "-Rest-")
```

**Restoration Exclusion**: Orders with `-Rest-` SKUs are excluded because they follow a different cycle (customer ships item back first).

#### Queue Health (Aging Buckets)

**Source**: `app/api/metrics/route.ts:559-576`

```typescript
for (const order of filteredAgingData) {
  const ageMs = now - new Date(order.created_at).getTime();

  if (ageMs > 1 * 24 * 60 * 60 * 1000) waiting1d++;
  if (ageMs > 3 * 24 * 60 * 60 * 1000) waiting3d++;
  if (ageMs > 7 * 24 * 60 * 60 * 1000) waiting7d++;
}
```

| Metric | Definition |
|--------|------------|
| waiting_1_day | Orders unfulfilled > 24 hours |
| waiting_3_days | Orders unfulfilled > 72 hours |
| waiting_7_days | Orders unfulfilled > 168 hours |

#### Fulfillment Lead Time

**Source**: `app/api/metrics/route.ts:431-440`

```typescript
// lead_time_hours = fulfilled_at - created_at
// Query orders with fulfilled_at in selected date range
```

#### Daily Fulfillments vs Daily Orders

```
Daily Fulfillments: COUNT(orders) WHERE fulfilled_at is on that date
Daily Orders: COUNT(orders) WHERE created_at is on that date
Backlog: Running total of (orders - fulfillments)
```

#### Stuck Shipments

**Source**: `app/api/metrics/route.ts:394-409`

```typescript
// Query shipments WHERE status = 'in_transit' AND days_without_scan >= 1
// Threshold for "stuck": 3+ days without tracking update
```

#### Engraving Queue

**Source**: `app/api/metrics/route.ts:442-457`

```typescript
// Query line_items WHERE sku IN ('Smith-Eng', 'Smith-Eng2')
// Filter: order not canceled AND order not fulfilled
// Count: sum of (quantity - fulfilled_quantity)
```

---

# 3. Assembly Tab

## Data Source

**API Endpoint**: `/api/assembly`
**Source File**: `app/api/assembly/route.ts`
**Sync Trigger**: Manual (Desktop command script)

### Data Flow

```
1. Double-click ~/Desktop/Update Assembly Tracking.command
   ↓
2. Opens NetSuite report in Chrome, auto-clicks Export
   ↓
3. Downloads: ~/Downloads/AssembliedByDayandItemSearchResults*.xls
   ↓
4. Python script: ~/scripts/update_assembly_tracking.py
   - Parses NetSuite XML
   - Copies to clipboard
   - Opens Excel, pastes to Raw_Data sheet
   ↓
5. npm run sync-assembly (scripts/sync-assembly-tracking.ts)
   - Reads from OneDrive Excel
   - Upserts to Supabase tables
   ↓
6. npm run sync-holiday (runs automatically after assembly)
```

### Key Calculations

#### Yesterday's Production

**Source**: `app/api/assembly/route.ts:217-221`

```typescript
// Get most recent day BEFORE today (excludes today's partial data)
const sortedDaily = [...daily]
  .filter(d => d.date < todayEST)
  .sort((a, b) => b.date.localeCompare(a.date));
const yesterdayProduction = sortedDaily[0]?.daily_total || 0;
```

#### 7-Day Average

```typescript
const last7 = sortedDaily.slice(0, 7);
const dailyAverage7d = last7.length > 0
  ? Math.round(last7.reduce((sum, d) => sum + d.daily_total, 0) / last7.length)
  : 0;
```

#### Daily Target

```typescript
// Days remaining to manufacturing cutoff (config value)
const daysRemaining = Math.max(0, cutoffDate - todayDate);
const dailyTarget = daysRemaining > 0
  ? Math.ceil(totalDeficit / daysRemaining)
  : 0;
```

#### Total Deficit

```typescript
// Sum of positive deficits from assembly_targets table
const totalDeficit = targets.reduce((sum, t) => sum + Math.max(0, t.deficit), 0);
```

#### Progress Percentage

```typescript
const progressPct = totalRevisedPlan > 0
  ? (totalAssembled / totalRevisedPlan) * 100
  : 0;
```

### Database Tables

| Table | Purpose |
|-------|---------|
| assembly_daily | Daily production totals (date, daily_total, week_num, day_of_week) |
| assembly_targets | SKU-level targets (sku, demand, revised_plan, assembled_since_cutoff, deficit) |
| assembly_sku_daily | Daily production by SKU (date, sku, quantity) |
| assembly_config | Key-value pairs (manufacturing_cutoff, cutoff_start_date, etc.) |

---

# 4. Holiday Tab

## Data Source

**API Endpoint**: `/api/holiday`
**Source File**: `app/api/holiday/route.ts`
**Sync**: Daily at noon (Vercel cron) + after assembly sync

### Data Flow

```
Excel: Holiday 2025 Super Tracker.xlsx (OneDrive)
  ↓
scripts/sync-holiday-tracking.ts (npm run sync-holiday)
  ↓
Supabase: holiday_tracking table
```

### Table Structure

| Column | Description |
|--------|-------------|
| day_number | Day 1-92 of holiday season |
| date_2024, date_2025 | Actual dates for each year |
| orders_2024, orders_2025 | Daily order counts |
| sales_2024, sales_2025 | Daily revenue |
| cumulative_orders_* | Running total |
| cumulative_sales_* | Running total |
| daily_orders_delta | (2025 - 2024) / 2024 as decimal |
| cumulative_orders_delta | YoY growth as decimal |

### Summary Calculations

**Source**: `app/api/holiday/route.ts:76-103`

```typescript
// Get latest row with 2025 data
const latestRow = rowsWithData[rowsWithData.length - 1];

// Growth is stored as decimal, multiply by 100 for percentage
ordersGrowth: latestRow.cumulative_orders_delta * 100
revenueGrowth: latestRow.cumulative_sales_delta * 100

// AOV
avgOrderValue2025 = cumulative_sales_2025 / cumulative_orders_2025
```

---

# 5. Budget vs Actual Tab

## Data Source

**Uses**: `/api/inventory` (same as Inventory tab)
**Tables**: `budgets`, `line_items`, `orders`, `b2b_fulfilled`

### Budget Data

**Table**: `budgets`
```sql
sku    VARCHAR
year   INTEGER
month  INTEGER (1-12)
budget INTEGER (units)
```

### Actual Sold Calculation

**Source**: `app/api/inventory/route.ts:171-198`

```typescript
// D2C: line_items from non-canceled orders this month
const retailSales = sum(line_items.quantity WHERE order.created_at in month AND !canceled)

// B2B: b2b_fulfilled records this month
const b2bSales = sum(b2b_fulfilled.quantity WHERE fulfilled_at in month)

// Total
const monthSold = retailSales + b2bSales
```

### Pace Percentage

```typescript
const monthPct = monthBudget > 0
  ? Math.round((monthSold / monthBudget) * 100)
  : undefined;
```

### Green Pulse Animation

**Source**: `app/page.tsx` (Budget vs Actual section)

```typescript
// Pulse green if actual EXCEEDS budget before month end
const shouldPulse = sku.actual > sku.budget;
```

---

# 6. Sales (Wholesale) Tab

## Data Source

**API Endpoint**: `/api/wholesale`
**Source File**: `app/api/wholesale/route.ts`
**Sync**: Manual (Python script)

### Data Flow

```
python3 scripts/sync-netsuite-wholesale.py
  ↓
NetSuite REST API (OAuth 1.0)
  ↓
Supabase tables:
  - ns_wholesale_customers (~1,018 records)
  - ns_wholesale_transactions (~7,282 records)
  - ns_wholesale_line_items (~333,195 records)
```

### Customer Health Status Definitions

**Source**: `app/api/wholesale/route.ts:42-58`

```typescript
function getHealthStatus(
  daysSinceLastOrder: number | null,
  orderCount: number,
  revenueTrend: number
): CustomerHealthStatus {
  // Never placed an order - sales opportunity
  if (orderCount === 0) return "never_ordered";
  // Has orders but no last_sale_date is a data issue, treat as new
  if (daysSinceLastOrder === null) return "new";
  if (orderCount === 1) return "one_time";
  if (daysSinceLastOrder > 365) return "churned";
  if (daysSinceLastOrder > 180) return "churning";
  if (daysSinceLastOrder > 120) return "at_risk";
  if (revenueTrend < -0.2) return "declining";
  if (revenueTrend > 0.1) return "thriving";
  return "stable";
}
```

### Complete Health Status Thresholds

| Status | Criteria |
|--------|----------|
| **never_ordered** | orderCount = 0 |
| **new** | daysSinceLastOrder = null |
| **one_time** | orderCount = 1 |
| **churned** | daysSinceLastOrder > 365 |
| **churning** | daysSinceLastOrder > 180 |
| **at_risk** | daysSinceLastOrder > 120 |
| **declining** | revenueTrend < -0.2 |
| **thriving** | revenueTrend > 0.1 |
| **stable** | default (none of above) |

### Active vs Non-Active Customer Definition

**Active Customer**: Placed an order within the selected period (MTD, YTD, etc.)
- Calculated as: `new Set(transactionsInPeriod.map(t => t.ns_customer_id)).size`

**Total Customers**: All customers in database regardless of order history
- Calculated as: `customers.length`

### Customer Segment Definitions

**Source**: `app/api/wholesale/route.ts:32-39`

```typescript
function getCustomerSegment(totalRevenue: number): CustomerSegment {
  if (totalRevenue >= 50000) return "major";
  if (totalRevenue >= 20000) return "large";
  if (totalRevenue >= 10000) return "mid";
  if (totalRevenue >= 5000) return "small";
  if (totalRevenue >= 2000) return "starter";
  return "minimal";
}
```

| Segment | Lifetime Revenue Threshold |
|---------|---------------------------|
| **major** | $50,000+ |
| **large** | $20,000 - $49,999 |
| **mid** | $10,000 - $19,999 |
| **small** | $5,000 - $9,999 |
| **starter** | $2,000 - $4,999 |
| **minimal** | < $2,000 |

### Risk Score Calculation

**Source**: `app/api/wholesale/route.ts:296`

```typescript
risk_score = Math.min(100, Math.round(days_since_last_order / 3.65))

// Examples:
// 0 days → 0 risk
// 100 days → 27 risk
// 180 days → 49 risk
// 365 days → 100 risk (capped)
```

### Risk Score Components (Full)

**Source**: `app/api/wholesale/route.ts:469-497`

```typescript
function calculateRiskScore(customer: WholesaleCustomer): number {
  let score = 0;

  // Days since last order (max 40 points)
  if (customer.days_since_last_order !== null) {
    if (customer.days_since_last_order > 365) score += 40;
    else if (customer.days_since_last_order > 180) score += 30;
    else if (customer.days_since_last_order > 120) score += 20;
    else if (customer.days_since_last_order > 90) score += 10;
  }

  // Revenue trend (max 30 points)
  if (customer.revenue_trend < -0.5) score += 30;
  else if (customer.revenue_trend < -0.3) score += 20;
  else if (customer.revenue_trend < -0.1) score += 10;

  // Order trend (max 20 points)
  if (customer.order_trend < -0.5) score += 20;
  else if (customer.order_trend < -0.3) score += 15;
  else if (customer.order_trend < -0.1) score += 10;

  // Value at risk based on segment (max 10 points)
  if (customer.segment === "major") score += 10;
  else if (customer.segment === "large") score += 8;
  else if (customer.segment === "mid") score += 6;

  return Math.min(100, score);
}
```

### Recommended Actions

**Source**: `app/api/wholesale/route.ts:500-514`

| Condition | Recommended Action |
|-----------|-------------------|
| days_since_last_order > 365 | "Win-back campaign - offer special pricing" |
| days_since_last_order > 180 | "Direct outreach from sales rep" |
| revenue_trend < -0.3 | "Review account - check for competitor activity" |
| order_trend < -0.3 | "Schedule check-in call to understand needs" |
| Default | "Monitor closely for next order" |

### Excluded Customers

**Source**: `app/api/wholesale/route.ts:26-29`

```typescript
const EXCLUDED_CUSTOMER_IDS = [
  2501, // "Smithey Shopify Customer" - D2C retail aggregate, not a real wholesale customer
];
```

---

# 7. Marketing (Klaviyo) Tab

## Data Source

**API Endpoint**: `/api/klaviyo`
**Source File**: `app/api/klaviyo/route.ts`
**Client**: `lib/klaviyo.ts`
**Sync Frequency**: Daily at 6am UTC (Vercel cron)

### Data Flow

```
Klaviyo API (REST)
  ↓
/api/cron/sync-klaviyo (daily cron)
  ↓
Supabase tables:
  - klaviyo_campaigns (campaign performance)
  - klaviyo_monthly_stats (monthly aggregates)
  - klaviyo_flows (flow performance)
  - klaviyo_scheduled_campaigns (upcoming sends)
```

### Key Metrics Explained

#### Total Email Revenue

```typescript
totalEmailRevenue = campaignRevenue + flowRevenue
```

- **Campaign Revenue**: Sum of `conversion_value` from campaigns in selected period
- **Flow Revenue**: Sum of `flow_revenue` from `klaviyo_monthly_stats` in selected period

#### Revenue Per Recipient (RPR)

**Source**: `app/api/klaviyo/route.ts:241`

```typescript
// Campaign RPR - THE most important email marketing metric
const campaignRPR = totalRecipients > 0 ? campaignRevenue / totalRecipients : 0;

// Benchmark: $0.10 is healthy
```

#### Open Rate & Click Rate

```typescript
// Average across all campaigns with metrics
const avgOpenRate = campaignsWithMetrics.reduce((sum, c) => sum + (c.open_rate || 0), 0)
  / campaignsWithMetrics.length;

const avgClickRate = campaignsWithMetrics.reduce((sum, c) => sum + (c.click_rate || 0), 0)
  / campaignsWithMetrics.length;
```

#### Placed Order Rate

**Source**: `app/api/klaviyo/route.ts:251`

```typescript
// Conversion rate per delivery
const placedOrderRate = totalDelivered > 0 ? campaignConversions / totalDelivered : 0;

// Benchmark: ≥0.10% is healthy
```

#### Unsubscribe Rate

**Source**: `app/api/klaviyo/route.ts:248`

```typescript
const unsubscribeRate = totalDelivered > 0 ? totalUnsubscribes / totalDelivered : 0;

// Benchmark: <0.5% is healthy
```

#### Email % of Revenue

```typescript
// Requires Shopify data from daily_stats table
const emailPctOfRevenue = shopifyRevenue > 0
  ? (totalEmailRevenue / shopifyRevenue) * 100
  : 0;
```

### List Health Score

**Source**: `app/api/klaviyo/route.ts:263-274`

```typescript
const calculateListHealthScore = (): number => {
  if (totalRecipients === 0) return 0;

  // Weight each factor (total = 100)
  const deliveryScore = deliveryRate * 30;                           // 30 points max
  const bounceScore = (1 - Math.min(bounceRate * 10, 1)) * 20;       // 20 points max
  const unsubScore = (1 - Math.min(unsubscribeRate * 100, 1)) * 20;  // 20 points max
  const engagementScore = Math.min(avgOpenRate * 100, 30);           // 30 points max

  return Math.round(deliveryScore + bounceScore + unsubScore + engagementScore);
};
```

| Health Score | Rating | Meaning |
|-------------|--------|---------|
| 80-100 | Excellent | All metrics healthy |
| 60-79 | Good | Minor issues |
| 40-59 | Fair | Needs attention |
| 0-39 | Needs Attention | Multiple issues |

### Deliverability Metrics

| Metric | Formula | Healthy Threshold |
|--------|---------|-------------------|
| Delivery Rate | delivered / recipients | ≥95% |
| Bounce Rate | bounces / recipients | ≤2% |
| Revenue Per Email | totalEmailRevenue / totalRecipients | Higher is better |

### Subscriber Segment Definitions

**Source**: `lib/klaviyo.ts:17-21`

```typescript
export const KLAVIYO_SEGMENTS = {
  ACTIVE_120_DAY: "RPnZc9", // M6_120DayActive+ New
  ENGAGED_365: "SBuWZx",    // 365ENG
} as const;
```

| Segment | Klaviyo ID | Definition |
|---------|-----------|------------|
| 120-Day Active | RPnZc9 | Opened/clicked email in last 120 days |
| 365-Day Engaged | SBuWZx | Opened/clicked email in last 365 days |

### Flow Categories

**Source**: `app/api/klaviyo/route.ts:348-386`

```typescript
// Flows are categorized by name/trigger matching
const categoryRules = {
  welcome: nameLower.includes("welcome") || triggerLower.includes("subscribed"),
  abandoned_cart: nameLower.includes("abandoned cart") || triggerLower.includes("added to cart"),
  abandoned_checkout: nameLower.includes("checkout") || triggerLower.includes("started checkout"),
  browse_abandonment: nameLower.includes("browse") || triggerLower.includes("viewed product"),
  post_purchase: nameLower.includes("post purchase") || nameLower.includes("thank you") || triggerLower.includes("placed order"),
  winback: nameLower.includes("winback") || nameLower.includes("win back") || nameLower.includes("re-engage"),
  other: // Default for unmatched flows
};
```

### Send Time Analysis

**Source**: `app/api/klaviyo/route.ts:277-344`

Aggregates campaign performance by:
- **Hour of day** (0-23): Average open rate, click rate, total revenue
- **Day of week** (Sun-Sat): Average open rate, click rate, total revenue

Returns:
- `bestHour`: Hour with highest average open rate
- `bestDay`: Day with highest average open rate

### Klaviyo API Details

**Source**: `lib/klaviyo.ts`

```typescript
const KLAVIYO_API_BASE = "https://a.klaviyo.com/api";
const KLAVIYO_REVISION = "2024-10-15"; // Stable revision
const PLACED_ORDER_METRIC_ID = "TQuQA4"; // Smithey's Placed Order metric
```

**Reports Endpoint** (`/campaign-values-reports/`):
```typescript
statistics: [
  "opens",
  "open_rate",
  "clicks",
  "click_rate",
  "bounced",
  "delivered",
  "recipients",
  "conversions",
  "conversion_value",
  "unsubscribes",
]
```

---

# 8. Cron Jobs & Sync Schedule

## Vercel Automated Crons

**Source**: `vercel.json`

| Schedule | Endpoint | Description |
|----------|----------|-------------|
| `*/5 * * * *` | /api/cron/sync-reamaze | Support tickets (every 5 min) |
| `*/15 * * * *` | /api/cron/sync-inventory | ShipHero inventory |
| `*/15 * * * *` | /api/cron/sync-b2b | B2B fulfillments |
| `0 * * * *` | /api/tracking/check | Shipment tracking (hourly) |
| `30 5 * * *` | /api/cron/sync-shopify-stats | Daily Shopify stats (5:30am UTC) |
| `0 6 * * *` | /api/cron/sync-klaviyo | Email metrics (6am UTC) |
| `0 12 * * *` | /api/cron/sync-holiday | Holiday data (noon UTC) |

## Manual Scripts

| Task | Command | Trigger |
|------|---------|---------|
| Assembly + Holiday | Double-click `~/Desktop/Update Assembly Tracking.command` | Daily manual |
| NetSuite Wholesale | `python3 scripts/sync-netsuite-wholesale.py` | As needed |

---

# 9. File Paths Reference

## Local Machine (Trevor's)

| Purpose | Path |
|---------|------|
| Assembly trigger | `~/Desktop/Update Assembly Tracking.command` |
| Assembly Python | `~/scripts/update_assembly_tracking.py` |
| NS export archive | `~/scripts/ns_exports_archive/` |
| Assembly Excel | `~/Library/CloudStorage/OneDrive-SharedLibraries-SmitheyIronwareCompany,LLC/Smithey Ironware Team Site - Documents/Reporting/Looker Dashboards/Cookware Assembly Tracking.xlsx` |
| Holiday Excel | `~/Library/CloudStorage/OneDrive-SharedLibraries-SmitheyIronwareCompany,LLC/Smithey Ironware Team Site - Documents/Reporting/Looker Dashboards/Holiday 2025 Super Tracker.xlsx` |

## Repository

| Purpose | Path |
|---------|------|
| ShipHero client + safety stock | `lib/shiphero.ts` |
| DOI calculator | `lib/doi.ts` |
| Inventory API | `app/api/inventory/route.ts` |
| Inventory sync (cron) | `app/api/cron/sync-inventory/route.ts` |
| Metrics API (D2C/Fulfillment) | `app/api/metrics/route.ts` |
| Assembly API | `app/api/assembly/route.ts` |
| Holiday API | `app/api/holiday/route.ts` |
| Wholesale API | `app/api/wholesale/route.ts` |
| Klaviyo API | `app/api/klaviyo/route.ts` |
| Klaviyo client | `lib/klaviyo.ts` |
| Klaviyo dashboard component | `components/KlaviyoDashboard.tsx` |
| Assembly sync script | `scripts/sync-assembly-tracking.ts` |
| Holiday sync script | `scripts/sync-holiday-tracking.ts` |
| Wholesale sync script | `scripts/sync-netsuite-wholesale.py` |

---

# 10. SWOT Analysis

> **Note**: This section contains my analysis/opinions based on reviewing the codebase. Not factual documentation.

## Inventory Tab

**Strengths**
- Uses `available - backorder` calculation (`lib/shiphero.ts:216-223`) - shows net sellable, not just physical count
- DOI pulls from `budgets` database table - forward-looking projection
- EST timezone handling in date calculations (`lib/doi.ts:136-146`)

**Weaknesses**
- Safety stock hardcoded in `lib/shiphero.ts:333-362` - code deploy required to change

**Opportunities**
- Safety stock could move to database table for easier updates

**Threats**
- ShipHero API rate limits could affect sync during peak periods

## D2C / Fulfillment Tab

**Strengths**
- Restoration orders filtered out of D2C metrics (SKUs with `-Rest-`)
- Multiple aging buckets (1d, 3d, 7d) for queue health visibility

**Weaknesses**
- Tracking data relies on hourly cron, not real-time webhooks

## Assembly Tab

**Strengths**
- Daily production tracking by SKU
- Progress percentage against revised plan

**Weaknesses**
- Requires manual script execution (`~/Desktop/Update Assembly Tracking.command`)
- Data flows through Excel files on OneDrive

**Opportunities**
- Could be automated via scheduled script or direct NetSuite API

**Threats**
- OneDrive sync delays could result in stale data
- Excel file corruption would break pipeline

## Holiday Tab

**Strengths**
- Day-by-day YoY comparison

**Weaknesses**
- Depends on Excel file on OneDrive

## Budget vs Actual Tab

**Strengths**
- Combines D2C (line_items) and B2B (b2b_fulfilled) for total picture

**Weaknesses**
- Budget data entered manually

**Opportunities**
- Budget data could support CSV import

## Sales (Wholesale) Tab

**Strengths**
- Multi-factor customer health scoring (days since order, revenue trend, order trend)
- Recommended actions generated from code (`app/api/wholesale/route.ts:499-514`)

**Weaknesses**
- Requires manual Python script execution to sync

## Marketing (Klaviyo) Tab

**Strengths**
- List health score combines delivery, bounce, unsub, and engagement metrics
- Send time analysis by hour and day of week

**Weaknesses**
- Daily sync only (6am UTC)

---

*Last Updated: December 2025*
