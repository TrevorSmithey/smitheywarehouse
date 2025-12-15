# How the Dashboard Works

---

## Where Your Data Comes From

```
    NetSuite ──────┐
    (wholesale)    │
                   │
    Shopify ───────┤
    (retail)       │
                   │
    ShipHero ──────┼────────▶  SUPABASE  ────────▶  VERCEL  ────────▶  YOU
    (inventory)    │           (database)           (website)         (browser)
                   │
    Klaviyo ───────┤
    (email)        │
                   │
    Typeform ──────┘
    (leads)
```

**Data auto-syncs every 15 minutes to 4 hours depending on the source.**

---

## How Changes Get Made

```
    YOU  ──────▶  CLAUDE CODE  ──────▶  GITHUB  ──────▶  VERCEL  ──────▶  LIVE
                  (writes code)         (saves it)       (deploys)        (~60 sec)
```

---

## The Systems

| System | What It Is |
|--------|------------|
| **Supabase** | Filing cabinet in the cloud. Stores copies of all your business data in one organized place. |
| **Vercel** | The building that houses your website. Keeps it running 24/7 and runs the sync jobs. |
| **GitHub** | Google Drive for code. Saves every version ever made. When code is saved here, Vercel auto-updates. |
| **Claude Code** | AI programmer. Writes code, fixes bugs, pushes to GitHub. |

---

## Data Freshness

| Data | How Old |
|------|---------|
| Inventory | Max 15 min |
| Fulfillment queue | Max 15 min |
| Wholesale customers | Max 4 hours |
| Transactions | Max 4 hours |
| Email stats | Daily |

---

## If Something Breaks

| If This Goes Down | What Happens |
|-------------------|--------------|
| Vercel | Site offline. Data safe. |
| Supabase | Dashboard blank. Can re-sync later. |
| GitHub | Can't deploy updates. Site still runs. |
| A sync fails | Red alert on dashboard. Data stays at last good sync. |
