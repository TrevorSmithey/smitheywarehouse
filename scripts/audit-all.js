const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function auditBudgets() {
  console.log('\n=== BUDGET DATA AUDIT ===\n');

  const budgetPath = path.join(process.cwd(), 'data', 'monthly-budgets.json');
  const budgets = JSON.parse(fs.readFileSync(budgetPath, 'utf-8'));

  const csvPath = '/Users/trevorfunderburk/Downloads/2026 forecast.csv';
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n').filter(l => l.trim() && !l.startsWith(','));

  console.log('Comparing JSON to CSV source...\n');

  let errors = 0;
  for (const line of lines.slice(1)) {
    const parts = line.split(',');
    const sku = parts[0].trim();
    if (!sku || sku === 'Summary' || sku === 'Cookware' || sku.includes('w/lids')) continue;

    const dec25Raw = parts[1]?.replace(/"/g, '').replace(/,/g, '').trim();
    const dec25Csv = parseInt(dec25Raw) || 0;

    const jan26Raw = parts[2]?.replace(/"/g, '').replace(/,/g, '').trim();
    const jan26Csv = parseInt(jan26Raw) || 0;

    const dec25Json = budgets['2025']?.[sku]?.['Dec'];
    const jan26Json = budgets['2026']?.[sku]?.['Jan'];

    if (dec25Csv !== 0 && dec25Json !== dec25Csv) {
      console.log('MISMATCH Dec-25:', sku, 'CSV:', dec25Csv, 'JSON:', dec25Json);
      errors++;
    }
    if (jan26Csv !== 0 && jan26Json !== jan26Csv) {
      console.log('MISMATCH Jan-26:', sku, 'CSV:', jan26Csv, 'JSON:', jan26Json);
      errors++;
    }
  }

  if (errors === 0) {
    console.log('✓ All budget values match CSV source.');
  } else {
    console.log('\n✗ Total budget mismatches:', errors);
  }
}

async function auditDOI() {
  console.log('\n=== DOI CALCULATION AUDIT ===\n');

  const budgetPath = path.join(process.cwd(), 'data', 'monthly-budgets.json');
  const budgets = JSON.parse(fs.readFileSync(budgetPath, 'utf-8'));

  // Test cases with known values
  const testCases = [
    { sku: 'Smith-CS-Farm12', inventory: 1864, expectedApprox: 69 },
    { sku: 'Smith-CI-Skil12', inventory: 6852, expectedApprox: 27 },
    { sku: 'Smith-CS-WokM', inventory: 454, expectedApprox: 15 },
  ];

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  for (const test of testCases) {
    const { sku, inventory, expectedApprox } = test;
    console.log(`\nTesting ${sku} with ${inventory} units:`);

    // Manual DOI calculation
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth();
    let dayOfMonth = now.getDate();
    let remainingInventory = inventory;
    let totalDays = 0;

    console.log(`  Starting: ${MONTH_NAMES[month]} ${dayOfMonth}, ${year}`);

    while (remainingInventory > 0 && totalDays < 365) {
      const daysInMonth = DAYS_IN_MONTH[month];
      const daysRemaining = daysInMonth - dayOfMonth + 1;

      const yearData = budgets[year.toString()];
      const skuData = yearData?.[sku];
      const monthBudget = skuData?.[MONTH_NAMES[month]] || 0;

      if (monthBudget === 0) {
        console.log(`  ${MONTH_NAMES[month]} ${year}: No budget, skipping ${daysRemaining} days`);
        totalDays += daysRemaining;
        month++;
        if (month > 11) { month = 0; year++; }
        dayOfMonth = 1;
        continue;
      }

      const dailyDemand = monthBudget / daysInMonth;
      const demandThisMonth = dailyDemand * daysRemaining;

      console.log(`  ${MONTH_NAMES[month]} ${year}: budget=${monthBudget}, daily=${dailyDemand.toFixed(1)}, demand=${demandThisMonth.toFixed(0)}, inv=${remainingInventory}`);

      if (remainingInventory <= demandThisMonth) {
        const daysUntilStockout = remainingInventory / dailyDemand;
        totalDays += daysUntilStockout;
        console.log(`  STOCKOUT in ${daysUntilStockout.toFixed(1)} days`);
        break;
      }

      remainingInventory -= demandThisMonth;
      totalDays += daysRemaining;
      month++;
      if (month > 11) { month = 0; year++; }
      dayOfMonth = 1;
    }

    const calculatedDOI = Math.round(totalDays);
    const diff = Math.abs(calculatedDOI - expectedApprox);
    const status = diff <= 5 ? '✓' : '✗';
    console.log(`  Result: ${calculatedDOI}d (expected ~${expectedApprox}d) ${status}`);
  }
}

async function auditMonthSold() {
  console.log('\n=== MONTH SOLD AUDIT ===\n');

  const monthStart = '2025-12-01T00:00:00.000Z';
  const monthEnd = '2025-12-31T23:59:59.999Z';

  const { data: salesData, error } = await supabase
    .from('line_items')
    .select('sku, quantity, orders!inner(created_at, canceled)')
    .gte('orders.created_at', monthStart)
    .lte('orders.created_at', monthEnd)
    .eq('orders.canceled', false);

  if (error) {
    console.log('Query error:', error.message);
    return;
  }

  // Aggregate by SKU (case-insensitive)
  const bySku = new Map();
  for (const item of salesData || []) {
    if (item.sku) {
      const lower = item.sku.toLowerCase();
      bySku.set(lower, (bySku.get(lower) || 0) + (item.quantity || 0));
    }
  }

  console.log('Total line_items in December:', salesData?.length);
  console.log('Unique SKUs with sales:', bySku.size);

  // Top 10 by sales
  const sorted = [...bySku.entries()].sort((a, b) => b[1] - a[1]);
  console.log('\nTop 10 SKUs by December sales:');
  for (const [sku, qty] of sorted.slice(0, 10)) {
    console.log(`  ${sku}: ${qty}`);
  }

  // Check specific SKUs
  console.log('\nSpecific SKU checks:');
  const checkSkus = ['smith-cs-wokm', 'smith-ci-skil12', 'smith-cs-farm12', 'smith-ac-scrub1'];
  for (const sku of checkSkus) {
    console.log(`  ${sku}: ${bySku.get(sku) || 0}`);
  }
}

async function auditInventoryTotals() {
  console.log('\n=== INVENTORY TOTALS AUDIT ===\n');

  const { data: inventory } = await supabase
    .from('inventory')
    .select('sku, warehouse_id, on_hand');

  const WAREHOUSE_IDS = {
    120758: 'pipefitter',
    77373: 'hobson',
    93742: 'selery',
  };

  // Group by SKU
  const bySkuWarehouse = new Map();
  for (const inv of inventory || []) {
    const key = inv.sku;
    if (!bySkuWarehouse.has(key)) {
      bySkuWarehouse.set(key, { pipefitter: 0, hobson: 0, selery: 0, total: 0 });
    }
    const entry = bySkuWarehouse.get(key);
    const wh = WAREHOUSE_IDS[inv.warehouse_id];
    if (wh) {
      entry[wh] = inv.on_hand;
      entry.total += inv.on_hand;
    }
  }

  console.log('Total SKUs in inventory:', bySkuWarehouse.size);

  // Grand totals
  let grandPipefitter = 0, grandHobson = 0, grandSelery = 0, grandTotal = 0;
  for (const [sku, data] of bySkuWarehouse) {
    grandPipefitter += data.pipefitter;
    grandHobson += data.hobson;
    grandSelery += data.selery;
    grandTotal += data.total;
  }

  console.log('\nGrand totals:');
  console.log(`  Pipefitter: ${grandPipefitter.toLocaleString()}`);
  console.log(`  Hobson: ${grandHobson.toLocaleString()}`);
  console.log(`  Selery: ${grandSelery.toLocaleString()}`);
  console.log(`  Total: ${grandTotal.toLocaleString()}`);

  // Check for negative inventory
  const negative = [...bySkuWarehouse.entries()].filter(([_, d]) => d.total < 0);
  console.log('\nNegative inventory SKUs:', negative.length);
  for (const [sku, data] of negative) {
    console.log(`  ${sku}: ${data.total}`);
  }
}

async function auditCodeMapLookups() {
  console.log('\n=== CODE MAP LOOKUP AUDIT ===\n');

  const routePath = path.join(process.cwd(), 'app', 'api', 'inventory', 'route.ts');
  const routeCode = fs.readFileSync(routePath, 'utf-8');

  // Find all .get() calls
  const getMatches = routeCode.match(/\.get\([^)]+\)/g) || [];
  console.log('Map .get() calls in inventory route:');
  for (const match of getMatches) {
    const hasLowerCase = match.includes('.toLowerCase()');
    const status = hasLowerCase ? '✓ case-insensitive' : '⚠ CASE-SENSITIVE';
    console.log(`  ${match} ${status}`);
  }

  // Check DOI file
  const doiPath = path.join(process.cwd(), 'lib', 'doi.ts');
  const doiCode = fs.readFileSync(doiPath, 'utf-8');

  const doiGetMatches = doiCode.match(/\.get\([^)]+\)/g) || [];
  console.log('\nMap .get() calls in doi.ts:');
  for (const match of doiGetMatches) {
    const hasLowerCase = match.includes('.toLowerCase()');
    const status = hasLowerCase ? '✓ case-insensitive' : '⚠ CASE-SENSITIVE';
    console.log(`  ${match} ${status}`);
  }
}

async function main() {
  console.log('========================================');
  console.log('       ENTERPRISE-SCALE AUDIT');
  console.log('========================================');

  await auditBudgets();
  await auditDOI();
  await auditMonthSold();
  await auditInventoryTotals();
  await auditCodeMapLookups();

  console.log('\n========================================');
  console.log('       AUDIT COMPLETE');
  console.log('========================================\n');
}

main().catch(console.error);
