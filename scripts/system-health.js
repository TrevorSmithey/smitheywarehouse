const https = require('https');
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwZmtweG95dWNvY3JpaWZ1dGZ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDg3MjY3MiwiZXhwIjoyMDgwNDQ4NjcyfQ.LWItXKQ9KBeb4KQN-5nqYrAOSJdBgjAX5booH38alGg';
const baseUrl = 'https://rpfkpxoyucocriifutfy.supabase.co/rest/v1';

function fetch(path) {
  return new Promise((resolve, reject) => {
    const req = https.get(baseUrl + path, {
      headers: { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Prefer': 'count=exact' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const count = res.headers['content-range']?.split('/')[1] || null;
        resolve({ data: JSON.parse(data), count: count ? parseInt(count) : null });
      });
    });
    req.on('error', reject);
  });
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           SMITHEY WAREHOUSE SYSTEM HEALTH CHECK              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // 1. Table sizes
  console.log('📊 DATABASE TABLE SIZES');
  console.log('─'.repeat(50));

  const tables = [
    { name: 'ns_wholesale_customers', path: '/ns_wholesale_customers?select=ns_customer_id&limit=1' },
    { name: 'ns_wholesale_transactions', path: '/ns_wholesale_transactions?select=ns_transaction_id&limit=1' },
    { name: 'ns_wholesale_line_items', path: '/ns_wholesale_line_items?select=id&limit=1' },
    { name: 'orders', path: '/orders?select=id&limit=1' },
    { name: 'line_items', path: '/line_items?select=id&limit=1' },
    { name: 'shiphero_shipments', path: '/shiphero_shipments?select=id&limit=1' },
    { name: 'klaviyo_profiles', path: '/klaviyo_profiles?select=id&limit=1' },
    { name: 'b2b_draft_orders', path: '/b2b_draft_orders?select=id&limit=1' },
    { name: 'ns_pl_data', path: '/ns_pl_data?select=id&limit=1' },
    { name: 'sync_logs', path: '/sync_logs?select=id&limit=1' },
  ];

  for (const t of tables) {
    try {
      const result = await fetch(t.path);
      const count = result.count || 'N/A';
      const status = count === 'N/A' ? '⚠️' : (count > 100000 ? '🔶' : '✅');
      console.log(`  ${status} ${t.name.padEnd(28)} ${String(count).padStart(10)} rows`);
    } catch (e) {
      console.log(`  ❌ ${t.name.padEnd(28)} ERROR`);
    }
  }

  // 2. Sync job health
  console.log('\n📡 CRON SYNC HEALTH (Last 7 days)');
  console.log('─'.repeat(50));

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const syncResult = await fetch(`/sync_logs?select=sync_type,status,records_synced,started_at,error_message&started_at=gte.${weekAgo}&order=started_at.desc&limit=200`);

  const byType = {};
  syncResult.data.forEach(r => {
    if (!byType[r.sync_type]) byType[r.sync_type] = { success: 0, error: 0, total: 0, lastRun: null, lastStatus: null };
    byType[r.sync_type].total++;
    if (r.status === 'success' || r.status === 'completed') byType[r.sync_type].success++;
    else byType[r.sync_type].error++;
    if (!byType[r.sync_type].lastRun) {
      byType[r.sync_type].lastRun = r.started_at;
      byType[r.sync_type].lastStatus = r.status;
    }
  });

  Object.keys(byType).sort().forEach(type => {
    const s = byType[type];
    const rate = ((s.success / s.total) * 100).toFixed(0);
    const status = s.error === 0 ? '✅' : (s.error < 3 ? '🔶' : '❌');
    const lastRun = s.lastRun ? s.lastRun.substring(0, 16).replace('T', ' ') : 'Never';
    console.log(`  ${status} ${type.padEnd(24)} ${rate}% success (${s.success}/${s.total}) | Last: ${lastRun}`);
  });

  // 3. Data freshness
  console.log('\n🕐 DATA FRESHNESS');
  console.log('─'.repeat(50));

  const freshnessChecks = [
    { name: 'Shopify Orders', path: '/orders?select=created_at&order=created_at.desc&limit=1' },
    { name: 'ShipHero Shipments', path: '/shiphero_shipments?select=created_at&order=created_at.desc&limit=1' },
    { name: 'NS Transactions', path: '/ns_wholesale_transactions?select=synced_at&order=synced_at.desc&limit=1' },
    { name: 'Klaviyo Profiles', path: '/klaviyo_profiles?select=updated_at&order=updated_at.desc&limit=1' },
    { name: 'B2B Draft Orders', path: '/b2b_draft_orders?select=synced_at&order=synced_at.desc&limit=1' },
  ];

  for (const check of freshnessChecks) {
    try {
      const result = await fetch(check.path);
      if (result.data && result.data[0]) {
        const dateField = Object.values(result.data[0])[0];
        const date = new Date(dateField);
        const hoursAgo = ((Date.now() - date.getTime()) / (1000 * 60 * 60)).toFixed(1);
        const status = hoursAgo < 2 ? '✅' : (hoursAgo < 24 ? '🔶' : '❌');
        console.log(`  ${status} ${check.name.padEnd(22)} ${hoursAgo}h ago (${dateField.substring(0, 16)})`);
      }
    } catch (e) {
      console.log(`  ❌ ${check.name.padEnd(22)} ERROR`);
    }
  }

  // 4. Summary
  console.log('\n' + '═'.repeat(50));
  console.log('📋 SUMMARY');
  console.log('─'.repeat(50));

  const totalErrors = Object.values(byType).reduce((sum, s) => sum + s.error, 0);
  const totalJobs = Object.values(byType).reduce((sum, s) => sum + s.total, 0);

  if (totalErrors === 0) {
    console.log('  ✅ All syncs healthy - 0 failures in past 7 days');
  } else {
    console.log(`  ⚠️  ${totalErrors} sync failures out of ${totalJobs} jobs`);
  }

  console.log('\n');
}

main().catch(console.error);
