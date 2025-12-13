# Assembly Targets with Multiple Timeframes

## Current State
- `assembly_targets` table holds a single snapshot per SKU
- No timeframe concept - just one target per SKU
- Updated manually, last synced Dec 7

## Proposed Data Model

```sql
CREATE TABLE assembly_targets_v2 (
  id SERIAL PRIMARY KEY,
  sku TEXT NOT NULL,
  timeframe TEXT NOT NULL, -- 'month', 'quarter', 'year', 'custom'
  period_name TEXT, -- 'December 2025', 'Q4 2025', 'Holiday Push'
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  target INTEGER NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(sku, timeframe, period_start)
);
```

## How It Would Work

### 1. CSV Upload
Export from Excel with columns:
```
sku,timeframe,period_name,period_start,period_end,target
Smith-CI-Skil12,month,December 2025,2025-12-01,2025-12-31,3500
Smith-CI-Skil12,quarter,Q4 2025,2025-10-01,2025-12-31,10000
Smith-CI-Skil12,year,2025,2025-01-01,2025-12-31,40000
```

### 2. Dashboard Display
- Dropdown to select timeframe view (Month / Quarter / Year / Custom)
- "Assembled" column calculated from `assembly_sku_daily` within the date range
- Progress % = assembled / target

### 3. Sync Script
```bash
npm run sync-targets -- --file data/targets-q1-2026.csv
```

## Dashboard Changes

SKU Progress table would show:
| SKU | Target | Built | Left | % |
Filtered by selected timeframe.

Could also show comparison:
- "On pace for monthly? quarterly? yearly?"

## Questions to Answer Before Building
1. Do targets cascade? (yearly target = sum of monthly?)
2. Should we track actuals separately or always calculate from `assembly_sku_daily`?
3. Do you want historical targets preserved or overwritten?
4. How often do targets change mid-period?
