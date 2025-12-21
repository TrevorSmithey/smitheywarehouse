const https = require('https');
const url = 'https://rpfkpxoyucocriifutfy.supabase.co/rest/v1/ns_wholesale_customers?select=company_name,category,is_corporate,is_corporate_gifting&order=company_name';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwZmtweG95dWNvY3JpaWZ1dGZ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDg3MjY3MiwiZXhwIjoyMDgwNDQ4NjcyfQ.LWItXKQ9KBeb4KQN-5nqYrAOSJdBgjAX5booH38alGg';

const req = https.get(url, {
  headers: { 'apikey': key, 'Authorization': 'Bearer ' + key }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const rows = JSON.parse(data);

    // Count different combinations
    const stats = {
      bothTrue: 0,
      bothFalse: 0,
      isCorporateOnly: 0,
      isCorpGiftingOnly: 0
    };

    const mismatches = [];

    rows.forEach(r => {
      const ic = r.is_corporate === true;
      const icg = r.is_corporate_gifting === true;

      if (ic && icg) stats.bothTrue++;
      else if (ic === false && icg === false) stats.bothFalse++;
      else if ((ic === null || ic === false) && (icg === null || icg === false)) stats.bothFalse++;
      else if (ic && (icg === false || icg === null)) {
        stats.isCorporateOnly++;
        mismatches.push({name: r.company_name, cat: r.category, is_corporate: ic, is_corporate_gifting: icg});
      }
      else if ((ic === false || ic === null) && icg) {
        stats.isCorpGiftingOnly++;
        mismatches.push({name: r.company_name, cat: r.category, is_corporate: ic, is_corporate_gifting: icg});
      }
    });

    console.log('=== is_corporate vs is_corporate_gifting analysis ===');
    console.log('Both true: ' + stats.bothTrue);
    console.log('Both false/null: ' + stats.bothFalse);
    console.log('is_corporate=true ONLY: ' + stats.isCorporateOnly);
    console.log('is_corporate_gifting=true ONLY: ' + stats.isCorpGiftingOnly);

    if (mismatches.length > 0) {
      console.log('\nMismatches:');
      mismatches.slice(0, 30).forEach(m => {
        console.log(`  ${m.name} | cat: ${m.cat} | is_corporate: ${m.is_corporate} | is_corporate_gifting: ${m.is_corporate_gifting}`);
      });
      if (mismatches.length > 30) console.log(`  ... and ${mismatches.length - 30} more`);
    }
  });
});
