require('dotenv').config({ path: '.env.local' });

const shop = process.env.SHOPIFY_STORE_URL;
const token = process.env.SHOPIFY_ADMIN_TOKEN;
const version = '2024-10';

// Dec 20, 2025 in EST (store timezone)
const startDate = '2025-12-20T00:00:00-05:00';
const endDate = '2025-12-20T23:59:59-05:00';

console.log('Checking Dec 20, 2025 (EST) orders...\n');

async function fetchOrders() {
  const baseUrl = `https://${shop}/admin/api/${version}/orders.json?created_at_min=${encodeURIComponent(startDate)}&created_at_max=${encodeURIComponent(endDate)}&status=any&limit=250&fields=id,name,total_price,created_at,cancelled_at,financial_status,source_name`;

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
  console.log('Total orders from API:', orders.length);

  // By financial status
  const byStatus = {};
  for (const o of orders) {
    const key = o.cancelled_at ? 'CANCELLED' : (o.financial_status || 'unknown');
    byStatus[key] = (byStatus[key] || 0) + 1;
  }
  console.log('\nBy status:');
  for (const [status, count] of Object.entries(byStatus).sort((a,b) => b[1] - a[1])) {
    console.log(`  ${status}: ${count}`);
  }

  // What our sync counts (paid/partially_paid, non-cancelled)
  const ourCount = orders.filter(o =>
    !o.cancelled_at &&
    (o.financial_status === 'paid' || o.financial_status === 'partially_paid')
  );
  const ourRevenue = ourCount.reduce((s, o) => s + parseFloat(o.total_price), 0);

  console.log('\n=== What our sync counts ===');
  console.log('Orders:', ourCount.length);
  console.log('Revenue: $' + ourRevenue.toLocaleString(undefined, {minimumFractionDigits: 2}));

  console.log('\n=== What daily_stats has ===');
  console.log('Orders: 757');
  console.log('Revenue: $277,004.91');

  console.log('\n=== Target (CSV/Dashboard) ===');
  console.log('Orders: 780');
  console.log('Total sales: $276,404.21');

  // Non-cancelled only (what CSV might count)
  const nonCancelled = orders.filter(o => !o.cancelled_at);
  console.log('\n=== All non-cancelled ===');
  console.log('Orders:', nonCancelled.length);
}

run().catch(e => console.error('Error:', e.message));
