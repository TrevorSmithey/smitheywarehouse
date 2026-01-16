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

# 3. Check for unlimited Supabase queries (Pattern E - causes silent data loss)
grep -rn "\.from(" app/api/ | grep "\.select(" | grep -v ".limit(" | head -10
# If ANY results appear, add .limit(QUERY_LIMITS.X) before committing!

# 4. Only then commit
git add <files>
git commit -m "message"
```

**If validation fails:** Fix the errors. Do not commit broken code.

**If validation can't run:** Tell the user and do not proceed until resolved.

**If grep finds unlimited queries:** Add explicit limits from `QUERY_LIMITS` in `lib/constants.ts`. This is non-negotiable - unlimited queries cause silent data truncation.

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

## Data Integrity (HIGHEST PRIORITY)

**This is the operational hub for a $100M enterprise. Data integrity is non-negotiable. Silent failures are the enemy — half of historical PRs have been fixing them.**

### The Prime Directive: No Silent Failures

Every operation must either:
1. **Succeed visibly** — Log success, update UI, confirm to user
2. **Fail loudly** — Throw error, log failure, alert user

There is no third option. Silent failures corrupt data and erode trust.

### The Second Directive: No Unlimited Queries

**Every Supabase `.from().select()` MUST have an explicit `.limit()` from `QUERY_LIMITS`.**

This is not optional. This is not "usually." This is ALWAYS.

Supabase silently returns only 1000 rows by default. No error. No warning. Just wrong data. This has caused 15+ bugs in this codebase.

```typescript
// WRONG - Silent truncation at 1000 rows (S332239 was invisible because of this)
const { data } = await supabase.from("restorations").select("*");

// RIGHT - Explicit limit + truncation detection
import { QUERY_LIMITS, checkQueryLimit } from "@/lib/constants";

const { data } = await supabase
  .from("restorations")
  .select("*")
  .limit(QUERY_LIMITS.RESTORATIONS);

checkQueryLimit(data?.length || 0, QUERY_LIMITS.RESTORATIONS, "restorations");
```

**Before writing ANY Supabase query:**
1. Check `lib/constants.ts` for existing limit constant
2. If none exists, add one with 3x current data volume headroom
3. Add `checkQueryLimit()` call after the query

**Quick verification:**
```bash
# Find queries missing limits - MUST return empty before commit
grep -rn "\.from(" app/api/ | grep "\.select(" | grep -v ".limit(" | head -10
```

### Pattern 1: API Calls Must Handle Failure

```typescript
// WRONG - silent fallback (data shows stale/default values, no one knows)
const res = await fetch("/api/data");
if (res.ok) setData(await res.json());
// ← What happens on 401/500? Silent stale data!

// RIGHT - visible failure
const res = await fetch("/api/data");
if (!res.ok) {
  console.error(`API failed: ${res.status}`);
  throw new Error(`Failed to fetch data: ${res.status}`);
}
setData(await res.json());
```

### Pattern 2: Critical Operations Always Run

```typescript
// WRONG - conditional critical path (operation silently skipped)
if (!stoppedEarly) {
  await computeMetrics();  // ← Never runs if stoppedEarly=true
}

// RIGHT - always run, log outcome
const { error } = await computeMetrics();
if (error) {
  console.error("[METRICS] Failed:", error);
  // Decide: throw, retry, or alert — but NEVER ignore
} else {
  console.log("[METRICS] Computed successfully");
}
```

### Pattern 3: Database Operations Must Verify

```typescript
// WRONG - assume success
await supabase.from("table").update({ status: "done" });

// RIGHT - check result
const { error } = await supabase.from("table").update({ status: "done" });
if (error) {
  console.error("[DB] Update failed:", error.message);
  throw error;
}
```

### Pattern 4: Never Delete Without Confirmation

When asked to "clear", "clean up", or "hide" data:
- **Assume they mean filter the UI** (add WHERE clause)
- Before ANY delete: `SELECT COUNT(*)` and show the user what will be affected
- Prefer soft delete: `is_archived = true`, not `DELETE FROM`
- Production data represents months of business operations — treat it as precious

### Debugging: Check Network First

When data looks wrong, don't read code — observe the system:
1. Check browser DevTools → Network tab for 4xx/5xx errors
2. Check server logs for failed API calls
3. The network request is the truth; code can look correct and still fail

---

## Lessons from Git History (51% of commits are fixes)

These patterns caused real bugs. Learn from them.

### Pattern A: Data Filtering Edge Cases

Many bugs came from not filtering edge cases:

```typescript
// BUG: $0 invoices counted as real orders (skewed metrics)
// FIX: WHERE foreign_total > 0

// BUG: Customers with 0 orders included in health metrics
// FIX: WHERE lifetime_orders > 0

// BUG: Corporate customers inconsistently excluded
// FIX: Always check is_corporate_gifting OR category='Corporate' OR category='4'

// BUG: Inactive customers included
// FIX: WHERE is_inactive = false
```

**Rule: When querying customer/transaction data, always consider:**
- Zero-dollar transactions (credits, adjustments)
- Customers with no orders
- Corporate vs standard B2B
- Active vs inactive status

### Pattern B: Cross-View Inconsistency

Same metric showing different numbers on different pages:

```
Door Health: 121 churned customers
Wholesale: 65 churned customers
← Same time period, same data source, different filters!
```

**Rule: Same metric = same calculation.** If two views show "churned customers":
- Use the same SQL/function
- Apply the same filters
- If they must differ, name them differently (`churned_all` vs `churned_active`)

### Pattern C: Missing Auth Headers

```typescript
// BUG: Fetch without auth headers → 401 → silent fallback to defaults
const res = await fetch("/api/config");

// FIX: Always include auth headers
const res = await fetch("/api/config", {
  headers: getAuthHeaders()
});
```

### Pattern D: Conditional Critical Paths

```typescript
// BUG: compute_customer_metrics() wrapped in condition
// Result: Never ran when stoppedEarly=true (most runs!)
if (!stoppedEarly) {
  await supabase.rpc("compute_customer_metrics");
}
```

**Rule: If an operation is critical, it runs unconditionally.**

### Pattern E: Row Limit Truncation (15+ historical bugs)

Supabase defaults to 1000 rows. Without explicit limits, data is silently truncated.

```typescript
// BUG: Silent truncation — Supabase returns max 1000 rows
const { data } = await supabase.from("orders").select("*");
// 15,000 orders exist, but only 1000 returned. No error!

// FIX: Explicit limit + truncation check
import { QUERY_LIMITS, checkQueryLimit } from "@/lib/constants";

const { data, count } = await supabase
  .from("orders")
  .select("*", { count: "exact" })
  .limit(QUERY_LIMITS.LEAD_TIME);

if (count) checkQueryLimit(data?.length || 0, QUERY_LIMITS.LEAD_TIME, "orders");
```

**Rule: All Supabase queries must have explicit limits from `lib/constants.ts`.**

### Pattern F: Timezone / Date Handling (12+ historical bugs)

Business logic runs on EST. JavaScript Date defaults to local/UTC. DST causes off-by-one errors.

```typescript
// BUG: Assumes UTC — date is wrong during EST business hours
const today = new Date().toISOString().split("T")[0];

// FIX: Explicit EST for business date boundaries
const estNow = new Date().toLocaleString("en-US", {
  timeZone: "America/New_York"
});
const today = new Date(estNow).toISOString().split("T")[0];
```

```typescript
// BUG: DST transition causes date shift
const dayStart = new Date(dateStr);
dayStart.setHours(0, 0, 0, 0);

// FIX: Use date string directly, don't manipulate Date objects
const dayStart = dateStr; // Keep as ISO string "2025-03-09"
```

**Rule: Use ISO date strings for storage/comparison. Only convert to Date for display.**

### Pattern G: SKU Case Sensitivity (8+ historical bugs)

NetSuite sends `SMITH-CI-12FLAT`, Shopify sends `Smith-CI-12Flat`, ShipHero sends `smith-ci-12flat`.

```typescript
// BUG: Direct comparison fails
if (sku === "SMITH-CI-12FLAT") { ... }

// FIX: Normalize before comparison
if (sku.toUpperCase() === "SMITH-CI-12FLAT") { ... }

// BETTER: Normalize at data ingestion
const normalizedSku = rawSku.toUpperCase();
```

**Rule: Always normalize SKUs to uppercase before comparison or storage.**

### Pattern H: NetSuite Type Coercion (5+ historical bugs)

NetSuite's SuiteQL API returns all numbers as strings in JSON responses. This breaks Set/Map lookups and comparisons.

```typescript
// BUG: Set.has() fails - comparing string "152858" to number 152858
const existingIds = new Set(dbRecords.map(r => r.id)); // numbers
const newRecord = nsResponse[0]; // { id: "152858" } - string!
if (existingIds.has(newRecord.id)) { ... } // Always false!

// FIX: Convert to Number() immediately after fetching
const customers = nsResponse.map(c => ({
  ...c,
  id: Number(c.id),
  parent_id: c.parent_id ? Number(c.parent_id) : null,
}));
```

**Rule: Always convert NetSuite numeric fields with `Number()` before any comparison or storage.**

### Pattern I: NetSuite Pagination (3+ historical bugs)

SuiteQL completely ignores OFFSET clauses. Using OFFSET causes infinite loops returning the same records.

```typescript
// BUG: OFFSET ignored — fetches same 1000 records forever
let offset = 0;
while (true) {
  const batch = await fetchCustomers(offset, 1000);
  offset += 1000; // SuiteQL ignores this!
}

// FIX: Cursor-based pagination using WHERE id > lastId
let lastId = 0;
while (true) {
  const batch = await fetchCustomers(lastId, 1000);
  if (batch.length === 0) break;
  lastId = Math.max(...batch.map(r => r.id));
}
```

**Rule: NetSuite syncs MUST use cursor-based pagination (`WHERE id > :lastId`), never OFFSET.**

### Pattern J: Foreign Key Timing in Syncs (4+ historical bugs)

Child records (line items) may reference parent records (transactions) that haven't synced yet, causing FK violations.

```typescript
// BUG: Entire batch fails if one FK is missing
const { error } = await supabase.from("line_items").upsert(batch);
// error: "violates foreign key constraint" — 999 good records lost!

// FIX: Graceful degradation - save what you can
const { error } = await supabase.from("line_items").upsert(batch);
if (error?.code === "23503") { // FK violation
  // Fall back to individual inserts, skip failures
  for (const item of batch) {
    await supabase.from("line_items").upsert(item).catch(() => {});
  }
}
```

**Rule: Multi-table syncs must handle FK violations gracefully. Never let one bad record kill the batch.**

### Pattern K: Partial Data Today (8+ historical bugs)

Charts showing "today" are misleading because the day isn't complete. YoY comparisons become unfair.

```typescript
// BUG: Today shows 50% of yesterday's value (day is half over)
const dailyData = data.filter(d => d.date <= today);

// FIX: Exclude today, show only completed days
const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);
const dailyData = data.filter(d => d.date <= yesterday.toISOString().split("T")[0]);
```

```typescript
// BUG: Cumulative chart shows current year losing because today is partial
// FIX: Both years stop at same completed day
const lastCompleteDay = Math.min(currentYearLastDay, priorYearLastDay);
```

**Rule: Daily metrics exclude today. Cumulative YoY comparisons use same day count for both years.**

### Pattern L: External API Rate Limiting (3+ historical bugs)

External APIs (Klaviyo, Meta, Google Ads) return 429 with retry-after headers. Ignoring them causes sync failures.

```typescript
// BUG: Retry immediately, get banned
while (hasMore) {
  const res = await fetch(url);
  if (res.status === 429) continue; // Hammering the API!
}

// FIX: Respect retry-after header
if (res.status === 429) {
  const retryAfter = parseInt(res.headers.get("retry-after") || "60");
  console.log(`[Klaviyo] Rate limited, waiting ${retryAfter}s`);
  await new Promise(r => setTimeout(r, retryAfter * 1000));
  continue;
}
```

**Rule: Always check for 429 responses and respect `retry-after` headers.**

### Pattern M: Cron Slot Limits (5+ historical bugs)

Vercel has a **20 cron job limit**. Adding new crons without checking causes silent failures.

```bash
# Before adding ANY new cron:
grep -c '"path":' vercel.json  # Must be < 20
```

```typescript
// Pattern: Consolidate related syncs into one cron
// BEFORE: 3 separate crons
// sync-abandoned-checkouts (daily)
// sync-lead-conversions (daily)
// sync-daily-stats (daily)

// AFTER: 1 consolidated cron
// daily-snapshot (runs all three)
```

**Rule: Check `vercel.json` cron count before adding. Consolidate related syncs.**

### Pattern N: Split Shipments / Deduplication (4+ historical bugs)

One order can have multiple shipments. One customer can appear in multiple syncs. Always dedupe.

```typescript
// BUG: Order interval calculation counts each shipment as separate order
const intervals = transactions.map((t, i) => /* ... */);
// Customer with 1 order split into 3 shipments shows interval of 0 days!

// FIX: Dedupe by order number first
const uniqueOrders = [...new Map(transactions.map(t => [t.order_number, t])).values()];
```

```typescript
// BUG: Restoration sync processes same order multiple times
orders.forEach(order => processRestoration(order));

// FIX: Dedupe before processing
const uniqueOrders = [...new Map(orders.map(o => [o.id, o])).values()];
uniqueOrders.forEach(order => processRestoration(order));
```

**Rule: Any data that can have duplicates (syncs, multi-shipment orders) must be deduped before processing.**

### Pattern O: Supabase Missing Column Silent Failure (January 2026)

Supabase does NOT throw errors when selecting columns that don't exist. It silently returns `null`.

```typescript
// BUG: Column doesn't exist in database, but query "succeeds"
const { data } = await supabase
  .from("dashboard_users")
  .select("id, name, default_page_override")  // ← column doesn't exist!
  .single();

// data = { id: "abc", name: "Stephen", default_page_override: null }
// No error! Code looks correct, feature silently broken.
```

This caused a bug where user `default_page_override` was always ignored—the column had never been created via migration, but all code paths returned `null` without any error.

```typescript
// DETECTION: Query information_schema to verify column exists
const { data: columns } = await supabase
  .from("information_schema.columns")
  .select("column_name")
  .eq("table_name", "dashboard_users");

// Or check directly in Supabase dashboard → Table Editor → Schema
```

**Rule: When a feature silently doesn't work despite correct-looking code, verify the database schema actually has the columns you're querying. Supabase won't tell you they're missing.**

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

## Business Logic

See `BUSINESS_LOGIC.md` for domain-specific rules:
- Customer health thresholds (180/270/365 days)
- Customer segment revenue tiers ($1k/$5k/$20k/$50k)
- Corporate customer detection
- Restoration SLA (21 days)
- SKU patterns and defect codes
- B2B vs DTC filtering rules
- Revenue metric definitions (YTD/T12/MER)

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

