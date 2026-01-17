/* eslint-disable @typescript-eslint/no-explicit-any */
import { config } from "dotenv";
config({ path: ".env.local" });

const SHOPIFY_B2B_STORE = process.env.SHOPIFY_B2B_STORE_URL;
const SHOPIFY_B2B_TOKEN = process.env.SHOPIFY_B2B_ADMIN_TOKEN;

async function fetchAllOrders(): Promise<any[]> {
  const allOrders: any[] = [];
  let pageInfo: string | null = null;
  let hasMore = true;

  while (hasMore) {
    let url: string;
    if (pageInfo) {
      url = `https://${SHOPIFY_B2B_STORE}/admin/api/2024-01/orders.json?page_info=${pageInfo}`;
    } else {
      const params = new URLSearchParams({
        status: "any",
        created_at_min: "2025-12-01T00:00:00-05:00",
        limit: "250",
      });
      url = `https://${SHOPIFY_B2B_STORE}/admin/api/2024-01/orders.json?${params}`;
    }

    const response = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_B2B_TOKEN!,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();
    allOrders.push(...(data.orders || []));

    const linkHeader = response.headers.get("link");
    if (linkHeader && linkHeader.includes('rel="next"')) {
      const match = linkHeader.match(/<[^>]*page_info=([^>&]*)[^>]*>; rel="next"/);
      pageInfo = match ? match[1] : null;
      hasMore = !!pageInfo;
    } else {
      hasMore = false;
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  return allOrders;
}

async function main() {
  console.log("Finding cancelled orders in December 2025...\n");

  const orders = await fetchAllOrders();

  // Filter to Dec 1-7
  const decOrders = orders.filter((o) => {
    const d = new Date(o.created_at);
    return d >= new Date("2025-12-01") && d < new Date("2025-12-08");
  });

  console.log(`Total orders Dec 1-7: ${decOrders.length}`);

  const cancelled = decOrders.filter((o) => o.cancelled_at);
  const active = decOrders.filter((o) => !o.cancelled_at);

  console.log(`Active orders: ${active.length}`);
  console.log(`Cancelled orders: ${cancelled.length}\n`);

  if (cancelled.length > 0) {
    console.log("CANCELLED ORDERS:");
    console.log("─".repeat(60));

    let cancelledTotal = 0;
    const cancelledSkus: Record<string, number> = {};

    for (const order of cancelled) {
      console.log(`\n${order.name} (cancelled: ${order.cancelled_at})`);

      for (const li of order.line_items || []) {
        if (li.sku && li.sku.startsWith("Smith-") && li.sku !== "Smith-Eng") {
          console.log(`  ${li.sku}: ${li.quantity}`);
          cancelledSkus[li.sku] = (cancelledSkus[li.sku] || 0) + li.quantity;
          cancelledTotal += li.quantity;
        }
      }
    }

    console.log("\n\nSUMMARY OF CANCELLED QUANTITIES:");
    console.log("─".repeat(40));
    const sorted = Object.entries(cancelledSkus).sort((a, b) => b[1] - a[1]);
    for (const [sku, qty] of sorted) {
      console.log(`${sku.padEnd(25)}${qty.toString().padStart(8)}`);
    }
    console.log("─".repeat(40));
    console.log(`${"TOTAL CANCELLED".padEnd(25)}${cancelledTotal.toString().padStart(8)}`);
  }

  // Now calculate total for active orders
  let activeTotal = 0;
  for (const order of active) {
    for (const li of order.line_items || []) {
      if (li.sku && li.sku.startsWith("Smith-") && li.sku !== "Smith-Eng" && li.sku !== "Gift-Note") {
        activeTotal += li.quantity;
      }
    }
  }

  console.log(`\n\nACTIVE ORDERS TOTAL: ${activeTotal} units`);
}

main();
