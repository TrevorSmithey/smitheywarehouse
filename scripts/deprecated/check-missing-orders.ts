import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

// Orders that are in Shopify but NOT in our queue export
const shopifyOnlyOrders = [
  'S316648', 'S325726', 'S327278', 'S327279', 'S328143', 'S328424', 'S328852',
  'S329383', 'S329919', 'S330135', 'S330486', 'S330999', 'S331290', 'S331638',
  'S332046', 'S332239', 'S332407', 'S332493', 'S333494', 'S333496', 'S333561',
  'S333579', 'S333658', 'S333762', 'S334037', 'S334072', 'S334492', 'S334587',
  'S334702', 'S336398', 'S336794', 'S337393', 'S337423', 'S338761', 'S340012',
  'S340034', 'S340374', 'S340627', 'S341431', 'S341639', 'S341755', 'S342920',
  'S343639', 'S344025', 'S344544', 'S344894', 'S345095', 'S345314', 'S345606',
  'S345854', 'S346104', 'S346818', 'S347276', 'S347421', 'S348344', 'S349391',
  'S349517', 'S349758', 'S350049', 'S350135', 'S350520', 'S350952', 'S351059',
  'S351275', 'S351368', 'S351765', 'S351776', 'S351810', 'S353594', 'S353637',
  'S354493', 'S354521', 'S354719', 'S355551', 'S356808', 'S358081', 'S358302',
  'S360921', 'S361357', 'S362308', 'S362410', 'S362862', 'S362879', 'S362885',
  'S362980', 'S363067', 'S363087', 'S363089', 'S363091', 'S363095', 'S363099',
  'S363109', 'S363111', 'S363125', 'S363127', 'S363130', 'S363134', 'S363143',
  'S363160', 'S363161', 'S363173', 'S363181', 'S363188', 'S363197', 'S363208',
  'S363209', 'S363219', 'S363221', 'S363228', 'S363230', 'S363233', 'S363242',
  'S363244', 'S363245', 'S363259', 'S363261', 'S363269', 'S363271', 'S363283',
  'S363284', 'S363293', 'S363296', 'S363301', 'S363309', 'S363329', 'S363364',
  'S363367', 'S363371', 'S363379', 'S363381', 'S363388', 'S363393', 'S363394',
  'S363395', 'S363396', 'S363398', 'S363399', 'S363403', 'S363404', 'S363405',
  'S363406', 'S363407', 'S363408', 'S363409', 'S363414', 'S363415', 'S363416',
  'S363417', 'S363418', 'S363420', 'S363424', 'S363426', 'S363427', 'S363429',
  'S363431', 'S363432', 'S363434', 'S363435', 'S363436', 'S363437', 'S363438',
  'S363439', 'S363440', 'S363441', 'S363442', 'S363443', 'S363444', 'S363445',
  'S363446', 'S363447', 'S363448', 'S363449', 'S363450', 'S363451', 'S363452',
  'S363453', 'S363454', 'S363455', 'S363456', 'S363457', 'S363458', 'S363459',
  'S363460', 'S363461', 'S363462', 'S363463', 'S363464', 'S363468', 'S363469',
  'S363470', 'S363471', 'S363472', 'S363473', 'S363474', 'S363477', 'S363478',
  'S363479', 'S363481', 'S363482', 'S363483', 'S363484', 'S363485', 'S363486',
  'S363487', 'S363488', 'S363489', 'S363490', 'S363491', 'S363492', 'S363493',
  'S363494', 'S363495', 'S363496', 'S363497', 'S363498', 'S363499', 'S363500',
  'S363501', 'S363502', 'S363503', 'S363504', 'S363505', 'S363506', 'S363507',
  'S363508', 'S363509', 'S363510', 'S363511', 'S363512', 'S363513', 'S363514'
];

async function check() {
  console.log(`Checking ${shopifyOnlyOrders.length} orders that are in Shopify but not in our queue...\n`);

  // Check if they exist in Supabase at all (any status)
  const { data: existingOrders, error } = await supabase
    .from('orders')
    .select('order_name, fulfillment_status, canceled, is_restoration, financial_status, warehouse, created_at')
    .in('order_name', shopifyOnlyOrders);

  if (error) {
    console.error('Error:', error);
    return;
  }

  const existingSet = new Set(existingOrders?.map(o => o.order_name) || []);
  const trulyMissing: string[] = [];

  for (const orderName of shopifyOnlyOrders) {
    if (!existingSet.has(orderName)) {
      trulyMissing.push(orderName);
    }
  }

  console.log(`=== RESULTS ===\n`);
  console.log(`Orders checked: ${shopifyOnlyOrders.length}`);
  console.log(`Found in Supabase (some status): ${existingOrders?.length || 0}`);
  console.log(`Truly missing from Supabase: ${trulyMissing.length}`);

  if (existingOrders && existingOrders.length > 0) {
    console.log(`\n=== ORDERS THAT EXIST BUT WEREN'T IN QUEUE ===\n`);

    // Group by reason they're not in queue
    const fulfilled: typeof existingOrders = [];
    const canceled: typeof existingOrders = [];
    const restoration: typeof existingOrders = [];
    const noWarehouse: typeof existingOrders = [];
    const other: typeof existingOrders = [];

    for (const o of existingOrders) {
      if (o.fulfillment_status === 'fulfilled') {
        fulfilled.push(o);
      } else if (o.canceled) {
        canceled.push(o);
      } else if (o.is_restoration) {
        restoration.push(o);
      } else if (!o.warehouse) {
        noWarehouse.push(o);
      } else {
        other.push(o);
      }
    }

    console.log('Reason not in queue:');
    console.log(`  Already fulfilled: ${fulfilled.length}`);
    console.log(`  Canceled: ${canceled.length}`);
    console.log(`  Restoration order: ${restoration.length}`);
    console.log(`  No warehouse assigned: ${noWarehouse.length}`);
    console.log(`  Other (should be in queue?): ${other.length}`);

    if (other.length > 0) {
      console.log('\n--- "Other" orders (should be in queue but aren\'t?): ---');
      for (const o of other.slice(0, 20)) {
        console.log(`  ${o.order_name} | ${o.warehouse} | ${o.fulfillment_status || 'unfulfilled'} | canceled=${o.canceled} | restoration=${o.is_restoration}`);
      }
    }

    if (noWarehouse.length > 0) {
      console.log('\n--- Orders with no warehouse: ---');
      for (const o of noWarehouse.slice(0, 10)) {
        console.log(`  ${o.order_name} | ${o.created_at?.slice(0, 10)} | ${o.financial_status}`);
      }
    }
  }

  if (trulyMissing.length > 0) {
    console.log(`\n=== TRULY MISSING FROM SUPABASE (${trulyMissing.length}) ===\n`);

    // Sort and show ranges
    trulyMissing.sort();
    console.log('Sample:', trulyMissing.slice(0, 20).join(', '));
    if (trulyMissing.length > 20) {
      console.log(`... and ${trulyMissing.length - 20} more`);
    }

    // Check date ranges based on order numbers
    const oldest = trulyMissing[0];
    const newest = trulyMissing[trulyMissing.length - 1];
    console.log(`\nRange: ${oldest} to ${newest}`);
  }
}

check();
