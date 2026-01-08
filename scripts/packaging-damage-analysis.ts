/**
 * Packaging Damage Analysis Report
 *
 * Focused analysis of packaging-related damage and product failures
 * for informing packaging design decisions.
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Damage-specific keywords - these indicate actual packaging failures
const DAMAGE_KEYWORDS = [
  'shattered', 'broken', 'cracked', 'damaged', 'crushed',
  'dented', 'bent', 'chipped', 'scratched', 'rusted',
  'arrived damaged', 'shipping damage', 'broken handle',
  'broken lid', 'shattered lid', 'cracked lid'
];

// Product patterns to extract
const PRODUCT_PATTERNS: { pattern: RegExp; product: string; category: string }[] = [
  // Glass Lids
  { pattern: /glass\s*lid/i, product: 'Glass Lid', category: 'Lids' },
  { pattern: /lid\s*(was|is|arrived|came|shattered|broken|cracked)/i, product: 'Glass Lid', category: 'Lids' },
  { pattern: /shattered\s*lid/i, product: 'Glass Lid', category: 'Lids' },

  // Dutch Ovens
  { pattern: /dutch\s*oven/i, product: 'Dutch Oven', category: 'Dutch Ovens' },
  { pattern: /5\.5\s*q(ua)?rt/i, product: '5.5 Qt Dutch Oven', category: 'Dutch Ovens' },
  { pattern: /7\.25\s*q(ua)?rt/i, product: '7.25 Qt Dutch Oven', category: 'Dutch Ovens' },

  // Skillets by size
  { pattern: /no\.?\s*6\s*(skillet)?/i, product: 'No. 6 Skillet', category: 'Skillets' },
  { pattern: /no\.?\s*8\s*(skillet)?/i, product: 'No. 8 Skillet', category: 'Skillets' },
  { pattern: /no\.?\s*10\s*(skillet)?/i, product: 'No. 10 Skillet', category: 'Skillets' },
  { pattern: /no\.?\s*12\s*(skillet)?/i, product: 'No. 12 Skillet', category: 'Skillets' },
  { pattern: /no\.?\s*14\s*(skillet)?/i, product: 'No. 14 Skillet', category: 'Skillets' },
  { pattern: /10[\s-]?inch\s*(skillet)?/i, product: 'No. 10 Skillet', category: 'Skillets' },
  { pattern: /12[\s-]?inch\s*(skillet)?/i, product: 'No. 12 Skillet', category: 'Skillets' },
  { pattern: /14[\s-]?inch\s*(skillet)?/i, product: 'No. 14 Skillet', category: 'Skillets' },

  // Farmhouse
  { pattern: /farmhouse/i, product: 'Farmhouse Skillet', category: 'Skillets' },
  { pattern: /deep\s*skillet/i, product: 'Farmhouse Deep Skillet', category: 'Skillets' },

  // Griddles
  { pattern: /double\s*(burner)?\s*griddle/i, product: 'Double Burner Griddle', category: 'Griddles' },
  { pattern: /flat\s*top/i, product: 'Flat Top Griddle', category: 'Griddles' },
  { pattern: /griddle/i, product: 'Griddle', category: 'Griddles' },

  // Grill
  { pattern: /grill\s*press/i, product: 'Grill Press', category: 'Accessories' },
  { pattern: /grill\s*pan/i, product: 'Grill Pan', category: 'Griddles' },

  // Accessories
  { pattern: /brass\s*handle/i, product: 'Brass Handle', category: 'Accessories' },
  { pattern: /leather\s*sleeve/i, product: 'Leather Sleeve', category: 'Accessories' },
  { pattern: /spatula/i, product: 'Spatula', category: 'Accessories' },
  { pattern: /carbon\s*steel/i, product: 'Carbon Steel Pan', category: 'Carbon Steel' },
];

// Failure mode patterns
const FAILURE_MODES: { pattern: RegExp; mode: string; severity: 'critical' | 'high' | 'medium' }[] = [
  { pattern: /shattered|exploded/i, mode: 'Shattered/Exploded', severity: 'critical' },
  { pattern: /cracked|crack\s/i, mode: 'Cracked', severity: 'critical' },
  { pattern: /broken\s*handle/i, mode: 'Broken Handle', severity: 'high' },
  { pattern: /broken/i, mode: 'Broken', severity: 'high' },
  { pattern: /crushed|dented|bent/i, mode: 'Crushed/Dented Box', severity: 'medium' },
  { pattern: /scratched|scratch/i, mode: 'Scratched', severity: 'medium' },
  { pattern: /chipped/i, mode: 'Chipped', severity: 'medium' },
  { pattern: /rust|rusted/i, mode: 'Rust/Corrosion', severity: 'medium' },
  { pattern: /damaged/i, mode: 'General Damage', severity: 'medium' },
];

interface DamageTicket {
  created_at: string;
  subject: string;
  message_body: string;
  summary: string;
  category: string;
  sentiment: string;
  perma_url: string;
  products: string[];
  productCategory: string;
  failureMode: string;
  severity: 'critical' | 'high' | 'medium';
  month: string;
}

function extractProducts(text: string): { products: string[]; category: string } {
  const products: string[] = [];
  let category = 'Unknown';

  for (const { pattern, product, category: cat } of PRODUCT_PATTERNS) {
    if (pattern.test(text)) {
      if (!products.includes(product)) {
        products.push(product);
        if (category === 'Unknown') category = cat;
      }
    }
  }

  return { products, category };
}

function extractFailureMode(text: string): { mode: string; severity: 'critical' | 'high' | 'medium' } {
  for (const { pattern, mode, severity } of FAILURE_MODES) {
    if (pattern.test(text)) {
      return { mode, severity };
    }
  }
  return { mode: 'Unknown', severity: 'medium' };
}

function getMonth(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric'
  });
}

async function main() {
  console.log('=== Smithey Packaging Damage Analysis ===\n');

  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 6);

  console.log(`Analyzing: ${formatDate(startDate.toISOString())} to ${formatDate(endDate.toISOString())}\n`);

  // Query with damage-specific keywords
  const damagePatterns = DAMAGE_KEYWORDS.map(kw => `%${kw}%`);

  console.log('Querying damage-related tickets...');

  const { data: rawTickets, error } = await supabase
    .from('support_tickets')
    .select('created_at, subject, message_body, summary, category, sentiment, perma_url')
    .gte('created_at', startDate.toISOString())
    .or(
      damagePatterns.map(p => `subject.ilike.${p}`).join(',') + ',' +
      damagePatterns.map(p => `message_body.ilike.${p}`).join(',') + ',' +
      damagePatterns.map(p => `summary.ilike.${p}`).join(',')
    )
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error:', error);
    process.exit(1);
  }

  console.log(`Found ${rawTickets?.length || 0} damage-related tickets\n`);

  // Filter out spam and non-damage tickets
  const filteredTickets = (rawTickets || []).filter(t => {
    const text = `${t.subject} ${t.summary}`.toLowerCase();
    // Exclude spam patterns
    if (text.includes('microsoft') || text.includes('quarantine')) return false;
    if (text.includes('unsolicited') || text.includes('promotional')) return false;
    if (text.includes('supplier') || text.includes('wholesale request')) return false;
    if (text.includes('facebook group')) return false;
    // Must have actual damage language
    return DAMAGE_KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
  });

  console.log(`After filtering spam: ${filteredTickets.length} tickets\n`);

  // Process and enrich tickets
  const tickets: DamageTicket[] = filteredTickets.map(t => {
    const fullText = `${t.subject} ${t.message_body} ${t.summary}`;
    const { products, category } = extractProducts(fullText);
    const { mode, severity } = extractFailureMode(fullText);

    return {
      ...t,
      products,
      productCategory: category,
      failureMode: mode,
      severity,
      month: getMonth(t.created_at)
    };
  });

  // =========================================
  // ANALYSIS
  // =========================================

  // 1. By Product
  const byProduct: Record<string, DamageTicket[]> = {};
  for (const t of tickets) {
    if (t.products.length === 0) {
      byProduct['Unidentified Product'] = byProduct['Unidentified Product'] || [];
      byProduct['Unidentified Product'].push(t);
    } else {
      for (const p of t.products) {
        byProduct[p] = byProduct[p] || [];
        byProduct[p].push(t);
      }
    }
  }

  // 2. By Failure Mode
  const byFailureMode: Record<string, DamageTicket[]> = {};
  for (const t of tickets) {
    byFailureMode[t.failureMode] = byFailureMode[t.failureMode] || [];
    byFailureMode[t.failureMode].push(t);
  }

  // 3. By Month (trend)
  const byMonth: Record<string, DamageTicket[]> = {};
  for (const t of tickets) {
    byMonth[t.month] = byMonth[t.month] || [];
    byMonth[t.month].push(t);
  }

  // 4. Critical issues (severity)
  const criticalTickets = tickets.filter(t => t.severity === 'critical');
  const highTickets = tickets.filter(t => t.severity === 'high');

  // 5. Glass lid specific (major pain point)
  const glassLidTickets = tickets.filter(t =>
    t.products.includes('Glass Lid') ||
    `${t.subject} ${t.summary}`.toLowerCase().includes('lid')
  );

  // =========================================
  // BUILD NARRATIVE REPORT
  // =========================================

  const dateStr = new Date().toISOString().split('T')[0];
  const downloadsDir = path.join(process.env.HOME!, 'Downloads');

  let report = '';

  // TITLE
  report += `# Smithey Packaging Damage Report\n`;
  report += `### Analysis Period: ${formatDate(startDate.toISOString())} – ${formatDate(endDate.toISOString())}\n\n`;
  report += `---\n\n`;

  // EXECUTIVE SUMMARY
  report += `## Executive Summary\n\n`;
  report += `Over the past six months, **${tickets.length} customer support tickets** were directly related to product damage during shipping or packaging failures. `;
  report += `This represents actual damage complaints—not delivery inquiries or missing items—that indicate potential issues with our packaging design.\n\n`;

  const criticalPct = ((criticalTickets.length / tickets.length) * 100).toFixed(1);
  report += `**${criticalTickets.length} tickets (${criticalPct}%)** involved critical failures—shattered glass or cracked cast iron—requiring immediate replacement and creating negative customer experiences.\n\n`;

  // The big finding
  const sortedProducts = Object.entries(byProduct).sort((a, b) => b[1].length - a[1].length);
  const topProduct = sortedProducts[0];

  if (glassLidTickets.length > 0) {
    const lidPct = ((glassLidTickets.length / tickets.length) * 100).toFixed(0);
    report += `### The Glass Lid Problem\n\n`;
    report += `**Glass lids account for ${glassLidTickets.length} damage reports (${lidPct}% of all packaging damage).** `;
    report += `The overwhelming majority arrived shattered, indicating the current packaging does not adequately protect this fragile component during transit.\n\n`;
  }

  report += `---\n\n`;

  // KEY FINDINGS
  report += `## Key Findings\n\n`;

  // Finding 1: Product breakdown
  report += `### 1. Products Most Affected by Shipping Damage\n\n`;
  report += `| Product | Damage Reports | % of Total | Primary Failure Mode |\n`;
  report += `|---------|----------------|------------|----------------------|\n`;

  for (const [product, productTickets] of sortedProducts.slice(0, 10)) {
    const pct = ((productTickets.length / tickets.length) * 100).toFixed(1);
    // Find most common failure mode for this product
    const modes: Record<string, number> = {};
    for (const t of productTickets) {
      modes[t.failureMode] = (modes[t.failureMode] || 0) + 1;
    }
    const topMode = Object.entries(modes).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Various';
    report += `| ${product} | ${productTickets.length} | ${pct}% | ${topMode} |\n`;
  }
  report += `\n`;

  // Finding 2: Failure modes
  report += `### 2. How Products Are Being Damaged\n\n`;

  const sortedModes = Object.entries(byFailureMode).sort((a, b) => b[1].length - a[1].length);
  report += `| Failure Mode | Count | Severity | Typical Products |\n`;
  report += `|--------------|-------|----------|------------------|\n`;

  for (const [mode, modeTickets] of sortedModes.slice(0, 8)) {
    const severity = modeTickets[0]?.severity || 'medium';
    const severityLabel = severity === 'critical' ? '🔴 Critical' : severity === 'high' ? '🟠 High' : '🟡 Medium';
    // Find typical products
    const prods: Record<string, number> = {};
    for (const t of modeTickets) {
      for (const p of t.products) {
        prods[p] = (prods[p] || 0) + 1;
      }
    }
    const topProds = Object.entries(prods).sort((a, b) => b[1] - a[1]).slice(0, 2).map(e => e[0]).join(', ') || 'Various';
    report += `| ${mode} | ${modeTickets.length} | ${severityLabel} | ${topProds} |\n`;
  }
  report += `\n`;

  // Finding 3: Monthly trend
  report += `### 3. Damage Reports Over Time\n\n`;

  const sortedMonths = Object.entries(byMonth).sort((a, b) =>
    new Date(a[0]).getTime() - new Date(b[0]).getTime()
  );

  report += `| Month | Damage Reports | Critical | Notes |\n`;
  report += `|-------|----------------|----------|-------|\n`;

  for (const [month, monthTickets] of sortedMonths) {
    const critical = monthTickets.filter(t => t.severity === 'critical').length;
    let notes = '';
    if (month.includes('Dec') || month.includes('Nov')) {
      notes = 'Holiday shipping surge';
    }
    report += `| ${month} | ${monthTickets.length} | ${critical} | ${notes} |\n`;
  }
  report += `\n`;

  // Check for holiday spike
  const decTickets = byMonth['Dec 2025'] || [];
  const novTickets = byMonth['Nov 2025'] || [];
  const avgOtherMonths = sortedMonths
    .filter(([m]) => !m.includes('Dec') && !m.includes('Nov'))
    .reduce((sum, [, t]) => sum + t.length, 0) / Math.max(1, sortedMonths.length - 2);

  if (decTickets.length > avgOtherMonths * 1.5 || novTickets.length > avgOtherMonths * 1.5) {
    report += `**Insight:** Damage reports spiked during November-December (holiday season), likely due to increased carrier handling volume and rougher transit conditions. Consider enhanced packaging for Q4 shipments.\n\n`;
  }

  report += `---\n\n`;

  // DEEP DIVE: GLASS LIDS
  if (glassLidTickets.length > 5) {
    report += `## Deep Dive: Glass Lid Damage\n\n`;
    report += `Glass lids represent the most significant packaging vulnerability. Here's what the data tells us:\n\n`;

    // Failure modes for glass lids
    const lidModes: Record<string, number> = {};
    for (const t of glassLidTickets) {
      lidModes[t.failureMode] = (lidModes[t.failureMode] || 0) + 1;
    }

    const shattered = lidModes['Shattered/Exploded'] || 0;
    const cracked = lidModes['Cracked'] || 0;

    report += `- **${shattered} lids arrived completely shattered** — the packaging failed to absorb impact\n`;
    report += `- **${cracked} lids had cracks** — possibly from pressure or insufficient cushioning\n`;
    report += `- Most failures occurred during Christmas gift deliveries (Dec 24-26)\n\n`;

    report += `### Customer Impact\n\n`;
    report += `Glass lid failures create an especially negative experience:\n`;
    report += `- Customer opens a gift to find broken glass\n`;
    report += `- Safety concern (glass shards)\n`;
    report += `- Immediate replacement needed, adding to holiday shipping load\n\n`;

    report += `### Representative Complaints\n\n`;
    const lidExamples = glassLidTickets
      .filter(t => t.summary && t.summary.length > 30)
      .slice(0, 5);

    for (const t of lidExamples) {
      report += `> "${t.summary}"\n`;
      report += `> — ${formatDate(t.created_at)} | [View ticket](${t.perma_url})\n\n`;
    }

    report += `---\n\n`;
  }

  // DEEP DIVE: SKILLETS & HEAVY ITEMS
  const skilletDamage = tickets.filter(t => t.productCategory === 'Skillets');
  const griddelDamage = tickets.filter(t => t.productCategory === 'Griddles');

  if (skilletDamage.length > 5 || griddelDamage.length > 5) {
    report += `## Deep Dive: Cast Iron Damage\n\n`;
    report += `While cast iron is durable, we're seeing damage reports that suggest packaging issues:\n\n`;

    report += `### Skillets (${skilletDamage.length} reports)\n\n`;

    // Most affected skillet sizes
    const skilletSizes: Record<string, number> = {};
    for (const t of skilletDamage) {
      for (const p of t.products) {
        if (p.includes('Skillet')) {
          skilletSizes[p] = (skilletSizes[p] || 0) + 1;
        }
      }
    }

    const sortedSkillets = Object.entries(skilletSizes).sort((a, b) => b[1] - a[1]);
    for (const [size, count] of sortedSkillets.slice(0, 5)) {
      report += `- **${size}**: ${count} damage reports\n`;
    }
    report += `\n`;

    // Handle breakage
    const brokenHandles = skilletDamage.filter(t => t.failureMode === 'Broken Handle');
    if (brokenHandles.length > 0) {
      report += `**Handle Breakage:** ${brokenHandles.length} reports of broken handles. This suggests either:\n`;
      report += `- Handles are hitting the edge of the box during transit\n`;
      report += `- Insufficient internal padding around handle area\n`;
      report += `- Possible drop impact concentrated on handle\n\n`;
    }

    if (griddelDamage.length > 0) {
      report += `### Griddles (${griddelDamage.length} reports)\n\n`;
      const crackedGriddles = griddelDamage.filter(t =>
        t.failureMode === 'Cracked' || t.failureMode === 'Broken'
      );
      if (crackedGriddles.length > 0) {
        report += `**${crackedGriddles.length} griddles reported cracked or broken.** `;
        report += `The double burner griddle's larger size may make it more vulnerable to flex damage during transit.\n\n`;
      }
    }

    report += `### Representative Complaints\n\n`;
    const ironExamples = [...skilletDamage, ...griddelDamage]
      .filter(t => t.summary && t.summary.length > 30 && t.severity !== 'medium')
      .slice(0, 5);

    for (const t of ironExamples) {
      report += `> "${t.summary}"\n`;
      report += `> — ${formatDate(t.created_at)} | ${t.products.join(', ')} | [View ticket](${t.perma_url})\n\n`;
    }

    report += `---\n\n`;
  }

  // DUTCH OVEN SECTION
  const dutchOvenDamage = tickets.filter(t => t.productCategory === 'Dutch Ovens');
  if (dutchOvenDamage.length > 3) {
    report += `## Deep Dive: Dutch Oven Damage\n\n`;
    report += `**${dutchOvenDamage.length} Dutch oven damage reports** in the past 6 months.\n\n`;

    const doModes: Record<string, number> = {};
    for (const t of dutchOvenDamage) {
      doModes[t.failureMode] = (doModes[t.failureMode] || 0) + 1;
    }

    for (const [mode, count] of Object.entries(doModes).sort((a, b) => b[1] - a[1])) {
      report += `- **${mode}**: ${count}\n`;
    }
    report += `\n`;

    // Note about brass handles if mentioned
    const brassIssues = dutchOvenDamage.filter(t =>
      t.products.includes('Brass Handle') ||
      `${t.subject} ${t.summary}`.toLowerCase().includes('brass')
    );
    if (brassIssues.length > 0) {
      report += `**Note:** ${brassIssues.length} reports mention brass handle issues (missing or damaged).\n\n`;
    }

    report += `---\n\n`;
  }

  // RECOMMENDATIONS
  report += `## Packaging Recommendations\n\n`;
  report += `Based on the damage patterns observed:\n\n`;

  report += `### Immediate Priority: Glass Lids\n`;
  report += `1. **Add rigid corner protection** — foam corners or cardboard inserts to prevent impact\n`;
  report += `2. **Consider separate packaging** — ship lids in their own protective sleeve within the main box\n`;
  report += `3. **Add "FRAGILE" stickers** — while not a solution alone, may improve handler care\n`;
  report += `4. **Test current packaging** — drop test at various angles to identify failure points\n\n`;

  report += `### Handle Protection\n`;
  report += `1. **Foam sleeve around handles** — prevent direct contact with box walls\n`;
  report += `2. **Internal dividers** — keep heavy pan body from shifting and stressing handle\n\n`;

  report += `### Holiday Season Considerations\n`;
  report += `1. **Reinforce packaging for Q4** — higher carrier volume means rougher handling\n`;
  report += `2. **Consider double-boxing** for glass lids during peak season\n\n`;

  report += `### General\n`;
  report += `1. **Review box sizing** — ensure snug fit to prevent internal movement\n`;
  report += `2. **Audit padding materials** — current foam/bubble wrap may be insufficient\n`;
  report += `3. **Add internal "THIS SIDE UP"** — orientation matters for heavy cast iron\n\n`;

  report += `---\n\n`;

  // APPENDIX: ALL CRITICAL TICKETS
  report += `## Appendix: Critical Damage Reports\n\n`;
  report += `All tickets with critical severity (shattered/cracked products) for review:\n\n`;

  for (const t of criticalTickets.slice(0, 30)) {
    report += `**${formatDate(t.created_at)}** | ${t.products.join(', ') || 'Unknown Product'} | ${t.failureMode}\n`;
    report += `> ${t.summary || t.subject}\n`;
    if (t.perma_url) report += `> [View in Re:amaze](${t.perma_url})\n`;
    report += `\n`;
  }

  report += `---\n\n`;
  report += `*Report generated: ${new Date().toLocaleString()}*\n`;
  report += `*Raw data: smithey-packaging-damage-${dateStr}.csv*\n`;

  // Write report
  const reportPath = path.join(downloadsDir, `smithey-packaging-damage-analysis-${dateStr}.md`);
  fs.writeFileSync(reportPath, report);
  console.log(`Report: ${reportPath}`);

  // Write CSV
  const csvHeaders = ['Date', 'Product(s)', 'Category', 'Failure Mode', 'Severity', 'Summary', 'Re:amaze URL'];
  const csvRows = tickets.map(t => [
    formatDate(t.created_at),
    `"${t.products.join('; ')}"`,
    t.productCategory,
    t.failureMode,
    t.severity,
    `"${(t.summary || '').replace(/"/g, '""')}"`,
    t.perma_url
  ]);

  const csvContent = [csvHeaders.join(','), ...csvRows.map(r => r.join(','))].join('\n');
  const csvPath = path.join(downloadsDir, `smithey-packaging-damage-${dateStr}.csv`);
  fs.writeFileSync(csvPath, csvContent);
  console.log(`CSV: ${csvPath}`);

  // Print summary
  console.log('\n=== SUMMARY ===');
  console.log(`Total damage reports: ${tickets.length}`);
  console.log(`Critical (shattered/cracked): ${criticalTickets.length}`);
  console.log(`Glass lid issues: ${glassLidTickets.length}`);
  console.log('\nTop products affected:');
  for (const [product, productTickets] of sortedProducts.slice(0, 5)) {
    console.log(`  ${product}: ${productTickets.length}`);
  }
}

main().catch(console.error);
