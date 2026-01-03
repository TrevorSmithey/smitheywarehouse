/**
 * Sync fulfilled orders from Shopify
 * Pulls orders with fulfillment_status=fulfilled and updates our database
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const SHOPIFY_STORE = process.env.SHOPIFY_STORE_URL!;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface ShopifyOrder {
  id: number;
  name: string;
  fulfillment_status: string | null;
  tags: string;
  fulfillments: Array<{
    id: number;
    created_at: string;
    tracking_number: string | null;
    tracking_numbers: string[];
    tracking_company: string | null;
  }>;
}

function extractWarehouse(tags: string | null): string | null {
  if (!tags) return null;
  const tagList = tags.toLowerCase().split(',').map(t => t.trim());
  if (tagList.includes('smithey')) return 'smithey';
  if (tagList.includes('selery')) return 'selery';
  return null;
}

function calculateFulfilledAt(fulfillments: ShopifyOrder['fulfillments']): string | null {
  if (!fulfillments || fulfillments.length === 0) return null;
  // Get the most recent fulfillment date
  const dates = fulfillments.map(f => new Date(f.created_at).getTime());
  return new Date(Math.max(...dates)).toISOString();
}

async function fetchFulfilledOrders(updatedAtMin: string): Promise<ShopifyOrder[]> {
  const allOrders: ShopifyOrder[] = [];
  let nextUrl: string | null = null;
  let hasNextPage = true;
  let isFirstPage = true;

  console.log(`Fetching fulfilled orders updated since ${updatedAtMin}...`);

  while (hasNextPage) {
    let url: string;

    if (isFirstPage) {
      // First page - include all query params
      const params = new URLSearchParams({
        status: 'any',
        fulfillment_status: 'shipped',
        updated_at_min: updatedAtMin,
        limit: '250',
        fields: 'id,name,fulfillment_status,tags,fulfillments',
      });
      url = `https://${SHOPIFY_STORE}/admin/api/2024-10/orders.json?${params}`;
      isFirstPage = false;
    } else if (nextUrl) {
      // Subsequent pages - use the full URL from Link header (only page_info allowed)
      url = nextUrl;
    } else {
      break;
    }

    const response = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_TOKEN,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Shopify API error: ${response.status} ${response.statusText} - ${body}`);
    }

    const data = await response.json();
    const orders = data.orders || [];
    allOrders.push(...orders);

    console.log(`  Fetched ${orders.length} orders (total: ${allOrders.length})`);

    // Check for pagination - extract full next URL
    const linkHeader = response.headers.get('link');
    if (linkHeader && linkHeader.includes('rel="next"')) {
      const match = linkHeader.match(/<([^>]+)>; rel="next"/);
      nextUrl = match ? match[1] : null;
      hasNextPage = !!nextUrl;
    } else {
      hasNextPage = false;
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }

  return allOrders;
}

async function syncFulfillments() {
  // Fetch orders updated in the last 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const orders = await fetchFulfilledOrders(sevenDaysAgo.toISOString());

  console.log(`\nFound ${orders.length} fulfilled orders from Shopify`);

  if (orders.length === 0) {
    console.log('No orders to sync');
    return;
  }

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const order of orders) {
    try {
      const warehouse = extractWarehouse(order.tags);
      const fulfilledAt = calculateFulfilledAt(order.fulfillments);

      if (!fulfilledAt) {
        console.log(`${order.name}: No fulfillment date, skipping`);
        skipped++;
        continue;
      }

      const { error: updateError } = await supabase
        .from('orders')
        .update({
          fulfillment_status: order.fulfillment_status || 'fulfilled',
          fulfilled_at: fulfilledAt,
          warehouse: warehouse,
          updated_at: new Date().toISOString(),
        })
        .eq('id', order.id);

      if (updateError) {
        // Order might not exist in our DB yet
        if (updateError.code === 'PGRST116') {
          console.log(`${order.name}: Not in DB, skipping`);
          skipped++;
        } else {
          console.error(`${order.name}: Update error - ${updateError.message}`);
          errors++;
        }
      } else {
        console.log(`${order.name}: ${warehouse || 'no-warehouse'} fulfilled at ${fulfilledAt.substring(0, 10)}`);
        updated++;
      }
    } catch (err) {
      console.error(`${order.name}: ${err}`);
      errors++;
    }
  }

  console.log(`\nDone! Updated: ${updated}, Skipped: ${skipped}, Errors: ${errors}`);
}

syncFulfillments()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
