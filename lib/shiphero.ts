/**
 * ShipHero GraphQL API Client
 *
 * Fetches inventory data from ShipHero for the Inventory Dashboard.
 */

const SHIPHERO_API_URL = "https://public-api.shiphero.com/graphql";

// Warehouse ID mapping
export const WAREHOUSES = {
  pipefitter: "120758",
  hobson: "77373",
  selery: "93742",
  hq: "120759",
} as const;

export type WarehouseName = keyof typeof WAREHOUSES;

interface ShipHeroProduct {
  sku: string;
  name: string;
  warehouse_products: {
    warehouse_id: string;
    on_hand: number;
    available: number;
    allocated: number;
    backorder: number;
  }[];
}

interface ProductsQueryResponse {
  data: {
    products: {
      data: {
        edges: {
          node: ShipHeroProduct;
        }[];
        pageInfo: {
          hasNextPage: boolean;
          endCursor: string | null;
        };
      };
    };
  };
  errors?: { message: string }[];
}

/**
 * Execute a GraphQL query against the ShipHero API
 */
async function shipheroQuery<T>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const token = process.env.SHIPHERO_API_TOKEN;
  if (!token) {
    throw new Error("SHIPHERO_API_TOKEN not configured");
  }

  const response = await fetch(SHIPHERO_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ShipHero API error: ${response.status} - ${text}`);
  }

  const result = await response.json();

  if (result.errors && result.errors.length > 0) {
    throw new Error(`ShipHero GraphQL error: ${result.errors[0].message}`);
  }

  return result as T;
}

/**
 * Fetch all products with their warehouse inventory
 * Uses cursor-based pagination to get complete data
 */
export async function fetchAllProducts(): Promise<ShipHeroProduct[]> {
  const products: ShipHeroProduct[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  const query = `
    query GetProducts($cursor: String) {
      products(first: 100, after: $cursor) {
        data {
          edges {
            node {
              sku
              name
              warehouse_products {
                warehouse_id
                on_hand
                available
                allocated
                backorder
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  `;

  while (hasNextPage) {
    const result: ProductsQueryResponse = await shipheroQuery<ProductsQueryResponse>(query, {
      cursor,
    });

    const data: ProductsQueryResponse["data"]["products"]["data"] | undefined = result.data?.products?.data;
    if (!data) {
      throw new Error("Invalid response structure from ShipHero API");
    }

    for (const edge of data.edges) {
      products.push(edge.node);
    }

    hasNextPage = data.pageInfo.hasNextPage;
    cursor = data.pageInfo.endCursor;

    // Safety limit - prevent infinite loops
    if (products.length > 10000) {
      console.warn("ShipHero: Hit 10,000 product limit, stopping pagination");
      break;
    }
  }

  return products;
}

/**
 * Determine product category from SKU
 * Based on nomenclature.xlsx SKU prefixes:
 * - Smith-CI-* → cast_iron
 * - Smith-CS-* → carbon_steel
 * - Smith-AC-Glid* → glass_lid
 * - Smith-AC-* → accessory
 * - *-D suffix → factory_second (demo/factory second units)
 */
export type ProductCategory =
  | "cast_iron"
  | "carbon_steel"
  | "accessory"
  | "glass_lid"
  | "factory_second";

export function categorizeProduct(sku: string): ProductCategory {
  // Factory seconds - SKUs ending with -D (demo units)
  if (sku.endsWith("-D")) {
    return "factory_second";
  }

  // Cast Iron - Smith-CI-* prefix
  if (sku.startsWith("Smith-CI-")) {
    return "cast_iron";
  }

  // Carbon Steel - Smith-CS-* prefix
  if (sku.startsWith("Smith-CS-")) {
    return "carbon_steel";
  }

  // Glass Lids - Smith-AC-Glid* prefix (check before general accessories)
  if (sku.startsWith("Smith-AC-Glid")) {
    return "glass_lid";
  }

  // Accessories - Smith-AC-* prefix (and Smith-Bottle1)
  if (sku.startsWith("Smith-AC-") || sku.startsWith("Smith-Bottle")) {
    return "accessory";
  }

  // Default to accessory for unknown patterns
  return "accessory";
}

export interface TransformedInventory {
  sku: string;
  name: string;
  category: ProductCategory;
  pipefitter: number;
  hobson: number;
  selery: number;
  total: number;
}

/**
 * Transform raw ShipHero products into inventory by warehouse
 */
export function transformToInventory(
  products: ShipHeroProduct[]
): TransformedInventory[] {
  return products
    .map((product) => {
      // Get available qty for each warehouse
      const getAvailable = (warehouseId: string): number => {
        const wp = product.warehouse_products.find(
          (w) => w.warehouse_id === warehouseId
        );
        return wp?.available || 0;
      };

      const pipefitter = getAvailable(WAREHOUSES.pipefitter);
      const hobson = getAvailable(WAREHOUSES.hobson);
      const selery = getAvailable(WAREHOUSES.selery);
      const total = pipefitter + hobson + selery;

      return {
        sku: product.sku,
        name: product.name,
        category: categorizeProduct(product.sku),
        pipefitter,
        hobson,
        selery,
        total,
      };
    })
    .filter((p) => p.total > 0) // Only include products with inventory
    .sort((a, b) => b.total - a.total); // Sort by total descending
}

/**
 * SKU to Display Name mapping from nomenclature.xlsx
 * Used to show friendly names in the UI
 */
export const SKU_DISPLAY_NAMES: Record<string, string> = {
  // Cast Iron
  "Smith-CI-Skil12": "12Trad",
  "Smith-CI-Skil10": "10Trad",
  "Smith-CI-Skil8": "8Chef",
  "Smith-CI-TradSkil14": "14Trad",
  "Smith-CI-Skil14": "14Dual",
  "Smith-CI-Skil6": "6Trad",
  "Smith-CI-Chef10": "10Chef",
  "Smith-CI-DSkil11": "11Deep",
  "Smith-CI-Dual12": "12Dual",
  "Smith-CI-Dual6": "6Dual",
  "Smith-CI-Dutch7": "7.25 Dutch",
  "Smith-CI-Dutch5": "5.5 Dutch",
  "Smith-CI-Dutch4": "3.5 Dutch",
  "Smith-CI-Flat12": "12Flat",
  "Smith-CI-Flat10": "10Flat",
  "Smith-CI-Grill12": "12Grill",
  "Smith-CI-Griddle18": "Double Burner Griddle",
  // Carbon Steel
  "Smith-CS-WokM": "Wok",
  "Smith-CS-RroastM": "Round Roaster",
  "Smith-CS-Round17N": "Paella Pan",
  "Smith-CS-OvalM": "Oval Roaster",
  "Smith-CS-Farm9": "Little Farm",
  "Smith-CS-Farm12": "Farmhouse Skillet",
  "Smith-CS-Deep12": "Deep Farm",
  // Glass Lids
  "Smith-AC-Glid14": "14Lid",
  "Smith-AC-Glid12": "12Lid",
  "Smith-AC-Glid11": "11Lid",
  "Smith-AC-Glid10": "10Lid",
  // Accessories
  "Smith-Bottle1": "Bottle Opener",
  "Smith-AC-SpatW1": "Slotted Spat",
  "Smith-AC-SpatB1": "Mighty Spat",
  "Smith-AC-Sleeve2": "Long Sleeve",
  "Smith-AC-Sleeve1": "Short Sleeve",
  "Smith-AC-Season": "Seasoning Oil",
  "Smith-AC-Scrub1": "Chainmail Scrubber",
  "Smith-AC-Puzzle1": "Puzzle",
  "Smith-AC-PHTLg": "Suede Potholder",
  "Smith-AC-Ornament1": "Ornament",
  "Smith-AC-KeeperW": "Salt Keeper",
  "Smith-AC-FGph": "Leather Potholder",
  "Smith-AC-CareKit": "Care Kit",
  // Factory Seconds (Demo units)
  "Smith-CI-Chef10-D": "10Chef Demo",
  "Smith-CI-DSkil11-D": "11Deep Demo",
  "Smith-CI-Dual12-D": "12Dual Demo",
  "Smith-CI-Dual6-D": "6Dual Demo",
  "Smith-CI-Dutch4-D": "3.5 Dutch Demo",
  "Smith-CI-Dutch5-D": "5.5 Dutch Demo",
  "Smith-CI-Dutch7-D": "7.25 Dutch Demo",
  "Smith-CI-Flat10-D": "10Flat Demo",
  "Smith-CI-Flat12-D": "12Flat Demo",
  "Smith-CI-Griddle18-D": "DBG Demo",
  "Smith-CI-Grill12-D": "12Grill Demo",
  "Smith-CI-Skil10-D": "10Trad Demo",
  "Smith-CI-Skil12-D": "12Trad Demo",
  "Smith-CI-Skil14-D": "14Dual Demo",
  "Smith-CI-Skil6-D": "6Trad Demo",
  "Smith-CI-Skil8-D": "8Chef Demo",
  "Smith-CI-TradSkil14-D": "14Trad Demo",
  "Smith-CS-Deep12-D": "Deep Farm Demo",
  "Smith-CS-Farm12-D": "Farmhouse Demo",
  "Smith-CS-Farm9-D": "9Farm Demo",
  "Smith-CS-OvalM-D": "Oval Roaster Demo",
  "Smith-CS-Round17N-D": "Paella Demo",
  "Smith-CS-RRoastM-D": "Round Roaster Demo",
  "Smith-CS-WokM-D": "Wok Demo",
};

/**
 * Get display name for a SKU, falling back to the SKU itself
 */
export function getDisplayName(sku: string): string {
  return SKU_DISPLAY_NAMES[sku] || sku;
}
