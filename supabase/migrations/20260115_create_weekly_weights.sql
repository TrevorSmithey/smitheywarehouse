-- Create weekly_weights table for DOI calculation
-- Stores 52 weekly weights that sum to 1.0
-- Based on 3-year historical average of cast iron movement
--
-- Week 1 = first week of January
-- Week 52 = last week of December
-- Weights capture BFCM seasonality (weeks 47-50 = 37% of annual demand)

CREATE TABLE IF NOT EXISTS weekly_weights (
  week INTEGER PRIMARY KEY CHECK (week >= 1 AND week <= 52),
  weight NUMERIC(18, 16) NOT NULL CHECK (weight >= 0 AND weight <= 1),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add comment for documentation
COMMENT ON TABLE weekly_weights IS 'Weekly demand weights for DOI calculation. Sum of all weights = 1.0. Based on 3-year historical cast iron movement patterns.';
COMMENT ON COLUMN weekly_weights.week IS 'Week number 1-52, where Week 1 is first week of January';
COMMENT ON COLUMN weekly_weights.weight IS 'Decimal weight representing percentage of annual demand in this week';

-- Insert all 52 weekly weights (sum = 1.0)
INSERT INTO weekly_weights (week, weight) VALUES
  (1, 0.0184682418905942),
  (2, 0.0137776258501054),
  (3, 0.0142580674393976),
  (4, 0.0144529179287178),
  (5, 0.0143673452531420),
  (6, 0.0157473698541146),
  (7, 0.0138493574468039),
  (8, 0.0128114815275605),
  (9, 0.0139402483454679),
  (10, 0.0130039356860602),
  (11, 0.0112485747831096),
  (12, 0.0109770158438944),
  (13, 0.0105052191972203),
  (14, 0.0109227070563582),
  (15, 0.0098869697860376),
  (16, 0.0094771315660538),
  (17, 0.0103611186858393),
  (18, 0.0132931085370896),
  (19, 0.0114208410711137),
  (20, 0.0087263247657980),
  (21, 0.0102537305072129),
  (22, 0.0117160197445243),
  (23, 0.0123707710395812),
  (24, 0.0096693821659971),
  (25, 0.0076287641499233),
  (26, 0.0083078671332367),
  (27, 0.0094027286412232),
  (28, 0.0086481792314912),
  (29, 0.0080045116885626),
  (30, 0.0086936680253348),
  (31, 0.0083155219585299),
  (32, 0.0096687211755704),
  (33, 0.0093271131417590),
  (34, 0.0087417794163324),
  (35, 0.0127842885655250),
  (36, 0.0119292471371663),
  (37, 0.0101782028770813),
  (38, 0.0099998060705142),
  (39, 0.0100258080868677),
  (40, 0.0108234134589620),
  (41, 0.0122615966319318),
  (42, 0.0152732991290971),
  (43, 0.0173282402803505),
  (44, 0.0178265051236118),
  (45, 0.0223960958776020),
  (46, 0.0285295812219979),
  (47, 0.0726903729570950),  -- BFCM lead-in (7.3%)
  (48, 0.1015256597161968),  -- Peak BFCM (10.2%)
  (49, 0.0883093146949960),  -- Cyber week (8.8%)
  (50, 0.0962973416633589),  -- Holiday shipping (9.6%)
  (51, 0.0524618238192787),  -- Final holiday push (5.2%)
  (52, 0.0271150421546096)   -- Year end (2.7%)
ON CONFLICT (week) DO UPDATE SET
  weight = EXCLUDED.weight,
  updated_at = NOW();

-- Create index for quick lookups
CREATE INDEX IF NOT EXISTS idx_weekly_weights_week ON weekly_weights(week);

-- Verify sum is approximately 1.0 (within rounding tolerance)
DO $$
DECLARE
  weight_sum NUMERIC;
BEGIN
  SELECT SUM(weight) INTO weight_sum FROM weekly_weights;
  IF weight_sum < 0.999 OR weight_sum > 1.001 THEN
    RAISE EXCEPTION 'Weekly weights do not sum to 1.0 (got %)', weight_sum;
  END IF;
  RAISE NOTICE 'Weekly weights sum verified: %', weight_sum;
END $$;
