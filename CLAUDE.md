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

## Development Commands
```bash
npm run dev          # Local development
npm run build        # Production build
npm run lint         # ESLint check
```

## Environment Variables
See `.env.local.example` for required variables (Supabase, NetSuite, Klaviyo, ShipHero keys).
