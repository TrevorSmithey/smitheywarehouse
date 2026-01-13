# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start

```bash
npm run dev          # http://localhost:3000
npm run build        # Production build (MUST pass before commit)
npm run lint         # ESLint
```

No tests. Quality gates: TypeScript strict + ESLint + successful build.

## The Stack

Next.js 14 (App Router) · React 19 · TypeScript 5 · Supabase · Tailwind 4 · Vercel

Path alias: `@/*` → project root (e.g., `@/lib/types`, `@/components/...`)

---

## Safety Rules

These prevent expensive mistakes. Follow them always.

### 1. "Clear the view" ≠ Delete from database

When asked to "clear", "clean up", or "hide" data:
- **Default assumption**: Filter the UI (add WHERE clause)
- **Before ANY delete**: Show `SELECT COUNT(*)` and ask for explicit confirmation
- **Prefer soft delete**: Add `is_archived` flag, not `DELETE FROM`

### 2. Check git status before switching context

```bash
git status                              # ALWAYS run first
git stash save "WIP: what I was doing"  # If changes exist
```

### 3. API failures must be visible

```typescript
// WRONG: silent fallback
if (res.ok) setData(await res.json());

// RIGHT: visible failure
if (!res.ok) throw new Error(`API failed: ${res.status}`);
setData(await res.json());
```

### 4. Critical operations always run

```typescript
// WRONG: conditional critical path
if (condition) await computeMetrics();

// RIGHT: always run, log outcome
const { error } = await computeMetrics();
console.log(error ? `Failed: ${error}` : "Success");
```

### 5. Build must pass before commit

```bash
npm run build && npm run lint  # Both must succeed
```

---

## Where Things Live

### By Concern

| Area | Dashboard Route | API Route | Key Components |
|------|----------------|-----------|----------------|
| Inventory | `/inventory` | `/api/inventory` | `InventoryDashboard.tsx` |
| Fulfillment | `/fulfillment` | `/api/metrics` | `FulfillmentDashboard.tsx` |
| Production | `/production` | `/api/assembly` | `ProductionDashboard.tsx` |
| Restoration | `/restoration` | `/api/restorations` | `RestorationOperations.tsx` |
| Sales (B2B) | `/sales` | `/api/wholesale` | `WholesaleDashboard.tsx` |
| Leads | `/sales/leads` | `/api/leads` | `LeadsDashboard.tsx` |
| Marketing | `/marketing` | `/api/klaviyo` | `MarketingDashboard.tsx` |
| Paid Media | `/marketing/paid` | `/api/ads` | `PaidMediaDashboard.tsx` |
| VOC | `/voc` | `/api/tickets` | `VOCDashboard.tsx` |
| Budget | `/budget` | `/api/budget` | `BudgetDashboard.tsx` |

### By Layer

| Layer | Location | Purpose |
|-------|----------|---------|
| Routes | `app/(dashboard)/` | Page components, layouts |
| API | `app/api/` | Data aggregation, business logic |
| Cron | `app/api/cron/` | Scheduled syncs (see `vercel.json`) |
| Components | `components/` | Reusable UI |
| Types | `lib/types.ts` | All TypeScript interfaces |
| Auth | `lib/auth/` | Permissions, session management |
| DB Clients | `lib/supabase/` | Server and client Supabase |
| Styles | `app/globals.css` | Design system CSS variables |

### External Data Sources

| Source | Synced To | Cron Job |
|--------|-----------|----------|
| Shopify | `orders`, `line_items` | `high-frequency-sync` (15m) |
| ShipHero | `shiphero_inventory` | `high-frequency-sync` (15m) |
| NetSuite | `ns_wholesale_customers`, `ns_transactions` | `sync-netsuite-*` (daily) |
| Klaviyo | `klaviyo_campaigns` | `sync-klaviyo` (daily) |
| Meta Ads | `meta_campaigns`, `ad_daily_stats` | `sync-meta` (daily) |
| Google Ads | `google_campaigns`, `ad_daily_stats` | `sync-google-ads` (daily) |
| AfterShip | `restorations` | `sync-aftership-returns` (30m) |
| Re:amaze | `support_tickets` | `sync-reamaze` |

---

## Patterns

### API Route

```typescript
export async function GET(request: NextRequest) {
  const supabase = await createClient();

  const { data, error } = await supabase.from("table").select("*");

  if (error) {
    console.error("[ROUTE_NAME]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
```

### Supabase Client

```typescript
// Server (API routes, server components)
import { createClient } from "@/lib/supabase/server";
const supabase = await createClient();

// Client (browser components)
import { createClient } from "@/lib/supabase/client";
const supabase = createClient();
```

### Async Safety in Components

```typescript
const isMountedRef = useRef(true);
useEffect(() => () => { isMountedRef.current = false; }, []);

// In async handler:
if (isMountedRef.current) setState(result);
```

---

## Business Rules

### Time Windows

Always encode time window in names:
- `revenue90d`, `revenueYtd`, `revenueT12` — never just `revenue`
- `newCustomers30d`, `newCustomersYtd` — never just `newCustomers`

### Customer Health (B2B)

| Status | Days Since Last Order |
|--------|----------------------|
| healthy | < 180 |
| at_risk | 180-269 |
| churning | 270-364 |
| churned | 365+ |

### Corporate Customer Check

```typescript
// Always check all three conditions
const isCorp = c.is_corporate_gifting === true ||
               c.category === "Corporate" ||
               c.category === "4";
```

Corporate customers are excluded from B2B metrics (different buying patterns).

### Restoration SLA

- Clock starts: `delivered_to_warehouse_at`
- Target: 21 days
- Overdue = physically at Smithey AND > 21 days

### Defect SKUs

Pattern: `{SKU}-D` (e.g., `SMITH-CI-12FLAT-D`)

---

## Git Workflow

### Commit Format

```
<type>(<scope>): <description>

feat|fix|refactor|docs|style|perf|chore
```

### Before Commit

```bash
npm run build && npm run lint
```

### Before Branch Switch

```bash
git status
git stash save "WIP: description"
```

---

## Design System

See `DESIGN_SYSTEM.md` for colors, typography, and component patterns.

Key rules:
- Use CSS variables from `globals.css`, never hardcoded hex
- Status colors (`text-status-good/warning/bad`) only for actual status
- Cards: `bg-bg-secondary rounded-xl border border-border/30 p-5`
- Tables: sticky headers, `scrollbar-thin` containers

---

## Environment

See `.env.local.example` for all required variables.

Vercel cron limit: 20 jobs. Check before adding: `grep -c '"path":' vercel.json`
