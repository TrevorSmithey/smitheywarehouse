import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function deepAudit() {
  // What are the null warehouse orders?
  const { data: nullWh } = await supabase
    .from('orders')
    .select('order_name, created_at, total_price, warehouse')
    .is('warehouse', null)
    .eq('canceled', false)
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('NULL WAREHOUSE SAMPLES (recent):');
  for (const o of nullWh || []) {
    console.log('  ' + o.order_name + ' | ' + o.created_at?.substring(0, 10) + ' | $' + o.total_price);
  }

  const { data: nullWhOld } = await supabase
    .from('orders')
    .select('order_name, created_at, total_price')
    .is('warehouse', null)
    .eq('canceled', false)
    .order('created_at', { ascending: true })
    .limit(5);

  console.log('');
  console.log('NULL WAREHOUSE SAMPLES (oldest):');
  for (const o of nullWhOld || []) {
    console.log('  ' + o.order_name + ' | ' + o.created_at?.substring(0, 10) + ' | $' + o.total_price);
  }

  // Recalculate LTV with ONLY smithey warehouse (confirmed D2C)
  const { data: d2cOrders } = await supabase
    .from('orders')
    .select('shopify_customer_id, total_price, created_at')
    .eq('warehouse', 'smithey')
    .eq('canceled', false)
    .not('shopify_customer_id', 'is', null)
    .gt('total_price', 0);

  const customers = new Map<string, { totalSpent: number; orders: number }>();
  for (const o of d2cOrders || []) {
    const cid = o.shopify_customer_id;
    if (!customers.has(cid)) {
      customers.set(cid, { totalSpent: 0, orders: 0 });
    }
    const c = customers.get(cid)!;
    c.totalSpent += parseFloat(o.total_price) || 0;
    c.orders += 1;
  }

  const customerList = Array.from(customers.values());
  const totalCustomers = customerList.length;
  const totalRevenue = customerList.reduce((sum, c) => sum + c.totalSpent, 0);
  const avgLTV = totalRevenue / totalCustomers;

  const sortedBySpend = customerList.sort((a, b) => a.totalSpent - b.totalSpent);
  const medianLTV = sortedBySpend[Math.floor(totalCustomers / 2)]?.totalSpent || 0;

  console.log('');
  console.log('=== D2C ONLY (warehouse=smithey) ===');
  console.log('Total Customers:', totalCustomers.toLocaleString());
  console.log('Total Revenue: $' + totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 }));
  console.log('Average LTV: $' + avgLTV.toFixed(2));
  console.log('Median LTV: $' + medianLTV.toFixed(2));

  const repeat = customerList.filter((c) => c.orders >= 2);
  console.log('Repeat Rate:', ((repeat.length / totalCustomers) * 100).toFixed(1) + '%');
  console.log(
    'Repeat Customer LTV: $' + (repeat.reduce((s, c) => s + c.totalSpent, 0) / repeat.length).toFixed(2)
  );

  // Also with null warehouse included (likely older D2C before warehouse field existed)
  const { data: d2cPlusNull } = await supabase
    .from('orders')
    .select('shopify_customer_id, total_price')
    .or('warehouse.eq.smithey,warehouse.is.null')
    .eq('canceled', false)
    .not('shopify_customer_id', 'is', null)
    .gt('total_price', 0);

  const customers2 = new Map<string, { totalSpent: number; orders: number }>();
  for (const o of d2cPlusNull || []) {
    const cid = o.shopify_customer_id;
    if (!customers2.has(cid)) {
      customers2.set(cid, { totalSpent: 0, orders: 0 });
    }
    customers2.get(cid)!.totalSpent += parseFloat(o.total_price) || 0;
    customers2.get(cid)!.orders += 1;
  }

  const list2 = Array.from(customers2.values());
  const sorted2 = list2.sort((a, b) => a.totalSpent - b.totalSpent);

  console.log('');
  console.log('=== D2C + NULL WAREHOUSE (includes older orders) ===');
  console.log('Total Customers:', list2.length.toLocaleString());
  console.log(
    'Total Revenue: $' +
      list2.reduce((s, c) => s + c.totalSpent, 0).toLocaleString(undefined, { maximumFractionDigits: 0 })
  );
  console.log('Average LTV: $' + (list2.reduce((s, c) => s + c.totalSpent, 0) / list2.length).toFixed(2));
  console.log('Median LTV: $' + sorted2[Math.floor(list2.length / 2)]?.totalSpent.toFixed(2));
}

deepAudit().catch(console.error);
