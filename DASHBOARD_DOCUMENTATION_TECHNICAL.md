# Smithey Warehouse Dashboard - Technical Documentation

> For Trevor. Complete technical reference with all data flows, definitions, scripts, and file paths.

---

## Table of Contents
1. [Dashboard Tab Overview](#dashboard-tab-overview)
2. [Data Sources & Sync Mechanisms](#data-sources--sync-mechanisms)
3. [Complete Definitions Reference](#complete-definitions-reference)
4. [Visual Indicators & Row Highlighting](#visual-indicators--row-highlighting)
5. [File Paths & Scripts](#file-paths--scripts)
6. [Cron Schedule Reference](#cron-schedule-reference)
7. [Database Tables](#database-tables)
8. [SWOT Analysis](#swot-analysis)

---

## Dashboard Tab Overview

### 1. Inventory Tab
**Purpose**: Real-time inventory levels across all warehouses with DOI projections

**Data Source**: ShipHero API → Supabase `inventory` table
**Sync Frequency**: Every 15 minutes (Vercel cron)
**API Endpoint**: `/api/inventory`

**Key Metrics**:
- Warehouse levels (Hobson, Selery, Pipefitter)
- Total inventory per SKU
- DOI (Days of Inventory)
- Sales Velocity
- Safety Stock status

---

### 2. D2C / Fulfillment Tab
**Purpose**: Direct-to-consumer fulfillment operations, queue health, and shipping analytics

**Data Source**: Shopify API → Supabase `orders`, `line_items`, `tracking`
**Sync Frequency**: Real-time webhooks + hourly tracking checks
**API Endpoint**: `/api/metrics`

**Key Metrics**:
- Daily fulfillments vs orders
- Fulfillment backlog
- Queue health (pending orders aging)
- Lead times (order → ship → deliver)
- Transit time by state (map visualization)
- Stuck shipments (>7 days in transit)
- Engraving queue

---

### 3. Assembly Tab
**Purpose**: Manufacturing/assembly production tracking against targets

**Data Source**: NetSuite → Excel (OneDrive) → Supabase
**Sync Frequency**: Manual (Desktop command script)
**API Endpoint**: `/api/assembly`

**Key Metrics**:
- Daily production totals
- SKU-level assembly counts
- Progress against revised manufacturing targets
- Deficit tracking (remaining units to produce)

---

### 4. Holiday Tab
**Purpose**: Year-over-year holiday season comparison (2024 vs 2025)

**Data Source**: Excel (OneDrive) → Supabase `holiday_tracking`
**Sync Frequency**: Daily at noon + triggered after assembly sync
**API Endpoint**: `/api/holiday`

**Key Metrics**:
- Daily orders/revenue comparison
- Cumulative orders/revenue
- YoY growth percentages
- Day-by-day trend visualization

---

### 5. Budget vs Actual Tab
**Purpose**: Track actual sales against monthly budgets by SKU

**Data Source**: Supabase `budgets` + `line_items` + `b2b_fulfilled`
**Sync Frequency**: Real-time (uses existing order data)
**API Endpoint**: `/api/budgets`

**Key Metrics**:
- Monthly budget per SKU
- Actual units sold (MTD)
- Pace percentage (actual/budget × 100)
- Green pulse = exceeding budget before month end

---

### 6. Sales (Wholesale) Tab
**Purpose**: B2B/Wholesale customer health, retention, and revenue tracking

**Data Source**: NetSuite → Supabase via Python script
**Sync Frequency**: Manual (Python script)
**API Endpoint**: `/api/wholesale`

**Key Metrics**:
- Customer health distribution
- Monthly wholesale revenue
- Customer retention funnel
- At-risk customer identification

---

## Data Sources & Sync Mechanisms

### Automated Cron Jobs (Vercel)
| Endpoint | Schedule | Source | Target Table |
|----------|----------|--------|--------------|
| `/api/cron/sync-inventory` | `*/15 * * * *` (every 15min) | ShipHero API | `inventory`, `inventory_history` |
| `/api/cron/sync-b2b` | `*/15 * * * *` (every 15min) | Shopify B2B | `b2b_fulfilled` |
| `/api/cron/sync-reamaze` | `*/5 * * * *` (every 5min) | Reamaze API | `support_tickets` |
| `/api/cron/sync-holiday` | `0 12 * * *` (noon daily) | Excel (OneDrive) | `holiday_tracking` |
| `/api/cron/sync-klaviyo` | `0 6 * * *` (6am daily) | Klaviyo API | `klaviyo_stats` |
| `/api/cron/sync-shopify-stats` | `30 5 * * *` (5:30am daily) | Shopify API | `shopify_daily_stats` |
| `/api/tracking/check` | `0 * * * *` (hourly) | EasyPost API | `tracking` |

### Manual Sync Scripts

#### Assembly Tracking (Daily)
**Trigger**: Double-click `~/Desktop/Update Assembly Tracking.command`

**Flow**:
1. Script opens NetSuite report in Chrome with today's date
2. Auto-clicks "Export Excel" button
3. Downloads XML file to `~/Downloads/AssembliedByDayandItemSearchResults*.xls`
4. Python script (`~/scripts/update_assembly_tracking.py`) parses XML
5. Data copied to clipboard
6. Opens Excel (`Cookware Assembly Tracking.xlsx` on OneDrive)
7. Auto-pastes to Raw_Data sheet
8. Runs `npm run sync-assembly` → uploads to Supabase
9. Runs `npm run sync-holiday` → updates holiday data too

#### NetSuite Wholesale (Manual)
**Script**: `python3 scripts/sync-netsuite-wholesale.py`

**Flow**:
1. Connects to NetSuite REST API (OAuth 1.0)
2. Fetches all wholesale customers (~1,018)
3. Fetches all transactions (CashSale + CustInvc, ~7,282)
4. Fetches all line items (~333,195)
5. Upserts to Supabase tables

---

## Complete Definitions Reference

### Days of Inventory (DOI)

**Calculation**: Uses monthly budgets from database to project stockout date
- Starts from today (EST timezone)
- Consumes inventory against daily demand (monthly budget / days in month)
- Projects forward until inventory = 0

**Visual Thresholds** (app/page.tsx:2656-2662):
| DOI | Status | Color |
|-----|--------|-------|
| Backorder | Critical | Red (#F87171) |
| < 7 days | Urgent | Red (#F87171) |
| < 30 days | Watch | Amber (#F59E0B) |
| < 60 days | OK | Yellow (#FBBF24) |
| 60+ days | Healthy | Green (#34D399) |

**Source File**: `lib/doi.ts`
- Uses `WEEKLY_WEIGHTS` for seasonality (week 47 = 7.3%, week 48 = 10.2% for BFCM)
- Max projection: 730 days (2 years)

---

### Sales Velocity

**Definition**: 3-day rolling average of units sold per day

**Calculation** (app/api/inventory/route.ts:339-370):
```
sales3DayTotal = orders from (today - 3 days) to (today - 1 day)
velocity = sales3DayTotal / 3 (rounded to whole number)
```

**Delta**: Compares current 3-day avg to prior 3-day avg
```
delta = ((current - prior) / prior) × 100
```

---

### Safety Stock

**Definition**: Minimum inventory levels to maintain per SKU (from Safety Stock Q4 25.xlsx)

**Source File**: `lib/shiphero.ts` lines 333-362

**Values**:
| Category | SKU | Safety Stock |
|----------|-----|--------------|
| Cast Iron | Smith-CI-Skil12 | 144 |
| Cast Iron | Smith-CI-Skil10 | 144 |
| Cast Iron | Smith-CI-Flat12 | 72 |
| Cast Iron | Smith-CI-Skil14 | 50 |
| Cast Iron | Smith-CI-Griddle18 | 88 |
| Cast Iron | Smith-CI-Skil8 | 72 |
| Cast Iron | Smith-CI-Skil6 | 72 |
| Cast Iron | Smith-CI-Chef10 | 144 |
| Cast Iron | Smith-CI-Dutch5 | 50 |
| Cast Iron | Smith-CI-Dual12 | 72 |
| Cast Iron | Smith-CI-DSkil11 | 64 |
| Cast Iron | Smith-CI-Flat10 | 72 |
| Cast Iron | Smith-CI-Dutch4 | 60 |
| Cast Iron | Smith-CI-Dual6 | 72 |
| Cast Iron | Smith-CI-Dutch7 | 60 |
| Cast Iron | Smith-CI-Grill12 | 72 |
| Carbon Steel | Smith-CS-Farm12 | 35 |
| Carbon Steel | Smith-CS-Farm9 | 45 |
| Carbon Steel | Smith-CS-Fish | 14 |
| Carbon Steel | Smith-CS-OvalM | 36 |
| Carbon Steel | Smith-CS-Round17N | 20 |
| Carbon Steel | Smith-CS-Deep12 | 35 |
| Carbon Steel | Smith-CS-WokM | 32 |
| Carbon Steel | Smith-CS-RRoastM | 36 |

---

### Customer Health Status (Wholesale)

**Source**: `app/api/wholesale/route.ts` lines 43-54

| Status | Days Since Last Order | Color |
|--------|----------------------|-------|
| New | null (never ordered) | Blue |
| Thriving | 0-120 days (recent) | Green |
| Stable | varies | Blue |
| Declining | varies | Amber |
| At Risk | 120-180 days | Amber |
| Churning | 180-365 days | Red |
| Churned | > 365 days | Gray |

**Risk Score Calculation** (line 296):
```
risk_score = min(100, days_since_last_order / 3.65)
```

---

### Budget Pace

**Definition**: Percentage of monthly budget achieved so far

**Calculation**:
```
pace = (actual_sold / monthly_budget) × 100
```

**Visual Thresholds** (app/page.tsx:4311-4315):
| Pace | Background |
|------|------------|
| >= 90% | Green |
| >= 80% | Warning/Amber |
| < 80% | Red |

**Pulse Animation**: SKU pulses green if `actual > budget` (ahead of monthly target)

---

### Fulfillment Lead Time

**Definition**: Time from order creation to shipment

**Calculation**:
```
lead_time_hours = shipped_at - created_at
```

**Status Thresholds**:
- < 24 hours: Good
- 24-48 hours: Acceptable
- > 48 hours: Delayed

---

### Stuck Shipments

**Definition**: Orders shipped but not delivered within expected timeframe

**Threshold**: > 7 days in transit

---

## Visual Indicators & Row Highlighting

### Inventory Table Row Colors

**Source**: `app/page.tsx` lines 2836-2846

**Priority Order**:
1. **Solid Red Background** (`bg-red-500/15`):
   - Total inventory is negative (backordered)
   - OR any warehouse has negative inventory

2. **Pulsing Amber Background** (`ss-violation`):
   - Total inventory is below safety stock threshold
   - Animation defined in `globals.css` lines 181-197

3. **Zebra Striping** (`bg-bg-tertiary/10`):
   - Alternating rows for readability

**Cell-Level Highlighting**:
- **Negative numbers**: Red text + red background tint
- **Low stock** (< 10 units): Amber text + warning background

### DOI Dot Colors
Small colored dot next to product name indicates DOI status (see thresholds above)

### Budget vs Actual Pulse
- **Green pulse**: SKU where `actual > budget` (exceeding monthly budget before EOM)

---

## File Paths & Scripts

### Local Scripts (Your Machine)

| Script | Path | Purpose |
|--------|------|---------|
| Update Assembly Tracking | `~/Desktop/Update Assembly Tracking.command` | Daily assembly sync trigger |
| Assembly Python Processor | `~/scripts/update_assembly_tracking.py` | Parse NetSuite XML, update Excel |
| NS Export Archive | `~/scripts/ns_exports_archive/` | Archived NetSuite exports |

### Repository Scripts

| Script | Path | Purpose |
|--------|------|---------|
| Sync Assembly | `scripts/sync-assembly-tracking.ts` | Excel → Supabase for assembly |
| Sync Holiday | `scripts/sync-holiday-tracking.ts` | Excel → Supabase for holiday |
| Sync NetSuite Wholesale | `scripts/sync-netsuite-wholesale.py` | NetSuite API → Supabase |

### Excel Files (OneDrive)

| File | Path |
|------|------|
| Assembly Tracking | `~/Library/CloudStorage/OneDrive-SharedLibraries-SmitheyIronwareCompany,LLC/Smithey Ironware Team Site - Documents/Reporting/Looker Dashboards/Cookware Assembly Tracking.xlsx` |
| Holiday Tracker | `~/Library/CloudStorage/OneDrive-SharedLibraries-SmitheyIronwareCompany,LLC/Smithey Ironware Team Site - Documents/Reporting/Looker Dashboards/Holiday 2025 Super Tracker.xlsx` |

### Excel Sheet Structure

**Cookware Assembly Tracking.xlsx**:
- `Raw_Data` - Daily production by SKU (Date, Item, Sum of Quantity)
- `Daily_Aggregation` - Aggregated daily totals with week/month info
- `Revised Manufacturing Targets` - SKU targets and progress

**Holiday 2025 Super Tracker.xlsx**:
- `Sheet1` - Day-by-day 2024 vs 2025 comparison

---

## Cron Schedule Reference

All times are UTC (Vercel cron)

```
*/5  * * * *  → sync-reamaze (every 5 min)
*/15 * * * *  → sync-inventory (every 15 min)
*/15 * * * *  → sync-b2b (every 15 min)
0    * * * *  → tracking/check (hourly)
30   5 * * *  → sync-shopify-stats (5:30am daily)
0    6 * * *  → sync-klaviyo (6am daily)
0   12 * * *  → sync-holiday (noon daily)
```

---

## Database Tables

### Core Tables
| Table | Primary Use | Key Columns |
|-------|-------------|-------------|
| `inventory` | Current stock levels | sku, warehouse_id, available, synced_at |
| `inventory_history` | Daily snapshots | sku, warehouse_id, on_hand, snapshot_date |
| `products` | Product catalog | sku, display_name, category, is_active |
| `orders` | D2C order header | shopify_order_id, created_at, canceled, shipped_at |
| `line_items` | Order line details | order_id, sku, quantity |
| `tracking` | Shipment tracking | order_id, tracking_number, delivered_at |
| `budgets` | Monthly budget targets | sku, year, month, budget |
| `b2b_fulfilled` | B2B fulfillments | sku, quantity, fulfilled_at |

### Assembly Tables
| Table | Purpose |
|-------|---------|
| `assembly_daily` | Daily production totals |
| `assembly_targets` | SKU-level manufacturing targets |
| `assembly_sku_daily` | Daily production by SKU |
| `assembly_config` | Configuration values (cutoff date, etc) |

### Holiday Table
| Table | Purpose |
|-------|---------|
| `holiday_tracking` | Day-by-day 2024/2025 comparison |

### Wholesale Tables
| Table | Purpose |
|-------|---------|
| `ns_wholesale_customers` | NetSuite customer records |
| `ns_wholesale_transactions` | Cash sales and invoices |
| `ns_wholesale_line_items` | Transaction line details |

### Sync Logging
| Table | Purpose |
|-------|---------|
| `sync_logs` | Tracks all sync operations with status, duration, record counts |

---

## SWOT Analysis

### Strengths
- **Real-time inventory visibility** across all warehouses with 15-min sync
- **Automated alerting** via SyncHealthBanner for data sync failures
- **Comprehensive DOI projections** using actual budgets and seasonality
- **Safety stock monitoring** with visual row highlighting
- **YoY holiday tracking** for seasonal performance analysis
- **Multi-source data aggregation** (ShipHero, Shopify, NetSuite, Reamaze, Klaviyo)

### Weaknesses
- **Manual assembly sync** requires daily human intervention (desktop command)
- **NetSuite wholesale sync** is fully manual (Python script)
- **No real-time D2C order sync** - relies on hourly tracking checks
- **Safety stock values hardcoded** in `lib/shiphero.ts` - requires code deploy to update
- **Budget data entry** is manual (no automated import from planning tools)
- **Excel dependency** for assembly/holiday data introduces single point of failure

### Opportunities
- **Automate assembly sync** via scheduled script or NetSuite API direct integration
- **Move safety stock to database** for easier updates without deploys
- **Add predictive analytics** using historical velocity trends
- **Implement webhook-based order sync** for real-time D2C updates
- **Budget import automation** from whatever planning tool generates budgets
- **Customer health alerts** - automated notifications for at-risk wholesale accounts

### Threats
- **OneDrive sync delays** can cause stale assembly/holiday data
- **API rate limits** (ShipHero, Shopify) could cause sync failures during peak
- **Excel file corruption** would break assembly tracking pipeline
- **NetSuite API changes** could break wholesale sync
- **Query limits** (2M row cap on some queries) could truncate data during very high volume periods

---

## Troubleshooting

### Assembly Data Not Updating
1. Check OneDrive is synced (file timestamps)
2. Re-run Desktop command script
3. Check `~/scripts/ns_exports_archive/` for successful exports
4. Manually run `npm run sync-assembly` from `~/smitheywarehouse`

### Inventory Shows Stale Data
1. Check Vercel dashboard for cron failures
2. Check `sync_logs` table for errors
3. Look for SyncHealthBanner warnings on dashboard
4. Manually trigger: `curl https://[app-url]/api/cron/sync-inventory`

### Wholesale Data Missing
1. Run `python3 scripts/sync-netsuite-wholesale.py`
2. Check NetSuite API credentials in `.netsuite-credentials.env`
3. Verify Supabase connection in `.env.local`

---

*Last Updated: December 2025*
