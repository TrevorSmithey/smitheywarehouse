# Smithey Operations Dashboard

Internal operations dashboard for Smithey Ironware. Aggregates data from NetSuite, Shopify, ShipHero, Klaviyo, AfterShip, Meta, Google Ads, Typeform, and Re:amaze into unified views.

## Dashboard Tabs

| Tab | Purpose | Data Sources |
|-----|---------|--------------|
| **Inventory** | Stock levels, velocity, days-of-inventory | ShipHero |
| **Fulfillment** | Order processing, backlog, lead times | Shopify, ShipHero |
| **Production** | Manufacturing output, defect rates | NetSuite |
| **Restoration** | Customer pan restoration pipeline | AfterShip Returns |
| **Sales** | B2B wholesale analytics, customer health, leads | NetSuite, Typeform |
| **Marketing** | Email performance, paid media (Meta/Google) | Klaviyo, Meta Ads, Google Ads |
| **VOC** | Customer feedback, NPS, support tickets | Re:amaze |
| **Budget** | Budget vs actual tracking | Internal |
| **Revenue** | Revenue tracking and forecasting | NetSuite, Shopify |
| **Q4 Pace** | Holiday season performance tracker | Shopify |
| **Ecommerce** | DTC metrics and trends | Shopify |

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Database**: Supabase (PostgreSQL)
- **Styling**: Tailwind CSS with custom design system
- **Deployment**: Vercel
- **Auth**: Role-based with Supabase + custom session management

## Architecture

```
External APIs          Cron Jobs              Supabase DB
─────────────      ─────────────────      ─────────────────
NetSuite        →  sync-netsuite-*     →  ns_wholesale_customers
Shopify         →  sync-shopify-*      →  orders, line_items
ShipHero        →  sync-shiphero-*     →  shiphero_inventory
Klaviyo         →  sync-klaviyo-*      →  klaviyo_campaigns
AfterShip       →  sync-aftership-*    →  restorations
Meta Ads        →  sync-meta           →  meta_campaigns, ad_daily_stats
Google Ads      →  sync-google-ads     →  google_campaigns, ad_daily_stats

                         ↓
              Next.js API Routes (aggregation)
                         ↓
              React Dashboard Components
```

### Data Flow

1. **Cron jobs** run on Vercel schedules (every 15min to daily depending on data type)
2. **External APIs** are called and data is transformed/stored in Supabase
3. **API routes** aggregate data on-demand with computed metrics
4. **Dashboard** renders with client-side state management

## Development

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Build for production
npm run build
```

Open [http://localhost:3000](http://localhost:3000)

## Environment Variables

Create `.env.local` with:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key

# Shopify
SHOPIFY_STORE_URL=smithey-ironware.myshopify.com
SHOPIFY_ADMIN_TOKEN=shpat_xxxxx

# NetSuite (OAuth 2.0)
NETSUITE_ACCOUNT_ID=xxx
NETSUITE_CLIENT_ID=xxx
NETSUITE_CLIENT_SECRET=xxx
NETSUITE_CERTIFICATE_ID=xxx

# ShipHero
SHIPHERO_ACCESS_TOKEN=xxx
SHIPHERO_REFRESH_TOKEN=xxx

# Klaviyo
KLAVIYO_API_KEY=xxx

# AfterShip Returns
AFTERSHIP_RETURNS_API_KEY=xxx

# Meta Ads
META_ACCESS_TOKEN=xxx
META_AD_ACCOUNT_ID=xxx

# Google Ads
GOOGLE_ADS_CLIENT_ID=xxx
GOOGLE_ADS_CLIENT_SECRET=xxx
GOOGLE_ADS_REFRESH_TOKEN=xxx
GOOGLE_ADS_CUSTOMER_ID=xxx
GOOGLE_ADS_DEVELOPER_TOKEN=xxx
```

## Key Patterns

### Customer Classification (B2B)
- `is_corporate_gifting: boolean` - Primary flag for corporate customers
- B2B metrics EXCLUDE corporate (different buying patterns skew analytics)
- Always use: `is_corporate_gifting === true OR category === "Corporate" OR category === "4"`

### Health Status (Wholesale)
Customers are classified by recency and revenue trends:
- **Healthy**: <180 days since last order
- **At Risk**: 180-269 days
- **Churning**: 270-364 days
- **Churned**: 365+ days

### Design System
See `CLAUDE.md` for comprehensive design patterns including:
- Color variables (backgrounds, text, status, accents)
- Typography scale
- Component patterns (cards, tables, buttons, sub-tabs)
- Spacing conventions

## File Structure

```
app/
├── (dashboard)/           # Protected dashboard routes
│   ├── layout.tsx         # Main nav, auth wrapper
│   ├── inventory/
│   ├── fulfillment/
│   ├── production/
│   ├── restoration/
│   ├── sales/
│   │   ├── layout.tsx     # Sales sub-tabs (Wholesale/Leads/Door Health)
│   │   ├── page.tsx       # Wholesale dashboard
│   │   ├── leads/
│   │   └── door-health/
│   ├── marketing/
│   │   ├── layout.tsx     # Marketing sub-tabs (Email/Paid)
│   │   ├── page.tsx       # Email (Klaviyo)
│   │   └── paid/
│   └── ...
├── api/
│   ├── cron/              # Scheduled data sync jobs
│   │   ├── sync-netsuite-customers/
│   │   ├── sync-netsuite-transactions/
│   │   ├── sync-shiphero-inventory/
│   │   ├── sync-klaviyo/
│   │   ├── sync-meta/
│   │   ├── sync-google-ads/
│   │   └── ...
│   ├── wholesale/         # B2B analytics endpoints
│   ├── door-health/       # Customer retention metrics
│   ├── leads/             # Lead tracking
│   └── ...
components/
├── WholesaleDashboard.tsx
├── DoorHealthDashboard.tsx
├── LeadsDashboard.tsx
└── ...
lib/
├── types.ts               # TypeScript interfaces
├── netsuite.ts            # NetSuite API client
├── shiphero.ts            # ShipHero GraphQL client
└── auth/                  # Authentication utilities
```

## Cron Job Schedule

| Job | Frequency | Purpose |
|-----|-----------|---------|
| sync-shiphero-inventory | Every 15 min | Stock levels |
| sync-shopify-orders | Every 15 min | Order data |
| sync-netsuite-transactions | Every 6 hours | B2B transactions |
| sync-netsuite-customers | Daily | Customer master data |
| sync-klaviyo | Daily | Email campaign stats |
| sync-meta | Daily | Meta ad performance |
| sync-google-ads | Daily | Google ad performance |
| sync-aftership-returns | Every 30 min | Restoration shipments |

## Contributing

This is an internal tool. See `CLAUDE.md` for detailed development guidelines, lessons learned, and patterns to follow.
