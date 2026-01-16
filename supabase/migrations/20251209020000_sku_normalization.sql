-- ============================================
-- SKU NORMALIZATION - PERMANENT DATABASE FIX
-- ============================================
--
-- This migration ensures SKU case consistency across all tables.
-- After this: "smith-ci-tradskil14" and "Smith-CI-TradSkil14"
-- will always resolve to the canonical casing.
--
-- Run: supabase db push
-- Or execute directly in Supabase SQL Editor

-- ============================================
-- PART 1: CANONICAL SKU LOOKUP TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS sku_canonical (
    sku_lower TEXT PRIMARY KEY,
    sku_canonical TEXT NOT NULL,
    category TEXT,
    display_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Populate from products table (source of truth for canonical casing)
INSERT INTO sku_canonical (sku_lower, sku_canonical, category, display_name)
SELECT LOWER(sku), sku, category, display_name
FROM products
WHERE sku IS NOT NULL
ON CONFLICT (sku_lower) DO UPDATE SET
    sku_canonical = EXCLUDED.sku_canonical,
    category = EXCLUDED.category,
    display_name = EXCLUDED.display_name;

-- ============================================
-- PART 2: NORMALIZATION FUNCTION
-- ============================================

CREATE OR REPLACE FUNCTION normalize_sku(input_sku TEXT)
RETURNS TEXT AS $$
DECLARE
    canonical TEXT;
BEGIN
    IF input_sku IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT sku_canonical INTO canonical
    FROM sku_canonical
    WHERE sku_lower = LOWER(input_sku);

    IF canonical IS NOT NULL THEN
        RETURN canonical;
    ELSE
        RETURN input_sku;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================
-- PART 3: CASE-INSENSITIVE UNIQUE INDEXES
-- ============================================
-- These prevent duplicate SKUs with different casing

-- Products: prevent case-duplicate SKUs
DROP INDEX IF EXISTS idx_products_sku_lower;
CREATE UNIQUE INDEX idx_products_sku_lower
ON products (LOWER(sku));

-- Budgets: prevent case-duplicate SKU+year+month
DROP INDEX IF EXISTS idx_budgets_sku_year_month_lower;
CREATE UNIQUE INDEX idx_budgets_sku_year_month_lower
ON budgets (LOWER(sku), year, month);

-- Inventory: prevent case-duplicate SKU+warehouse
DROP INDEX IF EXISTS idx_inventory_sku_warehouse_lower;
CREATE UNIQUE INDEX idx_inventory_sku_warehouse_lower
ON inventory (LOWER(sku), warehouse_id);

-- ============================================
-- PART 4: AUTO-NORMALIZATION TRIGGERS
-- ============================================

CREATE OR REPLACE FUNCTION trigger_normalize_sku()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.sku IS NOT NULL THEN
        NEW.sku := normalize_sku(NEW.sku);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Products table
DROP TRIGGER IF EXISTS trg_products_normalize_sku ON products;
CREATE TRIGGER trg_products_normalize_sku
    BEFORE INSERT OR UPDATE OF sku ON products
    FOR EACH ROW EXECUTE FUNCTION trigger_normalize_sku();

-- Budgets table
DROP TRIGGER IF EXISTS trg_budgets_normalize_sku ON budgets;
CREATE TRIGGER trg_budgets_normalize_sku
    BEFORE INSERT OR UPDATE OF sku ON budgets
    FOR EACH ROW EXECUTE FUNCTION trigger_normalize_sku();

-- Inventory table
DROP TRIGGER IF EXISTS trg_inventory_normalize_sku ON inventory;
CREATE TRIGGER trg_inventory_normalize_sku
    BEFORE INSERT OR UPDATE OF sku ON inventory
    FOR EACH ROW EXECUTE FUNCTION trigger_normalize_sku();

-- B2B Fulfilled table
DROP TRIGGER IF EXISTS trg_b2b_fulfilled_normalize_sku ON b2b_fulfilled;
CREATE TRIGGER trg_b2b_fulfilled_normalize_sku
    BEFORE INSERT OR UPDATE OF sku ON b2b_fulfilled
    FOR EACH ROW EXECUTE FUNCTION trigger_normalize_sku();

-- Line Items table
DROP TRIGGER IF EXISTS trg_line_items_normalize_sku ON line_items;
CREATE TRIGGER trg_line_items_normalize_sku
    BEFORE INSERT OR UPDATE OF sku ON line_items
    FOR EACH ROW EXECUTE FUNCTION trigger_normalize_sku();

-- ============================================
-- PART 5: UPDATE sku_canonical TRIGGER
-- ============================================
-- When products table is updated, sync to sku_canonical

CREATE OR REPLACE FUNCTION sync_sku_canonical()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        -- Don't delete from canonical - might be referenced elsewhere
        RETURN OLD;
    END IF;

    INSERT INTO sku_canonical (sku_lower, sku_canonical, category, display_name)
    VALUES (LOWER(NEW.sku), NEW.sku, NEW.category, NEW.display_name)
    ON CONFLICT (sku_lower) DO UPDATE SET
        sku_canonical = EXCLUDED.sku_canonical,
        category = EXCLUDED.category,
        display_name = EXCLUDED.display_name;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_sync_canonical ON products;
CREATE TRIGGER trg_products_sync_canonical
    AFTER INSERT OR UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION sync_sku_canonical();

-- ============================================
-- Done. Test with:
-- INSERT INTO inventory (sku, warehouse_id, available, on_hand, reserved, synced_at)
-- VALUES ('SMITH-CI-SKIL10', 77373, 1, 1, 0, NOW())
-- ON CONFLICT (sku, warehouse_id) DO NOTHING;
--
-- SELECT * FROM inventory WHERE LOWER(sku) = 'smith-ci-skil10';
-- Should show "Smith-CI-Skil10" (canonical casing)
-- ============================================
