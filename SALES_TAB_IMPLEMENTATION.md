# Sales Tab Implementation Plan

## Status: COMPLETED
**Last Updated**: 2025-12-11

## Overview
Building a Wholesale Analytics "Sales" tab for the Smithey Warehouse dashboard to visualize NetSuite wholesale customer data.

## Data Foundation (COMPLETED)
- Database migration applied: `supabase/migrations/20251211_netsuite_wholesale.sql`
- Tables created:
  - `ns_wholesale_customers` - 744 wholesale customers
  - `ns_wholesale_transactions` - ~7,294 transactions
  - `ns_wholesale_line_items` - ~245,379 line items
- Data synced for 2023 and 2024 from NetSuite
- Company names synced for all 744 customers

## Implementation Tasks

### 1. Types (COMPLETED)
- [x] Added wholesale types to `/Users/trevorfunderburk/smitheywarehouse/lib/types.ts`:
  - `WholesalePeriod` type
  - `CustomerHealthStatus` type
  - `CustomerSegment` type
  - `WholesaleCustomer` interface
  - `WholesaleTransaction` interface
  - `WholesaleLineItem` interface
  - `WholesaleMonthlyStats` interface
  - `WholesaleSkuStats` interface
  - `WholesaleStats` interface
  - `WholesaleAtRiskCustomer` interface
  - `WholesaleGrowthOpportunity` interface
  - `WholesaleResponse` interface

### 2. API Route (COMPLETED)
- [x] Created `/Users/trevorfunderburk/smitheywarehouse/app/api/wholesale/route.ts`
- Pattern follows: `/Users/trevorfunderburk/smitheywarehouse/app/api/klaviyo/route.ts`
- Queries implemented:
  - Monthly revenue stats with YoY comparison
  - Customer summary with health metrics
  - Top customers by revenue
  - At-risk customers (declining activity)
  - Recent transactions
  - Top SKUs
  - Period comparison stats

### 3. Dashboard Component (COMPLETED)
- [x] Created `/Users/trevorfunderburk/smitheywarehouse/components/WholesaleDashboard.tsx`
- Pattern follows: `/Users/trevorfunderburk/smitheywarehouse/components/KlaviyoDashboard.tsx`
- Design direction: Industrial/Utilitarian meets Refined Luxury
- Features implemented:
  - Revenue trend chart (monthly, YoY comparison)
  - Customer health breakdown (thriving/stable/at-risk/churning)
  - Top customers table with segment badges
  - At-risk customer alerts
  - Recent transactions feed
  - Top SKUs breakdown

### 4. Page Integration (COMPLETED)
- [x] Added "sales" to `PrimaryTab` type in `/Users/trevorfunderburk/smitheywarehouse/app/page.tsx` (line 81)
- [x] Added Sales tab button to navigation (lines 762-772) with TrendingUp icon
- [x] Added `useState` for `wholesaleData`, `wholesaleLoading`, `wholesalePeriod` (lines 255-258)
- [x] Added `fetchWholesale` callback (lines 470-482)
- [x] Added useEffect hooks for loading/refetching wholesale data (lines 484-498)
- [x] Added Sales tab content section (lines 1318-1327)
- [x] Imported `WholesaleDashboard` component (line 78)

## Key Database Queries

```sql
-- Monthly stats with YoY
SELECT
  DATE_TRUNC('month', t.tran_date)::DATE as month,
  COUNT(DISTINCT t.ns_transaction_id) as transaction_count,
  COUNT(DISTINCT t.ns_customer_id) as unique_customers,
  SUM(l.quantity) as total_units,
  SUM(l.net_amount) as total_revenue
FROM ns_wholesale_transactions t
JOIN ns_wholesale_line_items l ON t.ns_transaction_id = l.ns_transaction_id
WHERE t.tran_date >= $start_date
GROUP BY DATE_TRUNC('month', t.tran_date)
ORDER BY month;

-- Customer health view exists: ns_wholesale_customer_summary
-- SKU summary view exists: ns_wholesale_sku_summary
```

## Files Modified
1. `/Users/trevorfunderburk/smitheywarehouse/lib/types.ts` - COMPLETED
2. `/Users/trevorfunderburk/smitheywarehouse/app/api/wholesale/route.ts` - COMPLETED
3. `/Users/trevorfunderburk/smitheywarehouse/components/WholesaleDashboard.tsx` - COMPLETED
4. `/Users/trevorfunderburk/smitheywarehouse/app/page.tsx` - COMPLETED

## Testing
To verify the Sales tab is working:
1. Run `npm run dev` to start the development server
2. Navigate to the dashboard
3. Click the "SALES" tab in the navigation
4. Verify data loads and displays correctly
5. Test period selection (YTD, MTD, Last Year, etc.)
