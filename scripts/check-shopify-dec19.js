require('dotenv').config({ path: '.env.local' });

const shop = process.env.SHOPIFY_STORE_URL;
const token = process.env.SHOPIFY_ADMIN_TOKEN;
const version = '2024-10';

// Dec 19, 2025 in EST (store timezone)
const startDate = '2025-12-19T00:00:00-05:00';
const endDate = '2025-12-19T23:59:59-05:00';

console.log('Checking Smithey vs Selery brand breakdown for Dec 19, 2025 (EST)...\n');

async function fetchOrders() {
  const baseUrl = `https://${shop}/admin/api/${version}/orders.json?created_at_min=${encodeURIComponent(startDate)}&created_at_max=${encodeURIComponent(endDate)}&status=any&limit=250`;

  let allOrders = [];
  let pageInfo = null;
  let hasNext = true;

  while (hasNext) {
    let fetchUrl = pageInfo
      ? `https://${shop}/admin/api/${version}/orders.json?page_info=${pageInfo}&limit=250`
      : baseUrl;

    const response = await fetch(fetchUrl, {
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    allOrders = allOrders.concat(data.orders || []);

    const link = response.headers.get('Link');
    if (link && link.includes('rel="next"')) {
      const match = link.match(/<[^>]*page_info=([^>&]+)[^>]*>;\s*rel="next"/);
      pageInfo = match ? match[1] : null;
      hasNext = !!pageInfo;
    } else {
      hasNext = false;
    }
  }

  return allOrders;
}

async function run() {
  const orders = await fetchOrders();

  // Web, non-cancelled orders only
  const webOrders = orders.filter(o => o.source_name === 'web' && !o.cancelled_at);
  console.log('Total web, non-cancelled orders:', webOrders.length);

  // Split by brand tag
  const smitheyOrders = webOrders.filter(o => (o.tags || '').includes('Smithey'));
  const seleryOrders = webOrders.filter(o => (o.tags || '').includes('Selery'));
  const bothOrders = webOrders.filter(o => (o.tags || '').includes('Smithey') && (o.tags || '').includes('Selery'));
  const neitherOrders = webOrders.filter(o => !(o.tags || '').includes('Smithey') && !(o.tags || '').includes('Selery'));

  console.log('\n=== By Brand Tag ===');
  console.log('Smithey tagged:', smitheyOrders.length, 'orders, $' + smitheyOrders.reduce((s, o) => s + parseFloat(o.total_price), 0).toLocaleString(undefined, {minimumFractionDigits: 2}));
  console.log('Selery tagged:', seleryOrders.length, 'orders, $' + seleryOrders.reduce((s, o) => s + parseFloat(o.total_price), 0).toLocaleString(undefined, {minimumFractionDigits: 2}));
  console.log('Both tags:', bothOrders.length);
  console.log('Neither tag:', neitherOrders.length, 'orders, $' + neitherOrders.reduce((s, o) => s + parseFloat(o.total_price), 0).toLocaleString(undefined, {minimumFractionDigits: 2}));

  // Smithey ONLY (not Selery)
  const smitheyOnly = smitheyOrders.filter(o => !(o.tags || '').includes('Selery'));
  console.log('\nSmithey ONLY (no Selery tag):', smitheyOnly.length, 'orders, $' + smitheyOnly.reduce((s, o) => s + parseFloat(o.total_price), 0).toLocaleString(undefined, {minimumFractionDigits: 2}));

  // Selery ONLY (not Smithey)
  const seleryOnly = seleryOrders.filter(o => !(o.tags || '').includes('Smithey'));
  console.log('Selery ONLY (no Smithey tag):', seleryOnly.length, 'orders, $' + seleryOnly.reduce((s, o) => s + parseFloat(o.total_price), 0).toLocaleString(undefined, {minimumFractionDigits: 2}));

  // What if dashboard excludes Selery?
  const excludeSelery = webOrders.filter(o => !(o.tags || '').includes('Selery'));
  console.log('\n=== Excluding Selery tagged ===');
  console.log('Orders:', excludeSelery.length, '(target: 780)');
  console.log('Revenue: $' + excludeSelery.reduce((s, o) => s + parseFloat(o.total_price), 0).toLocaleString(undefined, {minimumFractionDigits: 2}), '(target: $276,404.21)');

  // Let me also check paid only, excluding Selery
  const paidExcludeSelery = excludeSelery.filter(o => o.financial_status === 'paid' || o.financial_status === 'partially_paid');
  console.log('\n=== Paid only, excluding Selery ===');
  console.log('Orders:', paidExcludeSelery.length);
  console.log('Revenue: $' + paidExcludeSelery.reduce((s, o) => s + parseFloat(o.total_price), 0).toLocaleString(undefined, {minimumFractionDigits: 2}));

  console.log('\n=== TARGET (Shopify Dashboard) ===');
  console.log('Orders: 780');
  console.log('Total sales: $276,404.21');
}

run().catch(e => console.error('Error:', e.message));
