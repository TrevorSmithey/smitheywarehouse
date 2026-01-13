# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**IMPORTANT: The user is not an engineer. Claude is the primary engineer for this codebase. This means Claude must own quality, validation, and best practices — there is no one else to catch mistakes.**

## Quick Start

```bash
npm install          # ALWAYS run first if node_modules missing
npm run dev          # http://localhost:3000
npm run build        # Type checking - MUST pass before commit
npm run lint         # ESLint - MUST pass before commit
```

## Claude's Engineering Responsibilities

Since the user relies on Claude for engineering:

1. **Own the quality gate** — No one else will catch type errors, bugs, or regressions
2. **Always validate** — Run `npm run build && npm run lint` before ANY commit
3. **Set up the environment** — If `node_modules` is missing, run `npm install` first
4. **Trace your changes** — Explain WHY the code is correct, not just WHAT changed
5. **Don't push broken code** — If validation fails, fix it before committing
6. **Be explicit about uncertainty** — If you can't verify something, say so clearly

## Stack

Next.js 14 (App Router) · React 19 · TypeScript 5 (strict) · Supabase · Tailwind 4 · Vercel

Path alias: `@/*` → project root

---

## Git Workflow

### Branch Strategy

Claude always works on feature branches. Never push directly to main.

```bash
# Branch naming pattern:
claude/<task-description>-<session-id>

# Example: claude/init-project-setup-9lWAY
```

### Before Every Commit (REQUIRED)

```bash
# 1. Ensure environment is set up
npm install          # If node_modules missing

# 2. Validate the code
npm run build        # Must pass - catches type errors
npm run lint         # Must pass - catches code issues

# 3. Only then commit
git add <files>
git commit -m "message"
```

**If validation fails:** Fix the errors. Do not commit broken code.

**If validation can't run:** Tell the user and do not proceed until resolved.

### Commit Messages

Match existing patterns in this repo:
- `feat(restorations): Add Teams notification on damage`
- `fix: modal backdrop close requires single click`
- `Add type guards and developer logging to eliminate silent auth failures`

### Before Switching Context

```bash
git status                              # ALWAYS check first
git stash save "WIP: what I was doing"  # If uncommitted changes exist
```

---

## Safety Rules

### 1. "Clear the view" ≠ Delete from database

When asked to "clear", "clean up", or "hide" data:
- **Assume they mean filter the UI** (add WHERE clause)
- Before ANY delete: `SELECT COUNT(*)` and ask for confirmation
- Prefer soft delete: `is_archived` flag

### 2. API failures must be visible

```typescript
// WRONG - silent fallback
if (res.ok) setData(await res.json());

// RIGHT - visible failure
if (!res.ok) throw new Error(`API failed: ${res.status}`);
```

### 3. Critical operations always run

```typescript
// WRONG - conditional critical path
if (condition) await computeMetrics();

// RIGHT - always run, log outcome
const { error } = await computeMetrics();
console.log(error ? `Failed: ${error}` : "Success");
```

---

## Architecture

### Data Flow

```
External APIs → Cron Jobs (vercel.json) → Supabase → API Routes → React
```

### Dashboards

| Area | Route | API | Component |
|------|-------|-----|-----------|
| Inventory | `/inventory` | `/api/inventory` | `InventoryDashboard.tsx` |
| Fulfillment | `/fulfillment` | `/api/metrics` | `FulfillmentDashboard.tsx` |
| Production | `/production` | `/api/assembly` | `AssemblyDashboard.tsx` |
| Prod Planning | `/production-planning` | `/api/production-planning` | `ProductionPlanningDashboardV2.tsx` |
| Restoration | `/restoration` | `/api/restorations` | `RestorationOperations.tsx` |
| Sales (B2B) | `/sales` | `/api/wholesale` | `WholesaleDashboard.tsx` |
| Door Health | `/sales/door-health` | `/api/door-health` | `DoorHealthDashboard.tsx` |
| Leads | `/sales/leads` | `/api/leads` | `LeadsDashboard.tsx` |
| Marketing | `/marketing` | `/api/klaviyo` | `KlaviyoDashboard.tsx` |
| Paid Media | `/marketing/paid` | `/api/ads` | `PaidMediaDashboard.tsx` |
| VOC | `/voc` | `/api/tickets` | `VoiceOfCustomerDashboard.tsx` |
| Budget | `/budget` | `/api/budget` | `BudgetDashboard.tsx` |
| Revenue | `/revenue-tracker` | `/api/revenue-tracker` | `RevenueTrackerDashboard.tsx` |
| Ecommerce | `/ecommerce` | `/api/analytics` | `EcommerceAnalyticsDashboard.tsx` |
| Q4 Pace | `/holiday` | `/api/holiday` | `HolidayDashboard.tsx` |
| P&L | `/pl` | `/api/pl` | page component |

### External Integrations

| Source | Tables | Cron | Client |
|--------|--------|------|--------|
| Shopify | `orders`, `line_items` | `high-frequency-sync` (15m) | `lib/shopify.ts` |
| ShipHero | `shiphero_inventory` | `high-frequency-sync` (15m) | `lib/shiphero.ts` |
| NetSuite | `ns_wholesale_customers`, `ns_transactions`, `ns_line_items` | `sync-netsuite-*` (daily 6am) | `lib/netsuite.ts` |
| Klaviyo | `klaviyo_campaigns`, `klaviyo_flows` | `sync-klaviyo` (daily) | `lib/klaviyo.ts` |
| Meta Ads | `meta_campaigns`, `ad_daily_stats` | `sync-meta` (daily) | `lib/meta.ts` |
| Google Ads | `google_campaigns`, `ad_daily_stats` | `sync-google-ads` (daily) | `lib/google-ads.ts` |
| AfterShip | `restorations` | `sync-aftership-returns` | `lib/aftership.ts` |
| Re:amaze | `support_tickets` | `sync-reamaze` | `lib/reamaze.ts` |
| Typeform | `typeform_leads` | webhook | — |

### Key Files

| File | Purpose |
|------|---------|
| `lib/types.ts` | All TypeScript interfaces (1,800+ lines) |
| `lib/auth/permissions.ts` | Role definitions, tab access rules |
| `lib/auth/session.ts` | localStorage session management |
| `lib/auth/server.ts` | Server-side auth verification |
| `app/globals.css` | Design system CSS variables |
| `vercel.json` | Cron schedules + function timeouts |
| `supabase/migrations/` | 47 database migrations |

---

## Auth System

### Session Model
- **Storage**: localStorage (`smithey_warehouse_auth`)
- **Duration**: 30 days
- **Login**: PIN-based (`/api/auth/verify-pin`)

### Roles (8 total)

| Role | Access | Default Tab |
|------|--------|-------------|
| `admin` | All + admin panel | inventory |
| `exec` | All except production-planning | inventory |
| `ops1` | Operations dashboards (no revenue) | inventory |
| `ops2` | ops1 + revenue-tracker | inventory |
| `standard` | Most dashboards | inventory |
| `sales` | Sales-focused | sales |
| `fulfillment` | Restoration + inventory | restoration |
| `customer_service` | VOC + inventory + restoration | voc |

### Authorization Pattern

```typescript
// API routes - use server helpers
import { requireAuth, requireAdmin } from "@/lib/auth/server";

export async function GET(request: NextRequest) {
  const { session, error } = await requireAuth(request);
  if (error) return error;  // Returns 401/403
  // ... authorized logic
}
```

---

## Patterns

### Supabase Client

```typescript
// Server (API routes, server components)
import { createClient } from "@/lib/supabase/server";
const supabase = await createClient();

// Client (browser)
import { createClient } from "@/lib/supabase/client";
const supabase = createClient();

// Service (bypasses RLS - for crons/webhooks)
import { createServiceClient } from "@/lib/supabase/server";
const supabase = createServiceClient();
```

### Cron Job Structure

```typescript
// app/api/cron/sync-something/route.ts
import { verifyCronAuth } from "@/lib/cron-auth";
import { acquireLock, releaseLock } from "@/lib/cron-lock";

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lockAcquired = await acquireLock("sync-something");
  if (!lockAcquired) {
    return NextResponse.json({ message: "Already running" });
  }

  try {
    // ... sync logic
    return NextResponse.json({ success: true, synced: count });
  } finally {
    await releaseLock("sync-something");
  }
}
```

### Database Migrations

Location: `supabase/migrations/`
Naming: `YYYYMMDD_description.sql` (timestamp-based)

```sql
-- Always idempotent
CREATE TABLE IF NOT EXISTS table_name (...);
CREATE INDEX IF NOT EXISTS idx_name ON table_name(...);

-- Soft deletes preferred
ALTER TABLE table_name ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
```

---

## Business Rules

### Time Windows in Names

Always encode time window:
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
// Always check all three - legacy data has inconsistent flags
const isCorp = c.is_corporate_gifting === true ||
               c.category === "Corporate" ||
               c.category === "4";
```

Corporate excluded from B2B metrics (different buying patterns).

### Restoration SLA

- Clock starts: `delivered_to_warehouse_at`
- Target: 21 days to ship out
- Overdue: physically at Smithey AND > 21 days

### Defect SKUs

Pattern: `{SKU}-D` (e.g., `SMITH-CI-12FLAT-D`)

---

## Cron Jobs

**18/20 slots used** — check before adding: `grep -c '"path":' vercel.json`

| Frequency | Jobs |
|-----------|------|
| 15 min | `high-frequency-sync`, `sync-b2b` |
| Hourly | `sync-b2b-drafts`, `tracking/check` |
| Daily | NetSuite (6am), Klaviyo, Meta, Google Ads, Shopify stats |
| 2 hours | `sync-netsuite-assembly` |
| Weekly | `weekly-maintenance` (Sunday 2am) |

---

## Design System

See `DESIGN_SYSTEM.md` for colors, typography, component patterns.

Key points:
- CSS variables in `globals.css`, never hardcoded hex
- Status colors only for actual status
- Cards: `bg-bg-secondary rounded-xl border border-border/30 p-5`
- Tables: sticky headers + `scrollbar-thin`

---

## Environment

See `.env.local.example` for all required variables.

Key secrets:
- `SUPABASE_SERVICE_KEY` — bypasses RLS (crons, webhooks)
- `DASHBOARD_PIN` — login credential
- API keys for: NetSuite, Shopify, Klaviyo, ShipHero, Meta, Google Ads, AfterShip, Re:amaze
