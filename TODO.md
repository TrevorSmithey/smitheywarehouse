# Smithey Warehouse - Future Improvements

## Performance Optimization: Postgres RPC Functions

**Added:** Dec 8, 2025
**Priority:** Medium (when performance matters)

### Problem
Budget API fetches 228K+ rows from `line_items` and aggregates in JS.
Current fix uses pagination but still transfers all data.

### Solution
Create Postgres RPC functions to do aggregations server-side:

```sql
CREATE FUNCTION get_budget_actuals(start_date timestamp, end_date timestamp)
RETURNS TABLE(sku text, total_qty bigint) AS $$
  SELECT sku, SUM(quantity) as total_qty
  FROM line_items li
  JOIN orders o ON li.order_id = o.id
  WHERE o.created_at BETWEEN start_date AND end_date
  AND o.canceled = false
  GROUP BY sku
$$ LANGUAGE sql;
```

Call via: `supabase.rpc('get_budget_actuals', { start_date, end_date })`

### Benefits
- No row limits
- Less data transfer (aggregated results vs raw rows)
- Faster (database does the math)
- Cleaner code

### Files to Update
- `app/api/budget/route.ts` - Replace pagination with RPC call
- Potentially `app/api/inventory/route.ts` if similar issues arise
