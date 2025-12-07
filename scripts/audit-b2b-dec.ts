import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_KEY as string
);

// Expected from CSV audit file
const csvExpected: Record<string, number> = {
  'Smith-CI-Skil12': 289,
  'Smith-CI-Skil10': 277,
  'Smith-CI-Skil8': 217,
  'Smith-AC-Scrub1': 147,
  'Smith-AC-Glid12': 147,
  'Smith-CI-Dual6': 123,
  'Smith-CI-Dutch5': 107,
  'Smith-CI-Griddle18': 105,
  'Smith-AC-SpatB1': 87,
  'Smith-AC-Season': 87,
  'Smith-AC-SpatW1': 78,
  'Smith-AC-Sleeve1': 75,
  'Smith-AC-CareKit': 74,
  'Smith-CI-DSkil11': 71,
  'Smith-AC-Glid14': 55,
  'Smith-AC-Sleeve2': 49,
  'Smith-CI-Tradskil14': 47,
  'Smith-AC-Glid10': 44,
  'Smith-CS-Farm12': 41,
  'Smith-CI-Dutch7': 39,
  'Smith-CS-Rroastm': 38,
  'Smith-CS-Deep12': 38,
  'Smith-CI-Flat12': 35,
  'Smith-CS-Wokm': 26,
  'Smith-CI-Grill12': 26,
  'Smith-CI-Skil14': 19,
  'Smith-AC-PHTLg': 18,
  'Smith-CS-Farm9': 17,
  'Smith-CI-Flat10': 14,
  'Smith-CS-Round17N': 13,
  'Smith-Bottle1': 12,
  'Smith-AC-KeeperW': 12,
  'Smith-CS-Fish': 10,
  'Smith-AC-FGph': 10,
  'Smith-CI-Chef10': 6,
  'Smith-CS-OvalM': 3,
};

async function auditB2B() {
  // Get all B2B fulfilled for December 2025
  const { data, error } = await supabase
    .from('b2b_fulfilled')
    .select('sku, quantity, fulfilled_at, order_name')
    .gte('fulfilled_at', '2025-12-01')
    .lt('fulfilled_at', '2025-12-08');

  if (error) {
    console.error('Error:', error);
    return;
  }

  // Aggregate by SKU
  const supabaseTotals: Record<string, number> = {};
  for (const row of data || []) {
    const sku = row.sku;
    supabaseTotals[sku] = (supabaseTotals[sku] || 0) + row.quantity;
  }

  // Compare
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  B2B AUDIT: CSV (Expected) vs Supabase (Actual) - Dec 1-7, 2025   ');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const allSkus = new Set([...Object.keys(csvExpected), ...Object.keys(supabaseTotals)]);
  const discrepancies: Array<{sku: string, csv: number, db: number, diff: number}> = [];

  for (const sku of allSkus) {
    if (!sku.startsWith('Smith-') || sku.includes('Eng') || sku.includes('Gift') ||
        sku.includes('Cook-Stand') || sku.includes('Display') || sku.includes('Ornament')) continue;

    const csv = csvExpected[sku] || 0;
    const db = supabaseTotals[sku] || 0;
    const diff = db - csv;

    if (diff !== 0) {
      discrepancies.push({ sku, csv, db, diff });
    }
  }

  // Sort by absolute difference
  discrepancies.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  console.log('SKU'.padEnd(25) + 'CSV'.padStart(8) + 'Supabase'.padStart(10) + 'Diff'.padStart(10));
  console.log('─'.repeat(53));

  for (const { sku, csv, db, diff } of discrepancies) {
    const diffStr = diff > 0 ? `+${diff}` : `${diff}`;
    const status = diff > 0 ? '⬆️' : '⬇️';
    console.log(`${sku.padEnd(25)}${csv.toString().padStart(8)}${db.toString().padStart(10)}${diffStr.padStart(10)} ${status}`);
  }

  console.log('\n─────────────────────────────────────────────────────────');

  // Totals
  const csvTotal = Object.values(csvExpected).reduce((a, b) => a + b, 0);
  const dbTotal = Object.values(supabaseTotals)
    .filter((_, i) => {
      const sku = Object.keys(supabaseTotals)[i];
      return sku.startsWith('Smith-') && !sku.includes('Eng') && !sku.includes('Gift') && !sku.includes('Ornament');
    })
    .reduce((a, b) => a + b, 0);

  console.log(`CSV Total:      ${csvTotal}`);
  console.log(`Supabase Total: ${dbTotal}`);
  console.log(`Difference:     ${dbTotal - csvTotal}`);
  console.log('');

  // Check specific orders - look for orders from CSV that should exist
  console.log('\nChecking if CSV orders exist in Supabase...');
  const csvOrders = ['PO-11335', 'PO-11340', 'PO-11346', 'PO-11375', 'PO-11429', 'PO-11437'];

  for (const orderName of csvOrders) {
    const { data: orderData } = await supabase
      .from('b2b_fulfilled')
      .select('order_name, sku, quantity, fulfilled_at')
      .eq('order_name', orderName);

    if (orderData && orderData.length > 0) {
      console.log(`\n  ${orderName} FOUND:`);
      orderData.forEach(o => console.log(`    ${o.sku}: ${o.quantity} (fulfilled: ${o.fulfilled_at})`));
    } else {
      console.log(`\n  ${orderName} NOT FOUND in b2b_fulfilled`);
    }
  }

  // What's the date range of data in Supabase?
  console.log('\n\nDate range in b2b_fulfilled:');
  const { data: minDate } = await supabase
    .from('b2b_fulfilled')
    .select('fulfilled_at')
    .order('fulfilled_at', { ascending: true })
    .limit(1);

  const { data: maxDate } = await supabase
    .from('b2b_fulfilled')
    .select('fulfilled_at')
    .order('fulfilled_at', { ascending: false })
    .limit(1);

  console.log(`  Earliest: ${minDate?.[0]?.fulfilled_at}`);
  console.log(`  Latest:   ${maxDate?.[0]?.fulfilled_at}`);

  // Total records
  const { count } = await supabase
    .from('b2b_fulfilled')
    .select('*', { count: 'exact', head: true });

  console.log(`  Total records: ${count}`);
}

auditB2B();
