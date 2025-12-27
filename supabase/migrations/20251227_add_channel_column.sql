-- Add channel column to annual_sales_tracking for D2C vs B2B revenue tracking
-- This allows the Revenue Tracker to show Total, Retail (D2C), or B2B-only views

-- Step 1: Add channel column with default 'd2c' (existing data is D2C from Shopify)
ALTER TABLE annual_sales_tracking
ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'd2c';

-- Step 2: Drop the old primary key
ALTER TABLE annual_sales_tracking DROP CONSTRAINT IF EXISTS annual_sales_tracking_pkey;

-- Step 3: Create new composite primary key including channel
ALTER TABLE annual_sales_tracking
ADD CONSTRAINT annual_sales_tracking_pkey PRIMARY KEY (year, day_of_year, channel);

-- Step 4: Add index for channel filtering
CREATE INDEX IF NOT EXISTS idx_annual_sales_channel
ON annual_sales_tracking(channel);

-- Step 5: Add composite index for year + channel queries (most common pattern)
CREATE INDEX IF NOT EXISTS idx_annual_sales_year_channel
ON annual_sales_tracking(year, channel);

-- Add check constraint to ensure valid channel values
ALTER TABLE annual_sales_tracking
ADD CONSTRAINT chk_channel_valid CHECK (channel IN ('d2c', 'b2b'));

-- Comment for documentation
COMMENT ON COLUMN annual_sales_tracking.channel IS 'Sales channel: d2c (Shopify/retail) or b2b (NetSuite/wholesale)';
