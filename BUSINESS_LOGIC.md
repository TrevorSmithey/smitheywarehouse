# Business Logic

Domain rules for Smithey Ironware operations. Reference this when working on specific features.

---

## Account Hierarchy

### Account > Doors Relationship

In B2B/wholesale context, we track two related concepts:

- **Account**: The billing entity / business relationship
- **Door**: A physical retail location that receives shipments

**Most B2B relationships are 1:1:**
- "Trevor's General Store" = 1 account, 1 door
- The account and door are effectively the same entity

**Some accounts have multiple doors:**
- "Williams Sonoma" (account) → 47 retail locations (doors)
- Segment is assigned at **account level**, revenue aggregates across all doors

### Data Model

| Field | Table | Description |
|-------|-------|-------------|
| `ns_customer_id` | `ns_wholesale_customers` | Primary account identifier |
| `parent_id` | `ns_wholesale_customers` | Child doors reference parent account |
| `segment` | `ns_wholesale_customers` | Assigned at account level |

**Note**: Door Health dashboard operates at the door level (treating each location as separate tracking entity), while Wholesale dashboard operates at the account level (aggregating all doors).

---

## Customer Health (B2B / Wholesale)

### Health Status Thresholds

Based on days since last order. Computed by `compute_customer_metrics()` RPC.

| Status | Days Since Last Order | Description |
|--------|----------------------|-------------|
| `thriving` | < 90 | Growing revenue, frequent orders |
| `stable` | 90-179 | Consistent ordering pattern |
| `declining` | < 180 with YoY drop > 20% | Decreasing order frequency/value |
| `at_risk` | 180-269 | Significant decline, needs attention |
| `churning` | 270-364 | No orders in 9+ months |
| `churned` | 365+ | Gone - no orders in 1+ year |

**Source**: `app/api/door-health/route.ts:64-69`

```typescript
const THRESHOLDS = {
  AT_RISK: 180,    // >= 180 days
  CHURNING: 270,   // >= 270 days
  CHURNED: 365,    // >= 365 days
  DECLINING_YOY_PCT: -20, // YoY revenue drop >20% = Declining
};
```

### Active Doors (Universal Metric)

**Added 2026-01-16**: Canonical definition for "Active Doors" across ALL Sales tabs.

**Definition**: B2B wholesale customers who are actively buying or recoverable (not yet churned).

**Formula**: `Active Doors = Healthy + At Risk + Churning` (excludes Churned)

**SQL Conditions** (ALL must be true):
```sql
is_inactive = false              -- Not marked inactive
is_corporate = false             -- B2B only, not corporate gifting
ns_customer_id NOT IN (2501)     -- Exclude D2C aggregates/test accounts
lifetime_orders > 0              -- Has placed at least one order
lifetime_revenue > 0             -- Has generated actual revenue
days_since_last_order < 365      -- Not churned (ordered within past year)
```

**Why this matters**: This is the number of real wholesale accounts you're actively working with. It's the denominator for churn rate, the basis for door driver forecasting, and the KPI for sales team performance.

**CRITICAL: Cross-Tab Consistency**
This metric MUST show the same number on:
- Door Health tab (hero metric: "432 total")
- Driver tab ("Active Doors" card)
- Wholesale tab (if displayed)
- Any future tabs using "active doors"

If these numbers don't match, it's a BUG.

**What it excludes**:
- Prospects (customers with 0 orders)
- Churned doors (365+ days since last order)
- Corporate customers (tracked separately)
- Inactive customers (marked in system)

**Source**: `app/api/door-health/route.ts:281-283`

```typescript
// The canonical calculation:
const activeDoors = funnel.active + funnel.atRisk + funnel.churning;
```

### Churn Rate (Rolling 12-Month)

**Added 2026-01-15**: Primary business health metric.

**Formula**: `(Currently Churned Doors ÷ Total Doors with Orders) × 100`

**Why "rolling"**: Unlike annual snapshots that have high variance, this metric updates daily as doors naturally cross in/out of the 365-day churned threshold. The "12-month" refers to the churn definition (365 days = ~12 months), not a lookback window.

**Example**:
- Total doors with orders: 500
- Currently churned (365+ days since last order): 180
- Churn rate: 180 / 500 × 100 = 36.0%

**Interpretation**: "36% of all doors who ever ordered have gone 365+ days without ordering."

**Source**: `app/api/door-health/route.ts`

### Reactivation Tracking

**Added 2026-01-15**: Tracks customers who were previously churned but came back.

**Definition**: A reactivated customer is one where:
- `was_churned = true` (they previously crossed the 365-day threshold)
- `days_since_last_order < 365` (they've since placed a new order)

**Key behavior**: The `was_churned` flag in `ns_wholesale_customers` is **set once and never reset**. Once a customer churns, they're always marked as "was churned" even if they come back. This enables tracking win-backs.

**Source**: `supabase/migrations/20260115_add_was_churned_flag.sql`, `app/api/door-health/route.ts`

### Customer Segments (Revenue Tiers)

Based on lifetime revenue. Must match database `compute_customer_metrics()` exactly.

**Updated 2026-01-15**: Simplified from 6-tier to 3-tier system for clearer sales prioritization.

| Segment | Lifetime Revenue | Description |
|---------|-----------------|-------------|
| `major` | >= $20,000 | Key accounts - highest priority |
| `mid` | >= $5,000 | Growth accounts - nurture to major |
| `small` | < $5,000 | Emerging accounts - volume opportunity |

**Source**: `app/api/door-health/route.ts:71-77`, `supabase/migrations/20260115_simplify_customer_segments.sql`

### Tier Upgrade Thresholds

Used in sales dashboard to flag customers approaching next tier (for proactive outreach).

| Current Segment | Upgrade Flag At | Target Tier |
|----------------|-----------------|-------------|
| `mid` | >= $15,000 (75% of $20K) | Major |
| `small` | >= $3,500 (70% of $5K) | Mid |

**Source**: `components/WholesaleDashboard.tsx:1461-1468`

### New Customer Nurturing

New customers (first order this year) with YTD revenue < $4,000 get flagged for proactive sales outreach.

**Rationale**: Customers spending < $4k in their first year often need onboarding support. Historical data shows customers > $4k first-year revenue have higher retention.

**Visual indicator**: Pulsing amber highlight (`ss-violation` class)

**Source**: `lib/constants.ts:182-193`

---

## Corporate Customer Detection

Corporate customers are **excluded from B2B metrics** because they have different buying patterns (typically one-time gifting purchases, not recurring wholesale).

### Single Source of Truth (Updated 2026-01-15)

**Database column**: `is_corporate` (BOOLEAN GENERATED, never NULL)

| Value | Meaning |
|-------|---------|
| `true` | Corporate gifting customer - **excluded** from B2B metrics |
| `false` | B2B wholesale customer - **included** in Door Health, sales dashboards |

**GENERATED from**: `COALESCE(is_corporate_gifting, false)`

**Philosophy**: The database is cleaner than NetSuite. NetSuite category is NOT used for corporate detection. All corporate flags are manually set via the customer detail modal. New customers default to B2B until manually flagged.

**Filter pattern**: `WHERE is_corporate = false` (explicit, no NULL handling needed)

```typescript
// CORRECT: Explicit equality check
const b2bCustomers = customers.filter(c => c.is_corporate === false);

// ALSO CORRECT: For API responses
const b2bCustomers = customers.filter(c => !c.is_corporate);

// DEPRECATED: DO NOT USE
// c.category === "Corporate" (NetSuite data is unreliable)
// c.category === "4" (NetSuite data is unreliable)
```

### Updating Corporate Status

To change a customer's corporate flag:
1. **Customer Detail Modal**: Toggle the "Corporate Gifting" switch
2. **API**: PATCH `/api/wholesale/customer/[id]` with `{ "is_corporate_gifting": true/false }`

The modal updates `is_corporate_gifting`, and `is_corporate` is GENERATED from it automatically.

### API Response Naming

For backward compatibility, API responses include `is_corporate_gifting`:
- `is_corporate_gifting` = `is_corporate` (GENERATED alias, same value)
- PATCH requests use `is_corporate_gifting` field
- Both columns exist in database; update `is_corporate_gifting`, read either

### Additional Detection Signals

Beyond the `is_corporate` flag, `lib/corporate-detection.ts` provides heuristic detection for **flagging candidates**:

**Primary Signal (95% accurate)**: `customer.taxable = true`
- In NetSuite, `taxable = true` means no resale certificate on file
- True wholesale customers are tax-exempt (they resell the goods)
- If buying at wholesale pricing but taxable → likely corporate gifting

**Secondary Signals**: Company name patterns
- Legal entity suffixes: Inc, LLC, Corp, Ltd, Co
- Professional services: Associates, Group, Partners, Enterprises
- Business types: Consulting, Solutions, Agency, Firm
- Real estate/construction: Realty, Properties, Development
- Financial: Capital, Financial, Wealth, Insurance

**Source**: `lib/corporate-detection.ts`

These heuristics suggest customers to review, but the final decision is always manual via `is_corporate_gifting`.

### Database History

The `is_corporate` column has gone through several iterations:
1. Originally derived from NetSuite category with UNION logic (2025-12-18)
2. UNION logic caused conflicts: manual flag `is_corporate_gifting=false` was overridden by NetSuite `category='4'`
3. Fixed 2026-01-15: Removed NetSuite from GENERATED expression, now ONLY uses manual flag

**The 2026-01-15 fix**:
- Snake River Farms ($252K revenue) was incorrectly marked corporate due to `category='4'`
- Manual flag said `is_corporate_gifting=false` (B2B), but UNION logic overrode it
- Now: `is_corporate = COALESCE(is_corporate_gifting, false)` - NetSuite ignored
- Result: 558 B2B customers ($12.9M), 195 corporate ($2.5M)

---

## Restoration (Customer Service Repairs)

### SLA Timeline

| Metric | Threshold | Description |
|--------|-----------|-------------|
| Clock starts | `delivered_to_warehouse_at` | When Smithey receives the item |
| Target | 21 days | Time to ship out |
| Overdue | > 21 days + physically at Smithey | Needs attention |

**Calculation**: A restoration is overdue if:
1. It has been > 21 days since `delivered_to_warehouse_at`
2. AND the item is still physically at Smithey (not shipped)

**Source**: `CLAUDE.md:410-414`, restoration components

### Dud Rate (One-Time Buyers)

Measures customers who only ordered once and never returned.

| Metric | Value | Description |
|--------|-------|-------------|
| Maturity Window | 133 days | 2× median reorder interval of 67 days |
| Minimum | After 133 days | Only count as "dud" after maturity window |

**Source**: `app/api/door-health/route.ts:35`

---

## SKU Patterns

### Product Categories

| Prefix | Category | Description |
|--------|----------|-------------|
| `SMITH-CI-` | Cast Iron | Traditional cast iron cookware |
| `SMITH-CS-` | Carbon Steel | Carbon steel cookware |
| `Smith-AC-` | Accessory | Care kits, potholders, accessories |
| `Smith-G-` | Glass Lid | Glass lids for cookware |

### Defect SKUs

Pattern: `{SKU}-D` (e.g., `SMITH-CI-12FLAT-D`)

Defect units are:
- Excluded from production planning
- Excluded from regular inventory counts
- Tracked separately for defect rate calculations
- Also called "Factory Seconds" or "Demo Units"

**Source**: `lib/shiphero.ts:222-225`, `app/api/assembly/route.ts:14`

### Service SKUs

Not physical products - excluded from inventory counts and draft order line items:
- `Gift-Note` - Gift messaging
- `Smith-Eng` - Engraving service

**Source**: `lib/constants.ts:73`

### SKU Reference Table (Canonical)

**SKU is the universal key.** All systems (Shopify, ShipHero, NetSuite, internal dashboards) link via SKU. This table defines the official SKU → Internal Name mapping from `nomenclature.xlsx`.

**IMPORTANT**: All SKU listings must use these internal names, grouped by product class in this order.

#### Cast Iron

| SKU | Internal Name | Sort Order |
|-----|---------------|------------|
| `Smith-CI-Skil8` | 8Chef | 1 |
| `Smith-CI-Chef10` | 10Chef | 2 |
| `Smith-CI-Flat10` | 10Flat | 3 |
| `Smith-CI-Flat12` | 12Flat | 4 |
| `Smith-CI-Skil6` | 6Trad | 5 |
| `Smith-CI-Skil10` | 10Trad | 6 |
| `Smith-CI-Skil12` | 12Trad | 7 |
| `Smith-CI-TradSkil14` | 14Trad | 8 |
| `Smith-CI-Skil14` | 14Dual | 9 |
| `Smith-CI-DSkil11` | 11Deep | 10 |
| `Smith-CI-Grill12` | 12Grill | 11 |
| `Smith-CI-Dutch4` | 3.5 Dutch | 12 |
| `Smith-CI-Dutch5` | 5.5 Dutch | 13 |
| `Smith-CI-Dutch7` | 7.25 Dutch | 14 |
| `Smith-CI-Dual6` | 6Dual | 15 |
| `Smith-CI-Griddle18` | Double Burner Griddle | 16 |
| `Smith-CI-Dual12` | 12Dual | 17 |
| `Smith-CI-Sauce1` | Sauce Pan | 18 |

#### Carbon Steel

| SKU | Internal Name | Sort Order |
|-----|---------------|------------|
| `Smith-CS-Farm12` | Farmhouse Skillet | 101 |
| `Smith-CS-Deep12` | Deep Farm | 102 |
| `Smith-CS-RRoastM` | Round Roaster | 103 |
| `Smith-CS-OvalM` | Oval Roaster | 104 |
| `Smith-CS-WokM` | Wok | 105 |
| `Smith-CS-Round17N` | Paella Pan | 106 |
| `Smith-CS-Farm9` | Little Farm | 107 |
| `Smith-CS-Fish` | Fish Skillet | 108 |

#### Accessories

| SKU | Internal Name | Sort Order |
|-----|---------------|------------|
| `Smith-AC-Scrub1` | Chainmail Scrubber | 201 |
| `Smith-AC-FGph` | Leather Potholder | 202 |
| `Smith-AC-Sleeve1` | Short Sleeve | 203 |
| `Smith-AC-Sleeve2` | Long Sleeve | 204 |
| `Smith-AC-SpatW1` | Slotted Spat | 205 |
| `Smith-AC-SpatB1` | Mighty Spat | 206 |
| `Smith-AC-PHTLg` | Suede Potholder | 207 |
| `Smith-AC-KeeperW` | Salt Keeper | 208 |
| `Smith-AC-Season` | Seasoning Oil | 209 |
| `Smith-AC-CareKit` | Care Kit | 210 |
| `Smith-Bottle1` | Bottle Opener | 211 |

#### Glass Lids

| SKU | Internal Name | Sort Order |
|-----|---------------|------------|
| `Smith-AC-Glid10` | 10Lid | 301 |
| `Smith-AC-Glid12` | 12Lid | 302 |
| `Smith-AC-Glid14` | 14Lid | 303 |
| `Smith-AC-CSLid12` | CS 12 Lid | 304 |

### SKU Display Rules

1. **Always use Internal Name** (not verbose descriptions like "12\" Traditional Skillet")
2. **Always group by Product Class**: Cast Iron → Carbon Steel → Accessories → Glass Lids
3. **Always sort within class** using the Sort Order from this table
4. **SKU is case-insensitive** for lookup but use canonical casing for display

**Implementation**:

```typescript
// Get display name from SKU
import { getDisplayName } from "@/lib/shiphero";
const name = getDisplayName("Smith-CI-Skil12"); // → "12Trad"

// Sort SKUs by canonical order
import { sortSkusByCanonicalOrder } from "@/lib/constants";
const sorted = skus.sort((a, b) => sortSkusByCanonicalOrder(a.sku, b.sku));
```

**Sources**:
- `lib/shiphero.ts:311-385` (SKU_DISPLAY_NAMES - canonical mapping from nomenclature.xlsx)
- `lib/constants.ts:259-305` (SKU_SORT_ORDER - canonical budget spreadsheet order)

---

## Revenue Metrics

### Time Windows

Always encode time window in variable names:

| Suffix | Meaning |
|--------|---------|
| `MTD` | Month-to-date |
| `QTD` | Quarter-to-date |
| `YTD` | Year-to-date |
| `30d` / `90d` | Rolling 30/90 days |
| `T12` / `12m` | Trailing 12 months |

**Example**: `revenue90d`, `revenueYtd`, `revenueT12` — never just `revenue`

### MER (Marketing Efficiency Ratio)

```
MER = Total Revenue / Total Ad Spend
```

Higher is better. Used in paid media dashboard.

### YoY Change Calculation

```typescript
const yoyChange = priorYearRevenue > 0
  ? ((currentYearRevenue - priorYearRevenue) / priorYearRevenue) * 100
  : null;
```

**Note**: Returns `null` if no prior year revenue (can't calculate percentage change from zero)

---

## Unit Budget System

The unit budget is **foundational infrastructure** that cascades through multiple downstream systems.

### Budget Channels

**CRITICAL**: `total` ≠ `retail` + `wholesale`

| Channel | Description | Used By |
|---------|-------------|---------|
| `retail` | D2C e-commerce sales forecast | Budget Dashboard (variance, pace) |
| `wholesale` | B2B sales forecast | Budget Dashboard (variance, pace) |
| `total` | **All units out the door** — includes marketing GWPs/giveaways | Production Planning, Inventory Dashboard, DOI |

The `total` channel is a separately tracked value because it includes units given away for marketing purposes (GWP = Gift With Purchase). These units are not "sold" but still leave inventory.

**Unit Budget = Expected SALES** for retail/wholesale, but **ALL units out the door** for total.

### What Unit Budget Drives

```
budgets table (sku, year, month, channel, budget)
    ↓
┌─────────────────────────────────────────────────────────────┐
│ DOWNSTREAM SYSTEMS                                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ 1. BUDGET DASHBOARD (/api/budget)                          │
│    • Uses retail + wholesale channels                       │
│    • Variance = actual - budget                             │
│    • Pace = (actual / expectedByNow) * 100                  │
│    • Category/cookware/grand totals                         │
│                                                             │
│ 2. PRODUCTION PLANNING (/api/production-planning)          │
│    • Uses channel='total' specifically                      │
│    • Feeds "yearSalesForecast" for inventory curves         │
│    • Gap = cumulativeProduction - cumulativeBudget          │
│    • Determines inventory risk/buffer                       │
│                                                             │
│ 3. INVENTORY DASHBOARD (/api/inventory)                    │
│    • Uses channel='total' for monthBudget                   │
│    • monthPct = (monthSold / monthBudget) * 100             │
│                                                             │
│ 4. DOI CALCULATOR (lib/doi.ts)                             │
│    • Uses weekly_weights table for seasonal demand          │
│    • Annual budget = sum of 12 monthly 'total' budgets      │
│    • Weekly demand = annual_budget × weekly_weight[week]    │
│    • Projects stockout date by consuming inventory forward  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Database Schema

```sql
budgets (
  sku TEXT,
  year INTEGER,
  month INTEGER (1-12),
  channel TEXT ('retail' | 'wholesale' | 'total'),
  budget INTEGER (unit quantity)
)
UNIQUE (sku, year, month, channel)
```

### Files That Query Budgets

| File | Line | Channel | What It Drives |
|------|------|---------|----------------|
| `app/api/budget/route.ts` | 689 | `retail`, `wholesale` | Budget Dashboard variance, pace, progress |
| `app/api/production-planning/route.ts` | 495 | `total` | Inventory curves, yearSalesForecast |
| `app/api/inventory/route.ts` | 76 | `total` | Current month budget (monthBudget) |
| `app/api/inventory/route.ts` | 84 | `total` | DOI (Days of Inventory) calculations |

### Budget Update Process (Happens 2-3x/Year)

#### Source File

```
OneDrive/Smithey Ironware Team Site - Documents/Reporting/Unit Sales Model/Unit Sales Plan (Active).xlsm
```

#### Excel Structure (Three Tabs)

| Tab Name | Channel | SKU Column | 2026 Data Columns | Data Start Row |
|----------|---------|------------|-------------------|----------------|
| **Web Projections** | retail | B | BF-BQ (cols 58-69) | Row 65 (after "RETAIL SALES" header) |
| **Whls Projections** | wholesale | B | Cols 56-67 | Row 45 |
| **Budget Out The Door** | total | B | AZ-BK (cols 52-63) | Row 7 |

**Note**: Column positions shift when new years are added. Always verify headers show correct year (e.g., "Jan-26").

#### Extraction Process (Claude Does This)

1. **Read Excel** using Python openpyxl (read-only mode, data_only=True for computed values)
2. **Extract** all three tabs into unified format: `sku, year, month, channel, budget`
3. **Deduplicate** — Excel may have same SKU in multiple sections (subtotals, etc.)
4. **Generate audit files** to `~/Downloads/`:
   - `2026_budget_audit_clean.csv` — Import format (sku, year, month, channel, budget)
   - `2026_budget_pivot_clean.csv` — Side-by-side view for verification

#### Audit Checklist

Before importing, verify:

| Check | Expected |
|-------|----------|
| Row count | SKUs × 12 months × 3 channels (e.g., 43 × 12 × 3 = 1,548) |
| No duplicates | Each (sku, month, channel) appears once |
| Total ≥ Retail + Wholesale | Small rounding diffs OK (1-3 units) |
| Zero-budget SKUs | New products or discontinued — confirm intentional |
| Incomplete months | New product launches mid-year — confirm intentional |
| No wholesale | D2C-only products — confirm intentional |

#### Import to Database

```sql
-- 1. Check current state
SELECT channel, COUNT(*), SUM(budget) FROM budgets WHERE year = 2026 GROUP BY channel;

-- 2. Delete existing year (clean slate avoids case-sensitivity issues)
DELETE FROM budgets WHERE year = 2026;

-- 3. Import new data (Claude uses Supabase MCP or Python script)
-- Uses UPPERCASE SKUs for consistency

-- 4. Verify import
SELECT channel, COUNT(*) as rows, SUM(budget) as units
FROM budgets WHERE year = 2026 GROUP BY channel;
```

#### Verification Queries

```sql
-- Check specific SKU
SELECT * FROM budgets WHERE UPPER(sku) = 'SMITH-CI-SKIL12' AND year = 2026 ORDER BY month, channel;

-- Compare channel totals
SELECT
  SUM(CASE WHEN channel = 'retail' THEN budget ELSE 0 END) as retail,
  SUM(CASE WHEN channel = 'wholesale' THEN budget ELSE 0 END) as wholesale,
  SUM(CASE WHEN channel = 'total' THEN budget ELSE 0 END) as total
FROM budgets WHERE year = 2026;
```

**Source**: `scripts/sync-channel-budgets.ts`, `scripts/check-budget-integrity.ts`

---

## B2B vs DTC Filtering

### Excluded from B2B Metrics

1. **Corporate customers** - Different buying patterns
2. **Customers with $0 orders** - Credits, adjustments
3. **Customers with 0 lifetime orders** - Never actually purchased
4. **Inactive customers** - `is_inactive = true`
5. **Excluded customer IDs** - Test accounts, D2C aggregates

### Hardcoded Exclusions

```typescript
const HARDCODED_EXCLUDED_IDS = [
  2501, // "Smithey Shopify Customer" - D2C retail aggregate
];
```

Plus any customers with `is_excluded = true` in database.

**Source**: `app/api/door-health/route.ts:39-41`

---

## Warehouse Configuration

### ShipHero Warehouse IDs

| Warehouse | Numeric ID | GraphQL ID |
|-----------|-----------|------------|
| Pipefitter | 120758 | `V2FyZWhvdXNlOjEyMDc1OA==` |
| Hobson | 77373 | `V2FyZWhvdXNlOjc3Mzcz` |
| Selery | 93742 | `V2FyZWhvdXNlOjkzNzQy` |

**Source**: `lib/constants.ts:13-28`

---

## Days of Inventory (DOI) Calculation

### Overview

DOI projects how many days until inventory runs out for a SKU, using **seasonal weekly weights** to model demand patterns. This is critical for inventory planning because demand is highly seasonal.

### Weekly Weights

The `weekly_weights` table stores 52 rows (one per week) with decimal weights that sum to 1.0. These weights represent the percentage of **annual demand** that occurs in each week, based on 3-year historical averages.

| Week | Season | Weight | % of Annual |
|------|--------|--------|-------------|
| 25 | Summer low | 0.0076 | 0.76% |
| 35 | Back-to-school | 0.0128 | 1.28% |
| 47 | BFCM lead-in | 0.0727 | 7.27% |
| 48 | Peak BFCM | 0.1015 | 10.15% |
| 49 | Cyber week | 0.0883 | 8.83% |
| 50 | Holiday shipping | 0.0963 | 9.63% |

**Critical insight**: Week 48 has **13× more demand** than Week 25. A flat monthly rate would completely miss this.

### Algorithm

```
1. annual_budget = SUM(budget) FROM budgets WHERE sku = :sku AND year = :year AND channel = 'total'
   (Sum of all 12 monthly budgets for the SKU)

2. Start from current week (EST timezone)

3. For each week until inventory depleted:
   weekly_demand = annual_budget × weekly_weights[week]
   daily_demand = weekly_demand / 7

   - If inventory covers the week: consume and continue
   - If inventory runs out mid-week: calculate partial days

4. Return total days until stockout
```

### Database Schema

```sql
weekly_weights (
  week INTEGER PRIMARY KEY,  -- 1-52
  weight NUMERIC(18,16) NOT NULL,  -- decimal weight
  updated_at TIMESTAMPTZ DEFAULT NOW()
)
-- Constraint: SUM(weight) ≈ 1.0
```

### Files

| File | Purpose |
|------|---------|
| `weekly_weights` table | Stores 52 seasonal weights |
| `lib/doi.ts` | `calculateDOI()` function using weekly weights |
| `app/api/inventory/route.ts` | Fetches weights, computes annual budget, calls calculateDOI |

### Why This Design?

**Monthly budgets stay as-is** — They're the source of truth for budget tracking, variance, and pace.

**Weekly weights are separate** — They model the *shape* of demand within a year, not the total volume.

**Annual budget × weight = weekly demand** — This converts a flat annual number into a seasonal curve.

**Source**: `lib/doi.ts`, `supabase/migrations/20260115_create_weekly_weights.sql`

---

## Lifespan Buckets

Customer lifespan categorization (for churn analysis):

| Bucket | Months |
|--------|--------|
| `<1yr` | 0-11 months |
| `1-2yr` | 12-23 months |
| `2-3yr` | 24-35 months |
| `3+yr` | 36+ months |

**Source**: `app/api/door-health/route.ts:84-89`

---

## Sync Frequencies

| Data Source | Frequency | Cron Job |
|-------------|-----------|----------|
| Shopify Orders | Every 15 min | `high-frequency-sync` |
| ShipHero Inventory | Every 15 min | `high-frequency-sync` |
| B2B Transactions | Every 15 min | `sync-b2b` |
| B2B Drafts | Hourly | `sync-b2b-drafts` |
| NetSuite (full) | Daily 6am EST | `sync-netsuite-*` |
| NetSuite Assembly | Every 2 hours | `sync-netsuite-assembly` |
| Meta Ads | Daily | `sync-meta` |
| Google Ads | Daily | `sync-google-ads` |
| Klaviyo | Daily | `sync-klaviyo` |

---

## Wholesale Forecasting (B2B + Corporate)

### Overview

Wholesale revenue comes from two distinct channels with different economics:

| Channel | Description | Buying Pattern | % of Wholesale |
|---------|-------------|----------------|----------------|
| **B2B** | Wholesale retailers (stores that resell) | Recurring, seasonal | ~85% |
| **Corporate** | Corporate gifting (companies buying for employees/clients) | One-time/annual, highly seasonal | ~15% |

**Critical insight**: These channels have different SKU mixes, different seasonality, and different unit economics. You cannot use a single blended mix for accurate unit projections.

### B2B SKU Mix (lib/forecasting.ts)

Based on Full Year 2025 B2B transaction data ($5.93M revenue).

**Top 5 by Revenue**:
| SKU | Revenue % | AUP |
|-----|-----------|-----|
| SMITH-CI-SKIL12 (12Trad) | 11.7% | $123 |
| SMITH-CI-SKIL10 (10Trad) | 6.3% | $98 |
| SMITH-CI-SKIL14 (14Dual) | 4.8% | $137 |
| SMITH-CI-GRIDDLE18 | 4.0% | $173 |
| SMITH-CI-DSKIL11 (11Deep) | 4.0% | $125 |

**Blended B2B AUP**: ~$120 (weighted average across all SKUs)

**Source**: `lib/forecasting.ts:85-127` (DEFAULT_SKU_MIX)

### Corporate SKU Mix & Engraving (Added 2026-01-16)

Based on 2024-Present corporate transaction data ($1.95M revenue, 114K physical units).

**The Engraving Factor**:

Corporate customers frequently order **engraved** products for gifting. Engraving (SMITH-ENG) is a **service**, not a physical product, but it appears as a line item in transactions.

| Metric | Value | Notes |
|--------|-------|-------|
| **Engraving % of Corp Revenue** | 15.4% | $301K of $1.95M |
| **Engraving Attach Rate** | 14.4% | 14.4% of physical units get engraved |
| **Engraving AUP** | $18.31 | Average engraving price |
| **Physical Product AUP** | $14.44 | Excluding engraving |

**Why This Matters for Unit Projections**:

If you use a blended AUP that includes engraving as "units", you'll overcount physical products:

```
WRONG (blended):
  $1M corporate revenue ÷ $14.93 blended AUP = 66,976 "units"
  ❌ Includes 8,400+ engraving "units" that aren't physical products

CORRECT (separated):
  $1M × 84.6% physical share = $846K physical revenue
  $846K ÷ $14.44 physical AUP = 58,543 physical units (what production builds)
  58,543 × 14.4% attach rate = 8,433 engravings (engraving capacity needed)
```

**Corporate Physical SKU Mix (Top 5)**:

| SKU | Revenue % | AUP | Notes |
|-----|-----------|-----|-------|
| SMITH-CI-SKIL12 | 22.0% | $66 | Lower AUP = corporate discount |
| SMITH-CI-SKIL10 | 16.2% | $41 | Lower AUP = corporate discount |
| SMITH-CI-CHEF10 | 6.7% | $52 | |
| SMITH-CI-DUTCH7 | 5.6% | $88 | |
| SMITH-CI-DUAL12 | 4.4% | $121 | |

**Note**: Corporate AUPs are lower than B2B because corporate orders receive volume discounts.

### Forecasting Constants (lib/forecasting.ts)

```typescript
// B2B Seasonality (3-year average 2023-2025)
export const B2B_SEASONALITY = {
  q1: 0.20,  // 20%
  q2: 0.21,  // 21%
  q3: 0.22,  // 22%
  q4: 0.37,  // 37% - holiday push
};

// Corporate Seasonality (highly variable, std dev 10-12%)
export const CORP_SEASONALITY = {
  q1: 0.20,  // 20%
  q2: 0.06,  // 6% - summer lull
  q3: 0.16,  // 16%
  q4: 0.58,  // 58% - holiday gifting
};

// Engraving Economics (corporate-specific)
export const CORPORATE_ENGRAVING = {
  attachRate: 0.144,        // 14.4% of physical units get engraved
  averagePrice: 18.31,      // $ per engraving
  revenueShare: 0.154,      // Engraving is 15.4% of corporate revenue
};
```

### Unit Projection Methodology

**For B2B Revenue Targets**:
```
1. Apply B2B seasonality to get quarterly targets
2. Use DEFAULT_SKU_MIX revenue shares × quarterly revenue = SKU revenue
3. SKU units = SKU revenue ÷ SKU avg_unit_price
4. Sum all SKU units = total B2B units
```

**For Corporate Revenue Targets**:
```
1. Apply CORP_SEASONALITY to get quarterly targets
2. Separate physical (84.6%) from engraving (15.4%) revenue
3. Physical units = physical revenue ÷ physical AUP ($14.44)
4. Engraving units = physical units × attach rate (14.4%)
5. Total corporate units = physical units (for production)
   + engraving capacity = engraving units (for engraving team)
```

### Door Driver Economics (B2B Only)

| Metric | Value | Source |
|--------|-------|--------|
| **Retention Rate** | 83% | 2023-2024 cohort analysis |
| **Annual Churn** | 17% | 1 - retention |
| **Organic Growth** | 11% | Same-store revenue growth from retained doors |
| **New Door First Year Yield** | $6,000 | 2024 average (conservative) |
| **Returning Door Avg Yield** | $11,500 | Historical estimate |

**Door-Based Revenue Projection**:
```
Retained doors = Starting doors × (1 - churn rate)
Existing book revenue = Retained doors × returning_yield × (1 + organic_growth)
New door revenue = New doors × new_door_yield × 0.5 (partial year factor)
Total implied revenue = Existing book + New door revenue
```

**Source**: `lib/forecasting.ts:253-303` (computeDoorScenario)

### Customer Concentration (Corporate)

Corporate revenue is more concentrated than B2B:

| Rank | Customer | % of Corporate Revenue |
|------|----------|------------------------|
| 1 | Ruhlin Group | 15.7% |
| 2 | Initiative Abu Dhabi | 6.5% |
| 3 | Choate Construction | 3.6% |
| Top 10 | Combined | ~42% |

**Implication**: Corporate forecasts have higher variance due to customer concentration. A single large order can swing quarterly results significantly.

### Data Sources

| Metric | Table | Query Pattern |
|--------|-------|---------------|
| B2B Actuals | `ns_wholesale_transactions` | `is_corporate = false` |
| Corporate Actuals | `ns_wholesale_transactions` | `is_corporate = true` |
| SKU Line Items | `ns_wholesale_line_items` | Join on `ns_transaction_id` |
| Current Door Count | `ns_wholesale_customers` | `is_corporate = false AND is_inactive = false AND lifetime_orders > 0` |

### Validation (Run Quarterly)

1. **SKU Mix Drift**: Compare current quarter SKU revenue % to stored mix. Flag >5% deviation.
2. **Engraving Attach Rate**: Recalculate from trailing 12 months. Flag >2% deviation.
3. **Seasonality Check**: Compare actual quarterly distribution to constants. Flag >10% deviation.
4. **Door Economics**: Validate retention rate and yields against actuals.

**Scripts**:
- `scripts/corporate-sku-mix.mjs` - Regenerate corporate SKU analysis
- `scripts/check-corp-mix.mjs` - Quick data completeness check

---

## Query Limits

All centralized in `lib/constants.ts`. When adding new queries, add limit constants there.

Key limits (increased for Q4 2024 peak season):

| Query | Limit | Rationale |
|-------|-------|-----------|
| Daily Fulfillments | 150,000 | ~75 days at 2000/day peak |
| Lead Time | 150,000 | Peak season 2000/day for 75 days |
| Wholesale Customers | 2,000 | ~749 customers with transactions, 3× buffer |
| Wholesale Transactions YTD | 10,000 | ~3,298 YTD 2025, 3× buffer |

**CRITICAL**: Supabase defaults to 1000 rows. Without explicit limits, data is silently truncated.

**Source**: `lib/constants.ts:97-144`
