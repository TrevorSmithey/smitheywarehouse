# Smithey Warehouse Dashboard

## Project Overview
Internal operations dashboard for Smithey Ironware. Aggregates data from NetSuite, Shopify, ShipHero, Klaviyo, Typeform, and Re:amaze into unified views for Sales, Fulfillment, Inventory, Marketing, and VOC analysis.

## Tech Stack
- **Framework**: Next.js 14 (App Router)
- **Database**: Supabase (PostgreSQL)
- **Styling**: Tailwind CSS with custom design system
- **Deployment**: Vercel
- **Auth**: Vercel password protection (internal tool)

## Key Architecture Patterns

### Data Sync Strategy
- Cron jobs sync external data (NetSuite, Klaviyo, ShipHero) to Supabase
- API routes aggregate and compute metrics on demand
- Future: Consider precomputing aggregates nightly for performance

### Customer Classification
- `is_corporate_gifting: boolean` - Primary flag for corporate customers
- `category: string` - "Corporate", "4" (legacy), or wholesale tier
- **IMPORTANT**: Always use `is_corporate_gifting === true` OR `category === "Corporate"` OR `category === "4"` for corporate exclusion
- B2B metrics EXCLUDE corporate customers (different buying patterns skew AOV, order frequency)

---

## Dashboard Architecture Lessons (December 2024)

### 1. Single Source of Truth for Metrics
**Problem**: "New Customers" showed different numbers in header (109), badge (77), and table (11) because each pulled from different sources.

**Root cause**:
- `health_status='new'` = 90-day rolling window (11 customers)
- `ytdNewCustomerIds` = calendar year acquisitions (109 customers)
- `acquisition.currentPeriod.newCustomerCount` = YoY comparison metric

**Lesson**: Define each metric ONCE. Name explicitly: `new_customers_90d`, `new_customers_ytd`, `first_time_buyers_2025`. One component, one data source - pass the same array to header count, badge, and table.

### 2. Explicit Time Window Naming
**Problem**: "New customers" meant different things in different contexts.

**Solution**: Always encode the time window in the variable/field name:
- `newCustomers90d` - rolling 90-day window
- `ytdNewCustomerIds` - calendar year to date
- `firstOrderDate` - the actual date for custom filtering

### Revenue Time Windows (YTD vs T12)
**Current State** (December 2024):
- **Wholesale Dashboard** uses `ytd_revenue` (calendar year-to-date) from DB column, computed by NetSuite sync cron
- **Customer Detail Page** uses `t12_revenue` (trailing 12 months) computed on-demand from transactions

**Why different?**
- Dashboard needs fast aggregation across 700+ customers → precomputed YTD in DB
- Detail view needs accurate single-customer health check → real-time T12 calculation

**Future consideration**: Migrate everything to T12 for consistency. Would require:
1. Rename DB column `ytd_revenue` → `t12_revenue`
2. Update NetSuite sync cron (`sync-netsuite-customers`) to compute trailing 12 months
3. Update `WholesaleCustomer` type and all consumers
4. Update wholesale dashboard API to read `t12_revenue`

### 3. Business Logic Flags Belong in Database
**Problem**: Manually flagging corporate customers one-by-one via SQL is not scalable.

**Better approaches**:
1. Sync from NetSuite if classification exists there
2. Admin UI to bulk-tag customers
3. Heuristics based on order patterns, email domains, company name keywords
4. Computed `is_b2b_standard` boolean updated by cron

### 4. Precompute Heavy Aggregations
**Problem**: Computing AOV, YoY comparisons, customer counts by segment on every page load is expensive.

**Better architecture**:
- Nightly cron computes aggregates into `wholesale_stats_daily` table
- API serves cached data instantly
- Manual refresh button triggers recompute if needed
- Include `computed_at` timestamp for staleness detection

### 5. Utility Functions for Repeated Logic
**Problem**: Corporate customer filtering was inconsistent across codebase - sometimes checking `category`, sometimes `is_corporate_gifting`, sometimes both.

**Solution**: Single utility function used everywhere:
```typescript
function isCorpCustomer(c: WholesaleCustomer): boolean {
  return c.is_corporate_gifting === true ||
         c.category === "Corporate" ||
         c.category === "4";
}
```

### 6. API Response Shape Consistency
When returning customer arrays with metrics, always include:
- The array of customers
- Count that matches array.length
- Any computed aggregates (totals, averages)
- Clear field names that indicate what's included/excluded

---

## File Structure Notes

### Key Files
- `app/api/wholesale/route.ts` - Main wholesale dashboard API (~1000 lines, handles all metrics)
- `components/WholesaleDashboard.tsx` - Main dashboard UI
- `lib/types.ts` - TypeScript interfaces for all data shapes
- `supabase/migrations/` - Database schema changes

### Database Tables
- `ns_wholesale_customers` - Customer master data with metrics
- `ns_transactions` - Order/invoice history
- `sync_logs` - Cron job execution history
- `typeform_leads` - Lead tracking from forms
- `b2b_draft_orders` - Open B2B draft orders from Shopify (synced hourly, full resync approach)

### Inventory Dashboard
- **Data Priority Tiers**:
  - Tier 1 (Primary): Product, Hobson, Selery, Total, DOI - full opacity
  - Tier 2 (Secondary): Vel, Draft - 70% opacity (`text-sky-400/70`, `text-purple-400/70`)
- **Velocity**: 3-day moving average, retail-only (from `line_items` + `orders`, NOT `b2b_fulfilled`)
- **Draft column**: Open wholesale draft orders from `b2b_draft_orders` table
- **MetricLabel component**: Tooltip-on-hover for column headers, no visible icons
- **Desktop columns**: Vel and Draft only show on `xl:` breakpoint (hidden on mobile)

---

## Corporate Customers Marked (for reference)
These are manually flagged as corporate gifting (one-time buyers, not recurring wholesale):
- Struc Design, LLC
- Fox building supply & carpet
- Now Healthcare Recruiting
- Ducks Unlimited
- Field Studio
- Mirador
- Baumann Building Inc
- SA Recycling
- Copper Creek Landscapes
- Ameripride Construction LLC
- Merrill Lynch
- IBA, Inc
- Jfisher Co

---

## Design Philosophy: Whimsy & Delight

### The Rule
**Little bits of whimsy are okay as long as they are subservient.** This is a serious business operations dashboard, but occasional moments of fun and personality are welcome—when they don't get in the way.

### When Whimsy Works
- **Loading states**: Cast-iron themed messages ("Seasoning the data...", "Tempering the numbers...") transform dead time into brand moments
- **Login celebration**: A 2-second moment of delight with the bouncing quail creates emotional connection
- **Empty states**: A gentle message or subtle animation can soften the "nothing here" experience
- **Success feedback**: After completing an action, a brief celebration feels earned

### When Whimsy Fails
- **Never forced**: If it feels like "we added this to be quirky," cut it
- **Never blocking**: Fun should never add friction or slow down work
- **Never repetitive**: The 10th time someone sees a cute animation, it becomes annoying
- **Never in data**: Metrics, charts, tables—these are sacred. No jokes in the numbers.

### The AnimatedQuail System
The Smithey quail mascot has four states:
- `idle`: Gentle pecking animation (default, for loading)
- `looking`: Head raised, attentive (when user is typing)
- `happy`: Bouncing celebration (success moments)
- `surprised`: Shake animation (error/wrong PIN)

Use sparingly. The quail appears on:
- Login page (interactive)
- Loading states (subtle background presence)

### Loading Messages
Located in `/components/SmitheyLoader.tsx`:
```typescript
const LOADING_MESSAGES = [
  "Seasoning the data...",      // Default/signature
  "Firing up the forge...",
  "Heating the iron...",
  "Opening the vault...",
  "Tempering the numbers...",
  "Polishing the pans...",
  "Stoking the coals...",
  "Forging ahead...",
  "Hammering out the details...",
  "Preheating the numbers...",
];
```

These rotate randomly during longer loads. For quick loads, "Seasoning the data..." is the default signature message.

### The Test
Before adding any whimsy, ask:
1. Does this serve the user or just amuse the developer?
2. Will this be delightful on the 100th viewing?
3. Does it slow anything down?
4. Is it on-brand (cast iron, forge, craftsmanship themes)?

If any answer is no, cut it.

---

## Paid Media Integration (January 2026)

### Architecture Decisions

**Platform-Specific Tables (Not Unified)**
- `meta_campaigns` and `google_campaigns` are separate tables, NOT a unified `ad_campaigns` table
- Why: Meta has `reach`, `frequency`, `add_to_carts` that Google doesn't. Google has `search_impression_share` that Meta doesn't. A unified table would have 10+ nullable columns and messy TypeScript unions.
- Aggregation happens in `ad_daily_stats` and `ad_monthly_stats` which join on `date`.

**MER vs Platform ROAS**
- MER (Marketing Efficiency Ratio) = Shopify Revenue / Total Ad Spend
- Platform ROAS is inflated by attribution overlap. MER is the truth.
- Always show MER as the hero metric. Platform ROAS is for channel comparison only.

**nCAC Calculation**
- Uses `Set<string>` to count DISTINCT `shopify_customer_id` per day
- Previous bug: counted orders instead of unique customers, inflating new customer count

### Race Condition Fix
When `sync-meta` and `sync-google-ads` run concurrently, they can overwrite each other's data in `ad_daily_stats`. Solution: atomic upsert functions (`upsert_ad_daily_stats_meta`, `upsert_ad_daily_stats_google`) that use `COALESCE` to preserve the other platform's columns.

### Vercel Cron Limits
- **Limit: 20 cron jobs per project**
- Combined weekly jobs (`reconcile-shopify-stats` + `refresh-shiphero-token`) into `weekly-maintenance` to save slots
- Before adding new crons, always check current count: `grep -c '"path":' vercel.json`

### Secrets in Code
- GitHub Push Protection blocks commits with hardcoded secrets
- NEVER put OAuth tokens, API keys, or credentials directly in code
- Always use `process.env.VARIABLE_NAME` even in utility scripts

---

## Production Dashboard (January 2026)

### Seasonality Context
**Production is level-loaded** - Unlike fulfillment, marketing, and sales which are highly seasonal, Smithey intentionally maintains steady production output year-round. This means:
- MoM comparisons are meaningful (not skewed by seasonal peaks)
- T7 velocity is a reliable health indicator
- Defect rates should remain stable (spikes = real problems, not volume effects)

### Defect Rate Pattern
- **Identification**: Defect SKUs have "-D" suffix (e.g., `SMITH-CI-12FLAT-D`)
- **Calculation**: `defect_qty / (fq_qty + defect_qty) × 100`
- **All-time vs 60-day**: Track both to detect emerging quality issues
- **Anomaly detection**: Flag when recent rate > all-time × 1.3 AND > all-time + 1.5pp AND volume ≥ 50

### Statistical Noise Filtering
`MIN_VOLUME_THRESHOLD = 500` - SKUs with fewer than 500 total units are excluded from defect rate analysis. Low-volume SKUs create misleading percentages (4 units with 1 defect = 25% defect rate).

### Visual Patterns
- **Elevated indicators**: Pulsing amber dot for SKUs with recent rates significantly above baseline
- **Color-coded rates**: Green (<2%), Amber (2-5%), Red (>5%) for all-time defect rates
- **Ember-tinted scrollbar**: `.scrollbar-thin` class with `rgba(249, 115, 22, x)` for on-brand dark theme

### Known Limitations (Revisit Later)
1. **MIN_VOLUME_THRESHOLD = 500 may be too aggressive**
   - New SKUs or low-volume specialty items won't appear until 500+ units produced
   - Could miss critical early-stage quality problems
   - Consider: Lower to 100-200, or show low-volume SKUs with "Low Volume" badge

2. **Anomaly detection thresholds are hardcoded**
   - `recentRate > allTimeRate * 1.3` (30% higher)
   - `recentRate > allTimeRate + 1.5` (+1.5 percentage points)
   - `recentTotal >= 50` (minimum recent volume)
   - Edge case: 0.5% → 1.8% is +260% but only +1.3pp (wouldn't flag)
   - Consider: Extract to named constants, validate against historical data

---

## Development Commands
```bash
npm run dev          # Local development
npm run build        # Production build
npm run lint         # ESLint check
```

## Environment Variables
See `.env.local.example` for required variables (Supabase, NetSuite, Klaviyo, ShipHero keys).
