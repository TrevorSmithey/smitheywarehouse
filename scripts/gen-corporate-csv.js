/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
const https = require('https');
const fs = require('fs');

const url = 'https://rpfkpxoyucocriifutfy.supabase.co/rest/v1/ns_wholesale_customers?select=ns_customer_id,entity_id,company_name,category,is_corporate_gifting&order=company_name';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwZmtweG95dWNvY3JpaWZ1dGZ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDg3MjY3MiwiZXhwIjoyMDgwNDQ4NjcyfQ.LWItXKQ9KBeb4KQN-5nqYrAOSJdBgjAX5booH38alGg';

const req = https.get(url, {
  headers: { 'apikey': key, 'Authorization': 'Bearer ' + key }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const rows = JSON.parse(data);

    // Analysis
    const nsCorporate = rows.filter(r => r.category === 'Corporate');
    const ourFlagged = rows.filter(r => r.is_corporate_gifting === true);

    // Mismatches in both directions
    const weFlaggedButNSNot = rows.filter(r =>
      r.is_corporate_gifting === true && r.category !== 'Corporate'
    );
    const nsHasButWeDidnt = rows.filter(r =>
      r.category === 'Corporate' && r.is_corporate_gifting !== true
    );

    console.log('=== Corporate Customer Analysis ===');
    console.log(`NS has category='Corporate': ${nsCorporate.length}`);
    console.log(`We flagged is_corporate_gifting=true: ${ourFlagged.length}`);
    console.log('');
    console.log(`We flagged but NS doesn't have as Corporate: ${weFlaggedButNSNot.length}`);
    console.log(`NS has as Corporate but we didn't flag: ${nsHasButWeDidnt.length}`);
    console.log('');

    // Full CSV with all corporate-related customers
    let csv = 'NS Customer ID,Entity ID,Company Name,NS Category,Our is_corporate_gifting Flag,Status\n';

    // All customers that are corporate in either system
    const allCorporate = rows.filter(r =>
      r.category === 'Corporate' || r.is_corporate_gifting === true
    );

    allCorporate.forEach(r => {
      const name = (r.company_name || '').replace(/,/g, ' ').replace(/"/g, '""');
      let status = 'In Sync';
      if (r.is_corporate_gifting === true && r.category !== 'Corporate') {
        status = 'NEEDS NS UPDATE - Change to Corporate';
      } else if (r.category === 'Corporate' && r.is_corporate_gifting !== true) {
        status = 'NS says Corporate - we have not flagged';
      }
      csv += `${r.ns_customer_id},${r.entity_id || ''},"${name}",${r.category || 'null'},${r.is_corporate_gifting || false},${status}\n`;
    });

    const outputPath = '/Users/trevorfunderburk/smitheywarehouse/corporate_customers_audit.csv';
    fs.writeFileSync(outputPath, csv);
    console.log(`Full audit CSV saved to: ${outputPath}`);
    console.log(`Total corporate-related customers: ${allCorporate.length}`);

    if (weFlaggedButNSNot.length > 0) {
      console.log('\n=== Customers needing NS update ===');
      weFlaggedButNSNot.forEach(r => console.log(`  - ${r.company_name} (current NS category: ${r.category})`));
    }

    if (nsHasButWeDidnt.length > 0) {
      console.log('\n=== NS Corporate customers we haven\'t flagged ===');
      nsHasButWeDidnt.slice(0, 20).forEach(r => console.log(`  - ${r.company_name}`));
      if (nsHasButWeDidnt.length > 20) console.log(`  ... and ${nsHasButWeDidnt.length - 20} more`);
    }
  });
});
