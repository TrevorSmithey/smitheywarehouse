-- Add budget_sku column to track which SKU's budget to use
-- when a product doesn't have its own budget forecast

ALTER TABLE products ADD COLUMN IF NOT EXISTS budget_sku TEXT;

COMMENT ON COLUMN products.budget_sku IS 'SKU to use for budget if different from own SKU (e.g., CareKit uses Brush budget)';

-- CareKit budget = Brush budget
UPDATE products
SET budget_sku = 'Smith-AC-Brush'
WHERE sku = 'Smith-AC-CareKit';
