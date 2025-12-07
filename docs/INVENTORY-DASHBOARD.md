# Inventory Dashboard Feature

## Overview

The Inventory Dashboard adds a third tab to the smitheywarehouse dashboard that displays real-time available inventory by SKU across three warehouses, pulled directly from ShipHero's GraphQL API.

**Branch:** `feature/inventory-dashboard-2`

---

## Architecture

```
ShipHero GraphQL API ──> /api/inventory/route.ts ──> Dashboard UI (Inventory Tab)
```

No database storage needed - data is fetched in real-time from ShipHero on each request.

---

## Files Created/Modified

| File | Status | Purpose |
|------|--------|---------|
| `lib/shiphero.ts` | NEW | ShipHero GraphQL client with pagination, categorization, and transform logic |
| `lib/types.ts` | MODIFIED | Added `ProductInventory`, `InventoryCategory`, `InventoryTotals`, `InventoryResponse` types |
| `app/api/inventory/route.ts` | NEW | API endpoint that fetches and aggregates inventory data |
| `app/page.tsx` | MODIFIED | Added Inventory tab with category tabs, table, chart, and totals |

---

## Environment Variables Required

Already configured in `.env.local`:

```bash
SHIPHERO_API_TOKEN=<JWT token>
SHIPHERO_REFRESH_TOKEN=<refresh token>
```

**Note:** The ShipHero API token expires. If you see authentication errors, you'll need to refresh the token using ShipHero's token refresh flow.

---

## Warehouse Configuration

Warehouse IDs are defined in `lib/shiphero.ts`:

```typescript
export const WAREHOUSES = {
  pipefitter: "120758",
  hobson: "77373",
  selery: "93742",
  hq: "120759",  // For reference, not displayed in dashboard
} as const;
```

---

## SKU Categorization Logic

Products are categorized based on SKU prefixes (defined in `lib/shiphero.ts`):

| Category | SKU Pattern | Examples |
|----------|-------------|----------|
| Cast Iron | `Smith-CI-*` | Smith-CI-Skil12, Smith-CI-Dutch7 |
| Carbon Steel | `Smith-CS-*` | Smith-CS-WokM, Smith-CS-Farm12 |
| Accessories | `Smith-AC-*`, `Smith-Bottle*` | Smith-AC-Season, Smith-Bottle1 |
| Glass Lid | `Smith-AC-Glid*` | Smith-AC-Glid12 (subset of accessories) |
| Factory Second | `*-D` suffix | Smith-CI-Skil12-D, Smith-CS-WokM-D |

**Note:** Factory seconds are identified by the `-D` suffix (demo units) and are checked first before other categorization.

---

## SKU Display Names

Human-readable names are mapped in `lib/shiphero.ts` via `SKU_DISPLAY_NAMES`:

```typescript
// Examples:
"Smith-CI-Skil12" → "12Trad"
"Smith-CI-Dutch7" → "7.25 Dutch"
"Smith-CS-WokM" → "Wok"
"Smith-AC-Season" → "Seasoning Oil"
```

This mapping comes from the nomenclature.xlsx file and can be extended as new SKUs are added.

---

## UI Components

### Category Tabs
Four filterable categories matching the Looker report:
- Cast Iron (default)
- Carbon Steel
- Accessories
- Factory Second

### Totals Summary
Three metric cards showing total units per warehouse:
- Pipefitter (blue)
- Hobson (amber/orange)
- Selery (green)

### Inventory Table
Scrollable table with sticky headers showing:
- Product name (with display name mapping)
- Pipefitter qty
- Hobson qty
- Selery qty
- Total Available

Includes grand total row at bottom.

### Inventory Chart
Horizontal stacked bar chart (Recharts) showing top 10 products by warehouse distribution.

Chart colors match warehouse identity:
- Pipefitter: `#0EA5E9` (blue)
- Hobson: `#F59E0B` (amber)
- Selery: `#10B981` (green)

---

## API Endpoint

**GET** `/api/inventory`

Returns:
```typescript
{
  products: ProductInventory[],
  totals: {
    pipefitter: number,
    hobson: number,
    selery: number,
    total: number
  },
  byCategory: {
    cast_iron: ProductInventory[],
    carbon_steel: ProductInventory[],
    accessories: ProductInventory[],
    factory_second: ProductInventory[]
  },
  lastUpdated: string  // ISO timestamp
}
```

---

## Remaining Work to Complete

### 1. Test the API Endpoint
```bash
# Start dev server
npm run dev

# Test inventory endpoint
curl http://localhost:3000/api/inventory | jq
```

Verify:
- [ ] Products return with correct warehouse quantities
- [ ] Categories are properly assigned
- [ ] Display names are applied
- [ ] Grand totals are accurate

### 2. Verify Against Looker Report
Compare the dashboard data against the original Looker report:
- [ ] Cast Iron totals match
- [ ] Individual SKU quantities match per warehouse
- [ ] Sort order is by total descending (highest inventory first)

### 3. Handle Token Refresh
The ShipHero API token has an expiration. Consider:
- [ ] Add token refresh logic to `lib/shiphero.ts`
- [ ] Add error handling for 401 responses with token refresh retry

### 4. UI Polish
- [ ] Verify responsive behavior on smaller screens
- [ ] Test tab switching between Fulfillment/Tracking/Inventory
- [ ] Confirm loading states appear correctly
- [ ] Verify error states display properly

### 5. Performance Considerations
The ShipHero API is paginated and fetches up to 100 products per page. Current implementation:
- Fetches all products (up to 10,000 limit)
- Filters to only products with inventory > 0
- No caching (fresh data on every request)

Consider adding:
- [ ] Response caching (e.g., 5-minute TTL)
- [ ] Only fetch products with inventory (if ShipHero supports filtering)

---

## Testing Locally

```bash
# 1. Ensure you're on the feature branch
git checkout feature/inventory-dashboard-2

# 2. Start the dev server
npm run dev

# 3. Open dashboard
open http://localhost:3000

# 4. Click the "Inventory" tab (third tab with bar chart icon)

# 5. Test category switching
# 6. Verify numbers make sense
```

---

## Commit and Deploy

When ready to merge:

```bash
# Stage all inventory-related files
git add lib/shiphero.ts
git add lib/types.ts
git add app/api/inventory/route.ts
git add app/page.tsx

# Commit
git commit -m "feat: add inventory dashboard with ShipHero integration

- Add ShipHero GraphQL client with pagination
- Add /api/inventory endpoint for real-time inventory data
- Add Inventory tab to dashboard with category filtering
- Display inventory by warehouse (Pipefitter, Hobson, Selery)
- Include horizontal bar chart for top products
- SKU categorization: Cast Iron, Carbon Steel, Accessories, Factory Second"

# Push to remote
git push -u origin feature/inventory-dashboard-2
```

---

## Troubleshooting

### "SHIPHERO_API_TOKEN not configured"
Check that `.env.local` contains the token. Restart the dev server after adding.

### Empty inventory results
- Verify ShipHero token hasn't expired
- Check that warehouse IDs match your ShipHero account
- Confirm products have `warehouse_products` data

### Slow loading
ShipHero pagination may require multiple API calls. Consider caching.

### Missing display names
Add new SKU mappings to `SKU_DISPLAY_NAMES` in `lib/shiphero.ts`.

---

## Reference: Original Looker Report Layout

The dashboard replicates this structure:

```
┌─────────────────────────────────────────────────────────────────┐
│  INVENTORY DASHBOARD                                            │
├─────────────────────────────────────────────────────────────────┤
│  [CAST IRON] [CARBON STEEL] [ACCESSORIES] [FACTORY SECOND]     │
├─────────────────────────────────────────────────────────────────┤
│  Product Name  │ Pipefitter │ Hobson │ Selery │ Total Available │
│  12Trad        │     0      │ 1,977  │ 4,875  │     6,861       │
│  10Trad        │    22      │ 2,397  │ 2,617  │     5,044       │
│  8Chef         │    13      │   717  │ 1,387  │     2,126       │
│  ...           │    ...     │  ...   │  ...   │     ...         │
├─────────────────────────────────────────────────────────────────┤
│  Grand Total   │    63      │ 9,669  │ 12,929 │    22,820       │
├─────────────────────────────────────────────────────────────────┤
│  [HORIZONTAL STACKED BAR CHART BY WAREHOUSE]                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Contact

For questions about ShipHero API access or warehouse configuration, contact the warehouse ops team.
