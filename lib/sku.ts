/**
 * SKU Normalization Utilities
 *
 * All SKU comparisons and Map lookups should use these utilities
 * to ensure case-insensitive matching across the codebase.
 *
 * WHY: ShipHero, Shopify, and manual data entry can produce different
 * casings for the same SKU (e.g., "Smith-CI-TradSkil14" vs "Smith-CI-Tradskil14").
 * Using lowercase normalization ensures consistent matching.
 */

/**
 * Normalize a SKU for comparison/lookup purposes.
 * Always use this when building Map keys or doing Set lookups.
 *
 * @example
 * const productMap = new Map();
 * productMap.set(normalizeSku(product.sku), product);
 * const found = productMap.get(normalizeSku(lookupSku));
 */
export function normalizeSku(sku: string): string {
  return sku.toLowerCase();
}

/**
 * Create a case-insensitive SKU Map from an array of items.
 * Keys are normalized (lowercase), values are the original items.
 *
 * @example
 * const products = [{ sku: "Smith-CI-Skil10", name: "10 Trad" }];
 * const map = createSkuMap(products, p => p.sku);
 * map.get("smith-ci-skil10"); // Returns { sku: "Smith-CI-Skil10", name: "10 Trad" }
 */
export function createSkuMap<T>(
  items: T[],
  getSkuFn: (item: T) => string
): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(normalizeSku(getSkuFn(item)), item);
  }
  return map;
}

/**
 * Create a case-insensitive SKU Set from an array of SKUs.
 *
 * @example
 * const existingSkus = createSkuSet(products.map(p => p.sku));
 * existingSkus.has(normalizeSku(newSku)); // Case-insensitive check
 */
export function createSkuSet(skus: string[]): Set<string> {
  return new Set(skus.map(normalizeSku));
}

/**
 * Check if a SKU exists in a normalized Set (case-insensitive).
 *
 * @example
 * const existingSkus = createSkuSet(["Smith-CI-Skil10"]);
 * skuSetHas(existingSkus, "SMITH-CI-SKIL10"); // true
 */
export function skuSetHas(set: Set<string>, sku: string): boolean {
  return set.has(normalizeSku(sku));
}

/**
 * Get a value from a SKU Map (case-insensitive).
 *
 * @example
 * const productMap = createSkuMap(products, p => p.sku);
 * skuMapGet(productMap, "SMITH-CI-SKIL10"); // Returns product
 */
export function skuMapGet<T>(map: Map<string, T>, sku: string): T | undefined {
  return map.get(normalizeSku(sku));
}

/**
 * Set a value in a SKU Map (case-insensitive key).
 *
 * @example
 * const salesBySku = new Map<string, number>();
 * skuMapSet(salesBySku, "Smith-CI-Skil10", 100);
 * skuMapGet(salesBySku, "SMITH-CI-SKIL10"); // 100
 */
export function skuMapSet<T>(map: Map<string, T>, sku: string, value: T): void {
  map.set(normalizeSku(sku), value);
}

/**
 * Aggregate a numeric value in a SKU Map (case-insensitive key).
 * Useful for summing quantities by SKU.
 *
 * @example
 * const salesBySku = new Map<string, number>();
 * skuMapAdd(salesBySku, "Smith-CI-Skil10", 5);
 * skuMapAdd(salesBySku, "SMITH-CI-SKIL10", 3); // Aggregates to 8
 * skuMapGet(salesBySku, "smith-ci-skil10"); // 8
 */
export function skuMapAdd(
  map: Map<string, number>,
  sku: string,
  value: number
): void {
  const key = normalizeSku(sku);
  const current = map.get(key) || 0;
  map.set(key, current + value);
}
