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

### Detection Logic

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

### Legacy Corporate Check

Historical data has inconsistent flags. Always check all three:

```typescript
const isCorp = c.is_corporate_gifting === true ||
               c.category === "Corporate" ||
               c.category === "4";
```

**CRITICAL**: The database column is `is_corporate` (boolean). The `is_corporate_gifting` column does NOT exist in the current schema.

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
