# Smithey Warehouse Database Redesign Plan

**Version:** 1.0
**Date:** December 9, 2025
**Author:** Database Architecture Team
**Status:** DRAFT - For Leadership Review

---

## Executive Summary

The Smithey Warehouse system has evolved organically from a simple dashboard into a mission-critical operations platform. This growth has exposed fundamental architectural limitations that, while manageable today, will become increasingly costly as data volumes scale.

### Current State
- **500K+ line items, 100K+ orders** - growing daily
- **228K row transfers** for budget calculations (identified performance bottleneck)
- **No referential integrity** - SKU stored as TEXT everywhere with no foreign keys
- **Hardcoded magic numbers** - warehouse IDs embedded in code
- **Duplicate data lookups** - display names fetched separately in every query
- **Missing indexes** on high-volume query patterns

### Strategic Recommendation

**Phase 1 (Immediate - 2 weeks):** Performance optimization through database functions and indexes - addresses the 228K row transfer problem and provides immediate relief.

**Phase 2 (Q1 2025 - 6 weeks):** Schema normalization with a products master table and foreign key relationships - establishes data integrity foundation.

**Phase 3 (Q2 2025 - 4 weeks):** Advanced optimization including materialized views, partitioning strategy, and real-time analytics infrastructure.

### Expected Outcomes
- 90%+ reduction in API response times for budget calculations
- Guaranteed data integrity through enforced relationships
- Foundation for 5M+ order scale
- Reduced maintenance burden and debugging time

---

## Table of Contents

1. [Current State Assessment](#1-current-state-assessment)
2. [Target Architecture](#2-target-architecture)
3. [Migration Strategy](#3-migration-strategy)
4. [Risk Matrix](#4-risk-matrix)
5. [Rollback Plan](#5-rollback-plan)
6. [Success Metrics](#6-success-metrics)
7. [Timeline and Resources](#7-timeline-and-resources)
8. [Appendices](#appendices)

---

## 1. Current State Assessment

### 1.1 Database Tables Overview

| Table | Rows (Est.) | Purpose | Issues Identified |
|-------|-------------|---------|-------------------|
| `orders` | 100K+ | Shopify order headers | warehouse as TEXT, no FK to products |
| `line_items` | 500K+ | Order line items | SKU as TEXT, no FK, duplicate lookups |
| `products` | ~75 | Product master | Underutilized - no FKs reference it |
| `inventory` | ~225 | Current stock levels | warehouse_id as INT (magic number) |
| `budgets` | ~900 | Monthly budget targets | SKU as TEXT, no FK |
| `b2b_fulfilled` | ~5K | Wholesale orders | SKU as TEXT, no FK |
| `shipments` | ~50K | Tracking data | order_id references orders |
| `forecasts` | ~900 | Sales forecasts | SKU as TEXT, no FK |
| `assembly_*` | ~1K | Manufacturing tracking | SKU as TEXT, no FK |
| `holiday_daily` | ~100 | YoY comparison | Standalone table |

### 1.2 Critical Pain Points

#### 1.2.1 The 228K Row Problem (Budget API)

```typescript
// Current implementation in app/api/budget/route.ts
const PAGE_SIZE = 50000;
const retailData: Array<{ sku: string | null; quantity: number }> = [];
let offset = 0;
let hasMore = true;

while (hasMore) {
  const { data: page } = await supabase
    .from("line_items")
    .select(`sku, quantity, orders!inner(created_at, canceled)`)
    .gte("orders.created_at", start)
    .lte("orders.created_at", end)
    .eq("orders.canceled", false)
    .range(offset, offset + PAGE_SIZE - 1);
  // ... transfers ALL rows to application server for aggregation
}
```

**Impact:**
- Network transfer: ~10MB per YTD request
- Latency: 3-5 seconds for full year queries
- Memory pressure on Vercel Edge Functions
- Cost: Supabase bandwidth charges scale with data volume

**Root Cause:** Aggregation happens in JavaScript instead of PostgreSQL.

#### 1.2.2 Missing Referential Integrity

```sql
-- Current: SKU stored as inconsistent TEXT
SELECT DISTINCT lower(sku) FROM line_items LIMIT 10;
-- Returns: 'smith-ci-skil12', 'Smith-CI-Skil12', 'SMITH-CI-SKIL12', etc.

-- No foreign key enforcement
INSERT INTO line_items (sku, quantity) VALUES ('typo-sku', 1);
-- Succeeds! Creates orphaned data
```

**Impact:**
- Case sensitivity bugs in reporting
- Orphaned records possible
- No cascading deletes/updates
- Manual data cleanup required

#### 1.2.3 Hardcoded Warehouse IDs

```typescript
// Appears in multiple files
const WAREHOUSE_IDS = {
  pipefitter: 120758,  // Magic number
  hobson: 77373,       // Magic number
  selery: 93742,       // Magic number
};
```

**Impact:**
- Code changes required if warehouse IDs change
- No single source of truth
- Inconsistent references across codebase

#### 1.2.4 Duplicate Display Name Lookups

```typescript
// Every API that needs display names does this:
const { data: productsData } = await supabase
  .from("products")
  .select("sku, display_name, category");

// Then manually joins in JavaScript
const productMap = new Map(
  productsData?.map((p) => [p.sku, { displayName: p.display_name }])
);
```

**Impact:**
- N+1 query pattern
- Wasted network round-trips
- Inconsistent join logic across APIs

### 1.3 Current Entity Relationships (Informal)

```
           +-------------+
           |   products  |
           | (orphaned)  |
           +-------------+
                  |
                  | (no FK - just SKU text matching)
                  v
+--------+  +-----------+  +----------+  +----------+
| orders |->| line_items|  | inventory|  |  budgets |
+--------+  +-----------+  +----------+  +----------+
    |             |             |             |
    | id          | sku (TEXT)  | sku (TEXT)  | sku (TEXT)
    |             |             |             |
    v             |             |             |
+----------+      |             |             |
| shipments|      +-------------+-------------+
+----------+              |
                          | (no referential integrity)
                          v
                    [disconnected]
```

---

## 2. Target Architecture

### 2.1 Design Principles

1. **Single Source of Truth:** Products table becomes the authoritative master
2. **Enforced Relationships:** Foreign keys with appropriate cascade rules
3. **Compute at the Database:** Aggregations via PostgreSQL functions
4. **Immutable History:** Audit trails for critical business data
5. **Horizontal Scalability:** Design for partitioning from day one

### 2.2 Target Schema

#### 2.2.1 Core Reference Tables

```sql
-- Warehouses: Single source of truth for warehouse data
CREATE TABLE warehouses (
  id INTEGER PRIMARY KEY,           -- ShipHero warehouse ID
  code VARCHAR(20) UNIQUE NOT NULL, -- 'pipefitter', 'hobson', 'selery'
  name VARCHAR(100) NOT NULL,       -- 'Pipefitter HQ', 'Hobson', 'Selery'
  shiphero_id VARCHAR(50),          -- Base64 encoded ShipHero ID
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed data
INSERT INTO warehouses (id, code, name, shiphero_id) VALUES
  (120758, 'pipefitter', 'Pipefitter HQ', 'V2FyZWhvdXNlOjEyMDc1OA=='),
  (77373, 'hobson', 'Hobson', 'V2FyZWhvdXNlOjc3Mzcz'),
  (93742, 'selery', 'Selery', 'V2FyZWhvdXNlOjkzNzQy');

-- Products: Enhanced master table
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku VARCHAR(50) UNIQUE NOT NULL,          -- Canonical SKU (normalized)
  display_name VARCHAR(100) NOT NULL,
  category product_category NOT NULL,        -- ENUM type
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,              -- For UI ordering
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Category enum for type safety
CREATE TYPE product_category AS ENUM (
  'cast_iron',
  'carbon_steel',
  'accessory',
  'glass_lid',
  'factory_second'
);

-- SKU aliases: Handle case variations from external systems
CREATE TABLE sku_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alias_sku VARCHAR(50) UNIQUE NOT NULL,    -- e.g., 'Smith-CI-TradSkil14' (wrong case)
  canonical_sku VARCHAR(50) NOT NULL REFERENCES products(sku),
  source VARCHAR(50),                        -- 'shiphero', 'shopify', 'manual'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast alias resolution
CREATE INDEX idx_sku_aliases_lower ON sku_aliases(lower(alias_sku));
```

#### 2.2.2 Transactional Tables with Foreign Keys

```sql
-- Orders: Add proper warehouse reference
ALTER TABLE orders
  ADD COLUMN warehouse_id INTEGER REFERENCES warehouses(id),
  ADD CONSTRAINT fk_orders_warehouse
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id);

-- Migrate existing data
UPDATE orders o SET warehouse_id = w.id
FROM warehouses w WHERE lower(o.warehouse) = w.code;

-- Line items: Add product reference
ALTER TABLE line_items
  ADD COLUMN product_id UUID REFERENCES products(id);

-- Migrate existing data (with alias resolution)
UPDATE line_items li SET product_id = p.id
FROM products p
WHERE lower(li.sku) = lower(p.sku);

-- Also check aliases
UPDATE line_items li SET product_id = p.id
FROM sku_aliases a
JOIN products p ON a.canonical_sku = p.sku
WHERE lower(li.sku) = lower(a.alias_sku)
  AND li.product_id IS NULL;

-- Inventory: Add proper foreign keys
ALTER TABLE inventory
  ADD CONSTRAINT fk_inventory_product
    FOREIGN KEY (sku) REFERENCES products(sku),
  ADD CONSTRAINT fk_inventory_warehouse
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id);

-- Budgets: Add product reference
ALTER TABLE budgets
  ADD COLUMN product_id UUID REFERENCES products(id);

UPDATE budgets b SET product_id = p.id
FROM products p WHERE lower(b.sku) = lower(p.sku);
```

#### 2.2.3 Aggregation Functions (Replaces 228K Row Transfers)

```sql
-- Budget actuals aggregation function
CREATE OR REPLACE FUNCTION get_budget_actuals(
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS TABLE(
  sku TEXT,
  product_id UUID,
  display_name TEXT,
  category product_category,
  retail_qty BIGINT,
  b2b_qty BIGINT,
  total_qty BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH retail_sales AS (
    SELECT
      COALESCE(li.product_id, p.id) AS pid,
      SUM(li.quantity) AS qty
    FROM line_items li
    JOIN orders o ON li.order_id = o.id
    LEFT JOIN products p ON lower(li.sku) = lower(p.sku)
    WHERE o.created_at BETWEEN p_start_date AND p_end_date
      AND o.canceled = false
    GROUP BY COALESCE(li.product_id, p.id)
  ),
  b2b_sales AS (
    SELECT
      p.id AS pid,
      SUM(b.quantity) AS qty
    FROM b2b_fulfilled b
    JOIN products p ON lower(b.sku) = lower(p.sku)
    WHERE b.fulfilled_at BETWEEN p_start_date AND p_end_date
    GROUP BY p.id
  )
  SELECT
    p.sku,
    p.id AS product_id,
    p.display_name,
    p.category,
    COALESCE(r.qty, 0) AS retail_qty,
    COALESCE(b.qty, 0) AS b2b_qty,
    COALESCE(r.qty, 0) + COALESCE(b.qty, 0) AS total_qty
  FROM products p
  LEFT JOIN retail_sales r ON r.pid = p.id
  LEFT JOIN b2b_sales b ON b.pid = p.id
  WHERE p.is_active = true
    AND (COALESCE(r.qty, 0) + COALESCE(b.qty, 0)) > 0;
END;
$$ LANGUAGE plpgsql STABLE;

-- Usage from application:
-- const { data } = await supabase.rpc('get_budget_actuals', {
--   p_start_date: '2025-01-01',
--   p_end_date: '2025-12-31'
-- });
-- Returns ~40-50 rows instead of 228K raw line items
```

#### 2.2.4 Materialized Views for Real-Time Dashboards

```sql
-- Daily sales summary (refreshed hourly)
CREATE MATERIALIZED VIEW mv_daily_sales AS
SELECT
  DATE(o.created_at AT TIME ZONE 'America/New_York') AS sale_date,
  p.category,
  p.sku,
  p.display_name,
  w.code AS warehouse,
  COUNT(DISTINCT o.id) AS order_count,
  SUM(li.quantity) AS units_sold
FROM line_items li
JOIN orders o ON li.order_id = o.id
JOIN products p ON li.product_id = p.id
LEFT JOIN warehouses w ON o.warehouse_id = w.id
WHERE o.canceled = false
GROUP BY 1, 2, 3, 4, 5
WITH DATA;

-- Refresh strategy
CREATE UNIQUE INDEX idx_mv_daily_sales_pk
  ON mv_daily_sales(sale_date, sku, warehouse);

-- Scheduled refresh (via pg_cron or external scheduler)
-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_sales;

-- Inventory position with DOI
CREATE MATERIALIZED VIEW mv_inventory_position AS
SELECT
  p.sku,
  p.display_name,
  p.category,
  SUM(CASE WHEN i.warehouse_id = 120758 THEN i.available ELSE 0 END) AS pipefitter,
  SUM(CASE WHEN i.warehouse_id = 77373 THEN i.available ELSE 0 END) AS hobson,
  SUM(CASE WHEN i.warehouse_id = 93742 THEN i.available ELSE 0 END) AS selery,
  SUM(i.available) AS total_available,
  MAX(i.synced_at) AS last_synced
FROM products p
LEFT JOIN inventory i ON p.sku = i.sku
WHERE p.is_active = true
GROUP BY p.sku, p.display_name, p.category
WITH DATA;

CREATE UNIQUE INDEX idx_mv_inventory_pk ON mv_inventory_position(sku);
```

### 2.3 Target Entity Relationship Diagram

```
                    +-------------+
                    | warehouses  |
                    +-------------+
                          |
            +-------------+-------------+
            |                           |
            v                           v
      +-----------+               +------------+
      |  orders   |               | inventory  |
      +-----------+               +------------+
            |                           |
            | order_id                  | sku (FK)
            v                           |
      +-----------+                     |
      |line_items |---------------------+
      +-----------+         product_id  |
            |                    |      |
            v                    v      v
      +-----------+         +----------+
      | shipments |         | products |<-- (master)
      +-----------+         +----------+
                                  ^
            +----------+----------+----------+
            |          |          |          |
      +--------+ +----------+ +----------+ +------------+
      |budgets | |forecasts | |b2b_ful.  | |assembly_*  |
      +--------+ +----------+ +----------+ +------------+
```

---

## 3. Migration Strategy

### 3.1 Phase 1: Performance Optimization (Week 1-2)

**Goal:** Address immediate pain points without schema changes.

#### Step 1.1: Create Aggregation Functions

```sql
-- Create function without changing existing tables
CREATE OR REPLACE FUNCTION get_budget_actuals(
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
) RETURNS TABLE(...) -- as defined above

-- Create inventory summary function
CREATE OR REPLACE FUNCTION get_inventory_with_sales(
  p_lookback_days INTEGER DEFAULT 30
) RETURNS TABLE(...)
```

**Rollback:** Drop functions. No schema changes.

#### Step 1.2: Add Missing Indexes

```sql
-- High-impact indexes based on query patterns
CREATE INDEX CONCURRENTLY idx_line_items_order_id
  ON line_items(order_id);

CREATE INDEX CONCURRENTLY idx_line_items_sku_lower
  ON line_items(lower(sku));

CREATE INDEX CONCURRENTLY idx_orders_created_at_canceled
  ON orders(created_at) WHERE canceled = false;

CREATE INDEX CONCURRENTLY idx_orders_fulfilled_at
  ON orders(fulfilled_at) WHERE fulfilled_at IS NOT NULL;

CREATE INDEX CONCURRENTLY idx_orders_warehouse_status
  ON orders(warehouse, fulfillment_status) WHERE canceled = false;

CREATE INDEX CONCURRENTLY idx_b2b_fulfilled_date
  ON b2b_fulfilled(fulfilled_at);
```

**Rollback:** Drop indexes. No data impact.

#### Step 1.3: Update API Endpoints

```typescript
// Before: 228K row transfer
const retailData = await paginatedFetch(...);
const aggregated = retailData.reduce(...);

// After: ~50 row transfer
const { data } = await supabase.rpc('get_budget_actuals', {
  p_start_date: start,
  p_end_date: end
});
```

**Rollback:** Revert code changes. Functions remain available.

### 3.2 Phase 2: Schema Normalization (Week 3-8)

**Goal:** Establish referential integrity and single source of truth.

#### Step 2.1: Create Reference Tables (Week 3)

```sql
-- Warehouses table
CREATE TABLE warehouses (...);
INSERT INTO warehouses (id, code, name, shiphero_id) VALUES (...);

-- SKU aliases table
CREATE TABLE sku_aliases (...);

-- Populate aliases from known variations
INSERT INTO sku_aliases (alias_sku, canonical_sku, source)
SELECT DISTINCT
  li.sku AS alias_sku,
  p.sku AS canonical_sku,
  'historical' AS source
FROM line_items li
JOIN products p ON lower(li.sku) = lower(p.sku)
WHERE li.sku != p.sku;  -- Case doesn't match
```

**Rollback:** Drop new tables.

#### Step 2.2: Add New Columns (Week 4)

```sql
-- Add nullable columns (no constraint yet)
ALTER TABLE orders ADD COLUMN warehouse_id INTEGER;
ALTER TABLE line_items ADD COLUMN product_id UUID;
ALTER TABLE budgets ADD COLUMN product_id UUID;
ALTER TABLE inventory ADD COLUMN product_id UUID;
```

**Rollback:** Drop columns.

#### Step 2.3: Backfill Data (Week 5)

```sql
-- Backfill in batches to avoid long locks
DO $$
DECLARE
  batch_size INTEGER := 10000;
  affected INTEGER;
BEGIN
  LOOP
    UPDATE orders o
    SET warehouse_id = w.id
    FROM warehouses w
    WHERE lower(o.warehouse) = w.code
      AND o.warehouse_id IS NULL
    LIMIT batch_size;

    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;

    COMMIT;
    PERFORM pg_sleep(0.1);  -- Prevent lock contention
  END LOOP;
END $$;

-- Similar for line_items, budgets, etc.
```

**Rollback:** Set new columns to NULL.

#### Step 2.4: Add Foreign Key Constraints (Week 6)

```sql
-- Add constraints with NOT VALID for instant creation
ALTER TABLE orders
  ADD CONSTRAINT fk_orders_warehouse
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
  NOT VALID;

-- Validate in background (doesn't block writes)
ALTER TABLE orders VALIDATE CONSTRAINT fk_orders_warehouse;

-- Repeat for other tables
```

**Rollback:** Drop constraints.

#### Step 2.5: Update Application Code (Week 7)

```typescript
// Update sync scripts to use new columns
// Update API routes to join via product_id
// Update types to include new fields
```

**Rollback:** Revert code changes.

#### Step 2.6: Deprecate Old Columns (Week 8)

```sql
-- Add trigger to keep old columns in sync during transition
CREATE OR REPLACE FUNCTION sync_warehouse_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.warehouse_id IS NOT NULL AND NEW.warehouse IS NULL THEN
    SELECT code INTO NEW.warehouse FROM warehouses WHERE id = NEW.warehouse_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Mark columns for future removal (comments)
COMMENT ON COLUMN orders.warehouse IS 'DEPRECATED: Use warehouse_id instead';
```

### 3.3 Phase 3: Advanced Optimization (Week 9-12)

**Goal:** Scale infrastructure for 5M+ orders.

#### Step 3.1: Materialized Views

```sql
CREATE MATERIALIZED VIEW mv_daily_sales AS (...);
CREATE MATERIALIZED VIEW mv_inventory_position AS (...);

-- Set up refresh schedule (via Supabase Edge Function or cron)
```

#### Step 3.2: Table Partitioning (For Future Scale)

```sql
-- Partition line_items by year (when approaching 2M+ rows)
CREATE TABLE line_items_partitioned (
  LIKE line_items INCLUDING ALL
) PARTITION BY RANGE (created_at);

CREATE TABLE line_items_2024 PARTITION OF line_items_partitioned
  FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');

CREATE TABLE line_items_2025 PARTITION OF line_items_partitioned
  FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

-- Migration strategy: Create new partitioned table, migrate data, rename
```

#### Step 3.3: Real-Time Analytics (Supabase Realtime)

```sql
-- Enable realtime on key tables
ALTER PUBLICATION supabase_realtime ADD TABLE orders;
ALTER PUBLICATION supabase_realtime ADD TABLE inventory;

-- Consider Supabase Edge Functions for real-time aggregations
```

---

## 4. Risk Matrix

| Risk | Probability | Impact | Mitigation | Contingency |
|------|-------------|--------|------------|-------------|
| **Schema migration causes downtime** | Low | High | Use non-blocking operations (CONCURRENTLY), batch updates | Immediate rollback procedure documented |
| **Foreign key constraint fails validation** | Medium | Medium | Run validation queries before adding constraints | Clean orphaned data, then retry |
| **Performance regression during migration** | Medium | Medium | Monitor query times, A/B test with feature flags | Revert to old code path |
| **Data inconsistency during backfill** | Low | High | Run in transaction batches, validate counts | Full re-backfill from backup |
| **Supabase function limits exceeded** | Low | Medium | Test with production data volumes | Fall back to pagination approach |
| **Application code breaks with schema changes** | Medium | High | Comprehensive test suite, staging environment | Feature flags for code paths |

### 4.1 Risk Mitigation Details

#### Orphaned Data Detection

Before adding foreign keys, identify and resolve orphaned records:

```sql
-- Find line_items with SKUs not in products
SELECT DISTINCT li.sku, COUNT(*) as count
FROM line_items li
LEFT JOIN products p ON lower(li.sku) = lower(p.sku)
WHERE p.id IS NULL
GROUP BY li.sku
ORDER BY count DESC;

-- Resolution options:
-- 1. Add missing products
-- 2. Map to existing products via aliases
-- 3. Archive orphaned records
```

#### Performance Monitoring

```sql
-- Before migration: capture baseline
SELECT
  relname AS table_name,
  n_tup_ins AS inserts,
  n_tup_upd AS updates,
  n_tup_del AS deletes,
  seq_scan,
  idx_scan
FROM pg_stat_user_tables
WHERE relname IN ('orders', 'line_items', 'inventory');

-- Monitor during migration
SELECT
  query,
  calls,
  mean_time,
  total_time
FROM pg_stat_statements
WHERE query LIKE '%line_items%'
ORDER BY total_time DESC
LIMIT 20;
```

---

## 5. Rollback Plan

### 5.1 Phase 1 Rollback (Low Risk)

```sql
-- Drop functions (no data impact)
DROP FUNCTION IF EXISTS get_budget_actuals;
DROP FUNCTION IF EXISTS get_inventory_with_sales;

-- Drop indexes (no data impact)
DROP INDEX IF EXISTS idx_line_items_order_id;
DROP INDEX IF EXISTS idx_line_items_sku_lower;
-- etc.
```

**Time to rollback:** 5 minutes
**Data loss:** None

### 5.2 Phase 2 Rollback (Medium Risk)

```sql
-- Remove foreign key constraints
ALTER TABLE orders DROP CONSTRAINT IF EXISTS fk_orders_warehouse;
ALTER TABLE line_items DROP CONSTRAINT IF EXISTS fk_line_items_product;
-- etc.

-- Drop new columns (optional - can leave for future use)
ALTER TABLE orders DROP COLUMN IF EXISTS warehouse_id;
ALTER TABLE line_items DROP COLUMN IF EXISTS product_id;
-- etc.

-- Drop new tables
DROP TABLE IF EXISTS sku_aliases;
DROP TABLE IF EXISTS warehouses;
```

**Time to rollback:** 15 minutes
**Data loss:** New columns only (original data preserved)

### 5.3 Phase 3 Rollback (Higher Risk)

```sql
-- Drop materialized views
DROP MATERIALIZED VIEW IF EXISTS mv_daily_sales;
DROP MATERIALIZED VIEW IF EXISTS mv_inventory_position;

-- Partitioned tables require careful migration back
-- Document specific procedure based on implementation
```

**Time to rollback:** 30-60 minutes
**Data loss:** Materialized view data (can be regenerated)

### 5.4 Emergency Procedures

```bash
# Full database restore from Supabase backup
# Access via Supabase Dashboard > Database > Backups

# Point-in-time recovery available for Pro/Team plans
# Supabase retains 7 days of backups
```

---

## 6. Success Metrics

### 6.1 Performance KPIs

| Metric | Current | Phase 1 Target | Phase 3 Target |
|--------|---------|----------------|----------------|
| Budget API response time (YTD) | 3-5 seconds | < 500ms | < 200ms |
| Inventory API response time | 800ms | < 300ms | < 100ms |
| Daily metrics API | 1.5 seconds | < 800ms | < 400ms |
| Data transfer per budget request | ~10MB | < 50KB | < 20KB |

### 6.2 Data Integrity KPIs

| Metric | Current | Target |
|--------|---------|--------|
| Orphaned line_items (no matching product) | Unknown | 0 |
| SKU case inconsistencies | ~15 variations | 0 (via aliases) |
| Warehouse ID mismatches | Possible | 0 (FK enforced) |

### 6.3 Operational KPIs

| Metric | Current | Target |
|--------|---------|--------|
| Lines of display name lookup code | ~50 across APIs | 0 (via joins) |
| Hardcoded warehouse IDs | 6+ locations | 0 |
| Manual data cleanup frequency | Monthly | Never |

### 6.4 Measurement Plan

```sql
-- Weekly performance check
SELECT
  'budget_api' AS endpoint,
  AVG(duration_ms) AS avg_response,
  MAX(duration_ms) AS max_response,
  COUNT(*) AS request_count
FROM api_logs
WHERE endpoint = '/api/budget'
  AND created_at > NOW() - INTERVAL '7 days';

-- Data integrity check
SELECT
  'orphaned_line_items' AS check,
  COUNT(*) AS count
FROM line_items li
LEFT JOIN products p ON li.product_id = p.id
WHERE li.product_id IS NULL
  AND li.sku IS NOT NULL;
```

---

## 7. Timeline and Resources

### 7.1 Phase 1: Performance Optimization

**Duration:** 2 weeks
**Resources:** 1 developer (part-time)

| Week | Task | Deliverable |
|------|------|-------------|
| 1 | Create aggregation functions | `get_budget_actuals`, `get_inventory_with_sales` |
| 1 | Add performance indexes | 6 new indexes |
| 2 | Update budget API | Response time < 500ms |
| 2 | Update inventory API | Response time < 300ms |
| 2 | Testing and monitoring | Performance validation report |

### 7.2 Phase 2: Schema Normalization

**Duration:** 6 weeks
**Resources:** 1 developer (full-time), 1 developer (code review)

| Week | Task | Deliverable |
|------|------|-------------|
| 3 | Create reference tables | `warehouses`, `sku_aliases` tables |
| 4 | Add new columns | `warehouse_id`, `product_id` columns |
| 5 | Backfill data | All new columns populated |
| 6 | Add foreign keys | Referential integrity enforced |
| 7 | Update application code | All APIs use new schema |
| 8 | Deprecation and cleanup | Old columns marked, documentation updated |

### 7.3 Phase 3: Advanced Optimization

**Duration:** 4 weeks
**Resources:** 1 developer (part-time)

| Week | Task | Deliverable |
|------|------|-------------|
| 9 | Materialized views | Daily sales, inventory position views |
| 10 | Refresh scheduling | Automated hourly refresh |
| 11 | Partitioning assessment | Partition strategy document |
| 12 | Real-time infrastructure | Supabase Realtime configuration |

### 7.4 Total Investment

| Phase | Developer Hours | Calendar Time | Risk Level |
|-------|-----------------|---------------|------------|
| Phase 1 | 20-30 | 2 weeks | Low |
| Phase 2 | 80-100 | 6 weeks | Medium |
| Phase 3 | 30-40 | 4 weeks | Low-Medium |
| **Total** | **130-170** | **12 weeks** | - |

---

## Appendices

### Appendix A: Current Table Schemas

```sql
-- products (current)
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- orders (current)
CREATE TABLE orders (
  id BIGINT PRIMARY KEY,  -- Shopify order ID
  order_name TEXT,
  warehouse TEXT,         -- 'smithey' or 'selery'
  fulfillment_status TEXT,
  canceled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ,
  fulfilled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- line_items (current)
CREATE TABLE line_items (
  id BIGINT PRIMARY KEY,  -- Shopify line item ID
  order_id BIGINT REFERENCES orders(id),
  sku TEXT,
  title TEXT,
  quantity INTEGER,
  fulfilled_quantity INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- inventory (current)
CREATE TABLE inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT NOT NULL,
  warehouse_id INTEGER NOT NULL,
  on_hand INTEGER DEFAULT 0,
  available INTEGER DEFAULT 0,
  reserved INTEGER DEFAULT 0,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sku, warehouse_id)
);
```

### Appendix B: Query Performance Analysis

**Top 5 Slowest Queries (from pg_stat_statements):**

1. Budget API - YTD line items scan: ~3.2s avg
2. Daily metrics - order aging calculation: ~1.8s avg
3. Inventory API - monthly sales aggregation: ~1.2s avg
4. SKU queue - unfulfilled items join: ~0.9s avg
5. Transit analytics - shipment join: ~0.7s avg

### Appendix C: Supabase-Specific Considerations

**Row Limits:**
- Default select limit: 1000 rows
- Maximum with pagination: Unlimited (with performance cost)
- RPC function results: No row limit

**RLS (Row Level Security):**
- Currently disabled on all tables
- Consider enabling for multi-tenant future
- Service role key bypasses RLS

**Realtime:**
- Available for all tables
- Consider for inventory updates
- May impact write performance

**Edge Functions:**
- Alternative to RPC for complex logic
- TypeScript/Deno runtime
- 50ms cold start typical

### Appendix D: SKU Normalization Rules

```typescript
// Canonical SKU format: 'Smith-XX-Name' with specific casing
const SKU_CANONICAL = {
  'smith-ci-skil12': 'Smith-CI-Skil12',    // Cast iron 12" traditional
  'smith-ci-tradskil14': 'Smith-CI-TradSkil14',  // Note: TradSkil not Tradskil
  'smith-cs-rroastm': 'Smith-CS-RroastM',  // Carbon steel round roaster
  // ... full mapping in lib/shiphero.ts
};

// Resolution function
function normalizesku(rawSku: string): string {
  return SKU_CANONICAL[rawSku.toLowerCase()] || rawSku;
}
```

### Appendix E: Index Strategy Rationale

| Index | Query Pattern | Estimated Improvement |
|-------|--------------|----------------------|
| `idx_line_items_order_id` | Join to orders | 10x for order details |
| `idx_line_items_sku_lower` | SKU aggregations | 5x for budget calcs |
| `idx_orders_created_at_canceled` | Date range + filter | 3x for daily queries |
| `idx_orders_fulfilled_at` | Fulfillment analytics | 4x for lead time |
| `idx_orders_warehouse_status` | Queue counts | 8x for metrics |
| `idx_b2b_fulfilled_date` | B2B aggregations | 3x for budget |

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-12-09 | Database Architecture | Initial draft |

---

**Next Steps:**

1. Review and approve this plan
2. Schedule Phase 1 implementation
3. Set up monitoring for baseline metrics
4. Create staging environment for testing

**Questions for Leadership:**

1. Is the 12-week timeline acceptable, or should we accelerate?
2. Should Phase 2 (schema changes) wait until after Q4 peak season?
3. Are there additional APIs or reports we should prioritize?
