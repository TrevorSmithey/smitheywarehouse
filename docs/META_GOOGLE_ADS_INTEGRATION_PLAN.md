# Meta & Google Ads Integration Plan

## Goal
Add paid advertising performance data from Meta (Facebook/Instagram) and Google Ads to the warehouse dashboard for:
1. **Month-end reporting** - consolidated ad spend, ROAS, revenue attribution
2. **Channel comparison** - compare performance across Klaviyo, Meta, Google
3. **Budget tracking** - spend vs. budget by channel

---

## What You'll Get

### Unified Ads Dashboard
- Total ad spend across Meta + Google
- ROAS by channel
- Cost per acquisition (CPA)
- Revenue attributed to ads
- Monthly trend charts (spend, revenue, ROAS)
- Top campaigns by revenue
- Budget pacing

### Per-Channel Views
- Meta: Facebook + Instagram breakdown, ad creative performance
- Google: Search vs. Shopping vs. Display, keyword performance

---

## Architecture Pattern (Follows Klaviyo)

Based on the proven Klaviyo integration:
1. **Database tables** for synced data + monthly rollups
2. **Cron jobs** for daily API sync
3. **API route** for frontend queries with period filtering
4. **Dashboard component** with charts and tables
5. **Types** in lib/types.ts

---

## Phase 1: Meta Ads Integration

### 1.1 Meta API Setup

**Authentication Required:**
- Facebook Business App (create at developers.facebook.com)
- System User access token (60+ day lifespan, auto-refresh)
- Permissions: `ads_read`, `read_insights`
- Ad Account ID (format: `act_XXXXXXXXX`)

**Environment Variables:**
```
META_ACCESS_TOKEN=<system_user_token>
META_AD_ACCOUNT_ID=act_XXXXXXXXX
META_APP_ID=<optional, for token refresh>
META_APP_SECRET=<optional, for token refresh>
```

**Official SDK:**
```bash
npm install facebook-nodejs-business-sdk
```

**Key API Endpoints:**
- `GET /{ad_account_id}/campaigns` - List campaigns
- `GET /{ad_account_id}/insights` - Account-level metrics
- `GET /{campaign_id}/insights` - Campaign-level metrics
- `GET /{ad_id}/insights` - Ad-level metrics

**Rate Limits:**
- Dynamic based on active ads
- Standard tier recommended for production
- Attribution data: 28-day window max
- Historical data: 37 months aggregate, 13 months for unique metrics

### 1.2 Meta Database Schema

**Tables:**

```sql
-- meta_campaigns: Individual campaign performance
CREATE TABLE meta_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meta_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT,
  objective TEXT,
  platform TEXT, -- facebook, instagram, audience_network
  date DATE NOT NULL,
  -- Spend & Budget
  spend NUMERIC(12,2) DEFAULT 0,
  budget NUMERIC(12,2),
  -- Reach & Impressions
  impressions BIGINT DEFAULT 0,
  reach BIGINT DEFAULT 0,
  frequency NUMERIC(6,2),
  -- Engagement
  clicks BIGINT DEFAULT 0,
  ctr NUMERIC(6,4),
  cpc NUMERIC(8,4),
  cpm NUMERIC(8,4),
  -- Conversions (from Meta Pixel/CAPI)
  purchases INTEGER DEFAULT 0,
  purchase_value NUMERIC(12,2) DEFAULT 0,
  add_to_carts INTEGER DEFAULT 0,
  initiated_checkouts INTEGER DEFAULT 0,
  -- Calculated
  roas NUMERIC(8,4),
  cpa NUMERIC(8,4),
  -- Sync metadata
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- meta_monthly_stats: Pre-aggregated monthly rollups
CREATE TABLE meta_monthly_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month_start DATE NOT NULL UNIQUE,
  -- Spend
  total_spend NUMERIC(12,2) DEFAULT 0,
  facebook_spend NUMERIC(12,2) DEFAULT 0,
  instagram_spend NUMERIC(12,2) DEFAULT 0,
  -- Performance
  total_impressions BIGINT DEFAULT 0,
  total_reach BIGINT DEFAULT 0,
  total_clicks BIGINT DEFAULT 0,
  -- Conversions
  total_purchases INTEGER DEFAULT 0,
  total_revenue NUMERIC(12,2) DEFAULT 0,
  -- Averages
  avg_ctr NUMERIC(6,4),
  avg_cpc NUMERIC(8,4),
  avg_cpm NUMERIC(8,4),
  avg_roas NUMERIC(8,4),
  avg_cpa NUMERIC(8,4),
  -- Sync
  synced_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 1.3 Meta Sync Cron Job

**File:** `app/api/cron/sync-meta/route.ts`

**Sync Logic:**
1. Fetch daily campaign insights for last 90 days
2. Breakdown by: campaign, date, platform (placement)
3. Include metrics: spend, impressions, reach, clicks, purchases, purchase_value
4. Upsert to meta_campaigns (key: meta_id + date)
5. Recalculate meta_monthly_stats for affected months

**Schedule:** Daily at 7 AM UTC (after Klaviyo at 6 AM)

---

## Phase 2: Google Ads Integration

### 2.1 Google API Setup

**Authentication Required:**
- Google Ads Manager Account
- Developer Token (apply at API Center, takes 1-3 days approval)
- OAuth 2.0 credentials (Client ID, Client Secret)
- Refresh Token (generated via OAuth flow)
- Customer ID (format: XXX-XXX-XXXX, no dashes in API calls)

**Environment Variables:**
```
GOOGLE_ADS_DEVELOPER_TOKEN=<22_char_token>
GOOGLE_ADS_CLIENT_ID=<oauth_client_id>
GOOGLE_ADS_CLIENT_SECRET=<oauth_client_secret>
GOOGLE_ADS_REFRESH_TOKEN=<oauth_refresh_token>
GOOGLE_ADS_CUSTOMER_ID=XXXXXXXXXX
```

**Client Library:**
```bash
npm install google-ads-api
```
(Community library, but well-maintained and widely used)

**Query Language (GAQL):**
```sql
SELECT
  campaign.id,
  campaign.name,
  metrics.cost_micros,
  metrics.clicks,
  metrics.impressions,
  metrics.conversions,
  metrics.conversions_value
FROM campaign
WHERE segments.date DURING LAST_90_DAYS
```

**Rate Limits:**
- 1,200 queries/minute per developer token
- Access levels: Test (15K ops), Basic (15K ops), Standard (unlimited)

### 2.2 Google Database Schema

**Tables:**

```sql
-- google_campaigns: Individual campaign performance
CREATE TABLE google_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT,
  campaign_type TEXT, -- SEARCH, SHOPPING, DISPLAY, VIDEO, PERFORMANCE_MAX
  date DATE NOT NULL,
  -- Spend (stored as dollars, converted from micros)
  spend NUMERIC(12,2) DEFAULT 0,
  budget NUMERIC(12,2),
  -- Performance
  impressions BIGINT DEFAULT 0,
  clicks BIGINT DEFAULT 0,
  ctr NUMERIC(6,4),
  cpc NUMERIC(8,4),
  -- Conversions
  conversions NUMERIC(10,2) DEFAULT 0,
  conversion_value NUMERIC(12,2) DEFAULT 0,
  cost_per_conversion NUMERIC(8,4),
  -- Search-specific
  search_impression_share NUMERIC(6,4),
  -- Calculated
  roas NUMERIC(8,4),
  -- Sync
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(google_id, date)
);

-- google_monthly_stats: Pre-aggregated monthly rollups
CREATE TABLE google_monthly_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month_start DATE NOT NULL UNIQUE,
  -- Spend by type
  total_spend NUMERIC(12,2) DEFAULT 0,
  search_spend NUMERIC(12,2) DEFAULT 0,
  shopping_spend NUMERIC(12,2) DEFAULT 0,
  display_spend NUMERIC(12,2) DEFAULT 0,
  pmax_spend NUMERIC(12,2) DEFAULT 0,
  -- Performance
  total_impressions BIGINT DEFAULT 0,
  total_clicks BIGINT DEFAULT 0,
  -- Conversions
  total_conversions NUMERIC(10,2) DEFAULT 0,
  total_revenue NUMERIC(12,2) DEFAULT 0,
  -- Averages
  avg_ctr NUMERIC(6,4),
  avg_cpc NUMERIC(8,4),
  avg_roas NUMERIC(8,4),
  avg_cost_per_conversion NUMERIC(8,4),
  -- Sync
  synced_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2.3 Google Sync Cron Job

**File:** `app/api/cron/sync-google-ads/route.ts`

**Sync Logic:**
1. Query GAQL for campaign performance (last 90 days, daily)
2. Convert cost_micros to dollars (÷ 1,000,000)
3. Upsert to google_campaigns (key: google_id + date)
4. Recalculate google_monthly_stats for affected months

**Schedule:** Daily at 8 AM UTC (after Meta at 7 AM)

---

## Phase 3: Unified Ads API & Dashboard

### 3.1 API Route

**File:** `app/api/ads/route.ts`

**Query Parameters:**
- `period`: mtd, last_month, qtd, ytd, 30d, 90d
- `channel`: meta, google, all (default: all)

**Response Structure:**
```typescript
interface AdsResponse {
  // Combined stats for period
  stats: {
    total_spend: number;
    meta_spend: number;
    google_spend: number;
    total_revenue: number;
    meta_revenue: number;
    google_revenue: number;
    blended_roas: number;
    meta_roas: number;
    google_roas: number;
    total_purchases: number;
    avg_cpa: number;
    // Period comparison
    spend_delta: number;
    spend_delta_pct: number;
    revenue_delta: number;
    roas_delta: number;
  };
  // Monthly trends for charts
  monthly: AdsMonthlySummary[];
  // Top campaigns
  topMetaCampaigns: MetaCampaignSummary[];
  topGoogleCampaigns: GoogleCampaignSummary[];
  // Metadata
  lastSynced: {
    meta: string | null;
    google: string | null;
  };
}
```

### 3.2 Dashboard Component

**File:** `components/AdsDashboard.tsx`

**Layout:**
```
Header (period toggle + refresh + channel filter)
  ↓
Total Ad Spend + Revenue Attribution + Blended ROAS
  ↓
Channel Comparison (Meta vs Google side-by-side cards)
  ↓
KPI Grid (CPA, Purchases, CTR, Impressions)
  ↓
Monthly Spend vs Revenue Chart (stacked bars + ROAS line)
  ↓
Channel Breakdown Charts (Meta: FB/IG split, Google: Search/Shopping/Display)
  ↓
Top Campaigns Table (sortable, filterable by channel)
```

### 3.3 Types

**File:** `lib/types.ts` (add to existing)

```typescript
// Meta Ads types
interface MetaCampaignSummary { ... }
interface MetaMonthlySummary { ... }
interface MetaStats { ... }

// Google Ads types
interface GoogleCampaignSummary { ... }
interface GoogleMonthlySummary { ... }
interface GoogleStats { ... }

// Combined Ads types
interface AdsMonthlySummary { ... }
interface AdsStats { ... }
interface AdsResponse { ... }
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `supabase/migrations/XXX_meta_ads_integration.sql` | Meta tables + indexes + RLS |
| `supabase/migrations/XXX_google_ads_integration.sql` | Google tables + indexes + RLS |
| `lib/meta.ts` | Meta API client wrapper |
| `lib/google-ads.ts` | Google Ads API client wrapper |
| `app/api/cron/sync-meta/route.ts` | Daily Meta sync |
| `app/api/cron/sync-google-ads/route.ts` | Daily Google sync |
| `app/api/ads/route.ts` | Combined ads API for dashboard |
| `components/AdsDashboard.tsx` | Unified ads dashboard |
| `lib/types.ts` | Add Meta + Google + Ads types |
| `vercel.json` | Add cron schedules |
| `.env.example` | Add all new env vars |

---

## Implementation Order

1. **Meta First** (simpler auth, faster to test)
   - Set up Facebook Business App
   - Get System User token
   - Create schema + sync job
   - Verify data flowing

2. **Google Second** (more complex auth, approval wait)
   - Apply for Developer Token (may take days)
   - Set up OAuth flow
   - Create schema + sync job
   - Verify data flowing

3. **Unified Dashboard Last**
   - Build combined API
   - Build dashboard component
   - Add to main page tabs

---

## Gotchas & Considerations

### Meta
- **Token expiration**: System User tokens last 60 days, need refresh logic
- **Attribution window**: Max 28 days, data can change retroactively
- **iOS 14.5+**: Limited data for some conversions (ATT opt-outs)
- **API versioning**: Meta updates quarterly, may break integrations

### Google
- **Developer token approval**: Not instant, plan for 1-3 day wait
- **cost_micros**: All costs in millionths, must divide by 1,000,000
- **Conversion lag**: Google conversions can attribute up to 90 days later
- **Manager vs. Customer accounts**: Need correct customer ID hierarchy

### Both
- **Currency**: Ensure consistent currency (both in USD or convert)
- **Timezone**: Meta uses account timezone, Google uses account timezone
- **Data freshness**: Neither is real-time, expect 1-4 hour delays

---

## References

**Meta:**
- [Meta Marketing API Documentation](https://developers.facebook.com/docs/marketing-apis/)
- [facebook-nodejs-business-sdk (npm)](https://www.npmjs.com/package/facebook-nodejs-business-sdk)
- [Meta API Rate Limits](https://www.adamigo.ai/blog/meta-api-rate-limits-vs-throttling-key-differences)
- [Attribution Windows](https://ppc.land/meta-restricts-attribution-windows-and-data-retention-in-ads-insights-api/)

**Google:**
- [Google Ads API Overview](https://developers.google.com/google-ads/api)
- [GAQL Query Language](https://developers.google.com/google-ads/api/docs/query/overview)
- [Developer Token](https://developers.google.com/google-ads/api/docs/api-policy/developer-token)
- [google-ads-api (npm)](https://www.npmjs.com/package/google-ads-api)
- [Access Levels](https://developers.google.com/google-ads/api/docs/api-policy/access-levels)

---

## Existing Pattern Reference

This plan follows the proven Klaviyo integration architecture:
- `supabase/migrations/20251211_klaviyo_integration.sql`
- `app/api/cron/sync-klaviyo/route.ts`
- `app/api/klaviyo/route.ts`
- `components/KlaviyoDashboard.tsx`
- `lib/types.ts` (lines 672-824)
