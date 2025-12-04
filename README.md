# Smithey Warehouse Dashboard

Real-time fulfillment tracking for Smithey and Selery warehouses.

## Features

- Unfulfilled order counts per warehouse
- Partial fulfillment tracking
- Daily fulfilled counts
- 30-day fulfillment trend chart
- Auto-refresh every 5 minutes

## Setup

### 1. Supabase Database

1. Create a new Supabase project
2. Run the SQL in `SETUP.sql` in the SQL Editor
3. Copy your project URL and keys

### 2. Environment Variables

Create `.env.local`:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key

# Shopify
SHOPIFY_STORE_URL=smithey-ironware.myshopify.com
SHOPIFY_ADMIN_TOKEN=shpat_xxxxx
SHOPIFY_WEBHOOK_SECRET=your-webhook-secret
```

### 3. Deploy to Vercel

```bash
vercel
```

Set the same environment variables in your Vercel project settings.

### 4. Bootstrap Existing Orders

Import existing orders from Shopify (last 60 days):

```bash
npm run bootstrap
```

### 5. Register Shopify Webhooks

After deploying, register webhooks pointing to your Vercel URL:

**Topics to register:**
- `orders/create`
- `orders/updated`
- `orders/cancelled`

**Endpoint:** `https://your-app.vercel.app/api/webhooks/shopify`

You can register webhooks via:
- Shopify Admin > Settings > Notifications > Webhooks
- Or using the Shopify CLI

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Architecture

```
Shopify Webhooks ──> Vercel API Routes ──> Supabase
                                              │
                     Next.js Dashboard  <─────┘
```

- **Webhooks** keep data in sync automatically
- **Supabase** stores order and line item data
- **Dashboard** reads from Supabase (fast, no API limits)
