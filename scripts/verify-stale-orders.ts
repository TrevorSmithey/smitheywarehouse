import { config } from 'dotenv';
config({ path: '.env.local' });

const SHOPIFY_STORE = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

async function checkOrder(orderName: string) {
  const cleanName = orderName.replace('#', '');
  const url = `https://${SHOPIFY_STORE}/admin/api/2024-01/orders.json?name=${cleanName}&status=any`;

  const response = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN || '',
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    return { orderName, error: `HTTP ${response.status}` };
  }

  const data = await response.json();
  const orders = data.orders || [];

  if (orders.length === 0) {
    return { orderName, error: 'NOT FOUND' };
  }

  const order = orders[0];
  return {
    orderName,
    shopifyStatus: order.fulfillment_status || 'unfulfilled',
    cancelled: !!order.cancelled_at,
    financialStatus: order.financial_status,
    created: order.created_at?.slice(0, 10),
  };
}

async function main() {
  // Check the old stale orders from Supabase
  const staleOrders = [
    'S93913',   // 2022-03-17
    'S94450',   // 2022-03-23
    'S114825',  // 2022-11-14
    'S114837',  // 2022-11-14
    'S146848',  // 2023-04-09
    'S147188',  // 2023-04-13
    'S235790',  // 2024-10-30
    'S277913',  // 2025-01-28
    'S278235',  // 2025-01-30
    'S293271',  // 2025-04-23
  ];

  console.log('Verifying stale orders against Shopify D2C store...\n');
  console.log('Order      | Shopify Status | Cancelled | Financial | Created');
  console.log('-----------|----------------|-----------|-----------|--------');

  for (const orderName of staleOrders) {
    const result = await checkOrder(orderName);

    if ('error' in result) {
      console.log(`${orderName.padEnd(10)} | ${result.error}`);
    } else {
      const status = result.shopifyStatus.padEnd(14);
      const cancelled = (result.cancelled ? 'YES' : 'No').padEnd(9);
      const financial = (result.financialStatus || '').padEnd(9);
      console.log(`${orderName.padEnd(10)} | ${status} | ${cancelled} | ${financial} | ${result.created}`);
    }

    await new Promise(r => setTimeout(r, 300)); // Rate limit
  }
}

main();
