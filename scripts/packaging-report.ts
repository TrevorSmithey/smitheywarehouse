/**
 * Packaging Complaints Report
 *
 * Pulls all customer complaints related to packaging from the last 6 months
 * Exports raw data to CSV and generates an analyzed summary report
 *
 * Usage:
 * NEXT_PUBLIC_SUPABASE_URL="..." SUPABASE_SERVICE_KEY="..." npx tsx scripts/packaging-report.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Keywords to search for packaging-related complaints
const PACKAGING_KEYWORDS = [
  // Packaging terms
  'packaging', 'package', 'packaged', 'packing',
  'box', 'boxes', 'boxed', 'carton',
  'unboxing', 'unpack', 'unpacking',

  // Damage terms
  'damaged', 'damage', 'dent', 'dented', 'bent',
  'crushed', 'scratched', 'broken',
  'arrived damaged', 'shipping damage',
  'cracked',

  // Protection/materials
  'bubble wrap', 'foam', 'padding', 'insert',
  'protection', 'protective', 'wrapped',

  // Presentation
  'presentation', 'gift box', 'gift packaging',
  'tissue paper',

  // Experience issues
  'hard to open', 'difficult to open',
  'tape', 'sealed', 'over-taped',
  'missing insert', 'missing card'
];

// Theme classification rules
const THEME_RULES: { theme: string; keywords: string[]; description: string }[] = [
  {
    theme: 'Damage in Transit',
    keywords: ['arrived damaged', 'shipping damage', 'damaged in shipping', 'damaged during shipping', 'broken', 'cracked lid', 'shattered'],
    description: 'Products arriving damaged due to shipping'
  },
  {
    theme: 'Box/Carton Issues',
    keywords: ['crushed box', 'dented box', 'torn box', 'box was', 'carton', 'outer box', 'shipping box'],
    description: 'Crushed, dented, or torn packaging boxes'
  },
  {
    theme: 'Insufficient Protection',
    keywords: ['bubble wrap', 'foam', 'padding', 'not enough', 'poorly packed', 'insufficient', 'protection', 'wrapped'],
    description: 'Inadequate padding or protective materials'
  },
  {
    theme: 'Unboxing Experience',
    keywords: ['hard to open', 'difficult to open', 'tape', 'sealed', 'over-taped', 'unboxing', 'unpack'],
    description: 'Difficulty opening or unpleasant unboxing experience'
  },
  {
    theme: 'Presentation',
    keywords: ['presentation', 'gift box', 'gift packaging', 'tissue paper', 'looked', 'aesthetic', 'premium'],
    description: 'Gift boxing, presentation quality, aesthetics'
  },
  {
    theme: 'Missing Items',
    keywords: ['missing', 'insert', 'card', 'instructions', 'seasoning', 'care card', 'not included'],
    description: 'Missing inserts, cards, or accessories'
  }
];

interface Ticket {
  created_at: string;
  subject: string;
  message_body: string;
  summary: string;
  category: string;
  sentiment: string;
  perma_url: string;
}

interface CategorizedTicket extends Ticket {
  themes: string[];
}

function classifyThemes(ticket: Ticket): string[] {
  const themes: string[] = [];
  const searchText = `${ticket.subject} ${ticket.message_body} ${ticket.summary}`.toLowerCase();

  for (const rule of THEME_RULES) {
    for (const keyword of rule.keywords) {
      if (searchText.includes(keyword.toLowerCase())) {
        if (!themes.includes(rule.theme)) {
          themes.push(rule.theme);
        }
        break;
      }
    }
  }

  // If no specific theme matched, classify as "Other Packaging Issue"
  if (themes.length === 0) {
    themes.push('Other Packaging Issue');
  }

  return themes;
}

function escapeCSV(value: string | null | undefined): string {
  if (!value) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

async function main() {
  console.log('=== Smithey Packaging Complaints Report ===\n');

  // Calculate date range (last 6 months)
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 6);

  console.log(`Date range: ${formatDate(startDate.toISOString())} to ${formatDate(endDate.toISOString())}\n`);

  // Build ILIKE patterns for each keyword
  const patterns = PACKAGING_KEYWORDS.map(kw => `%${kw}%`);

  // Query tickets with packaging-related keywords
  console.log('Querying support tickets...');

  const { data: tickets, error } = await supabase
    .from('support_tickets')
    .select('created_at, subject, message_body, summary, category, sentiment, perma_url')
    .gte('created_at', startDate.toISOString())
    .or(
      patterns.map(p => `subject.ilike.${p}`).join(',') + ',' +
      patterns.map(p => `message_body.ilike.${p}`).join(',') + ',' +
      patterns.map(p => `summary.ilike.${p}`).join(',')
    )
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error querying tickets:', error);
    process.exit(1);
  }

  if (!tickets || tickets.length === 0) {
    console.log('No packaging-related tickets found.');
    process.exit(0);
  }

  console.log(`Found ${tickets.length} packaging-related tickets\n`);

  // Classify each ticket by theme
  const categorizedTickets: CategorizedTicket[] = tickets.map(ticket => ({
    ...ticket,
    themes: classifyThemes(ticket)
  }));

  // Generate date string for filenames
  const dateStr = new Date().toISOString().split('T')[0];
  const downloadsDir = path.join(process.env.HOME!, 'Downloads');

  // === EXPORT CSV ===
  console.log('Exporting CSV...');

  const csvHeaders = ['Date', 'Subject', 'Summary', 'Themes', 'Category', 'Sentiment', 'Re:amaze URL', 'Full Message'];
  const csvRows = categorizedTickets.map(t => [
    formatDate(t.created_at),
    escapeCSV(t.subject),
    escapeCSV(t.summary),
    escapeCSV(t.themes.join('; ')),
    escapeCSV(t.category),
    escapeCSV(t.sentiment),
    escapeCSV(t.perma_url),
    escapeCSV(t.message_body?.substring(0, 500)) // Truncate for readability
  ]);

  const csvContent = [
    csvHeaders.join(','),
    ...csvRows.map(row => row.join(','))
  ].join('\n');

  const csvPath = path.join(downloadsDir, `smithey-packaging-complaints-${dateStr}.csv`);
  fs.writeFileSync(csvPath, csvContent);
  console.log(`  CSV exported to: ${csvPath}\n`);

  // === GENERATE SUMMARY REPORT ===
  console.log('Generating summary report...\n');

  // Count by theme
  const themeCounts: Record<string, CategorizedTicket[]> = {};
  for (const ticket of categorizedTickets) {
    for (const theme of ticket.themes) {
      if (!themeCounts[theme]) themeCounts[theme] = [];
      themeCounts[theme].push(ticket);
    }
  }

  // Count by sentiment
  const sentimentCounts: Record<string, number> = {};
  for (const ticket of categorizedTickets) {
    sentimentCounts[ticket.sentiment] = (sentimentCounts[ticket.sentiment] || 0) + 1;
  }

  // Build report
  let report = `# Smithey Packaging Complaints Report\n\n`;
  report += `**Generated:** ${new Date().toLocaleString()}\n`;
  report += `**Period:** ${formatDate(startDate.toISOString())} to ${formatDate(endDate.toISOString())} (6 months)\n\n`;
  report += `---\n\n`;

  // Executive Summary
  report += `## Executive Summary\n\n`;
  report += `**Total packaging-related tickets:** ${tickets.length}\n\n`;

  // Theme breakdown
  report += `### Breakdown by Theme\n\n`;
  report += `| Theme | Count | % of Total |\n`;
  report += `|-------|-------|------------|\n`;

  const sortedThemes = Object.entries(themeCounts).sort((a, b) => b[1].length - a[1].length);
  for (const [theme, themeTickets] of sortedThemes) {
    const pct = ((themeTickets.length / tickets.length) * 100).toFixed(1);
    report += `| ${theme} | ${themeTickets.length} | ${pct}% |\n`;
  }
  report += `\n`;

  // Sentiment breakdown
  report += `### Sentiment Distribution\n\n`;
  report += `| Sentiment | Count | % of Total |\n`;
  report += `|-----------|-------|------------|\n`;
  for (const [sentiment, count] of Object.entries(sentimentCounts).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / tickets.length) * 100).toFixed(1);
    report += `| ${sentiment} | ${count} | ${pct}% |\n`;
  }
  report += `\n`;

  report += `---\n\n`;

  // Detailed theme sections with examples
  report += `## Detailed Analysis by Theme\n\n`;

  for (const [theme, themeTickets] of sortedThemes) {
    const themeRule = THEME_RULES.find(r => r.theme === theme);

    report += `### ${theme}\n\n`;
    report += `**Count:** ${themeTickets.length} tickets\n`;
    if (themeRule) {
      report += `**Description:** ${themeRule.description}\n`;
    }
    report += `\n`;

    // Show up to 10 representative examples
    const examples = themeTickets.slice(0, 10);
    report += `**Representative Examples:**\n\n`;

    for (let i = 0; i < examples.length; i++) {
      const t = examples[i];
      report += `${i + 1}. **${formatDate(t.created_at)}** - ${t.sentiment}\n`;
      report += `   > ${t.summary || t.subject}\n`;
      if (t.perma_url) {
        report += `   > [View in Re:amaze](${t.perma_url})\n`;
      }
      report += `\n`;
    }

    report += `---\n\n`;
  }

  // Key Verbatims section
  report += `## Key Customer Quotes\n\n`;
  report += `Selected verbatims that highlight common pain points:\n\n`;

  // Find most negative tickets with good summaries
  const negativeTickets = categorizedTickets
    .filter(t => t.sentiment === 'Negative' && t.summary && t.summary.length > 20)
    .slice(0, 15);

  for (const t of negativeTickets) {
    report += `- "${t.summary}" *(${formatDate(t.created_at)}, ${t.themes.join(', ')})*\n`;
  }

  report += `\n---\n\n`;
  report += `*Raw data available in: smithey-packaging-complaints-${dateStr}.csv*\n`;

  // Write report
  const reportPath = path.join(downloadsDir, `smithey-packaging-report-${dateStr}.md`);
  fs.writeFileSync(reportPath, report);
  console.log(`  Report exported to: ${reportPath}\n`);

  // Print summary to console
  console.log('=== SUMMARY ===\n');
  console.log(`Total tickets found: ${tickets.length}`);
  console.log('\nBy Theme:');
  for (const [theme, themeTickets] of sortedThemes) {
    console.log(`  ${theme}: ${themeTickets.length}`);
  }
  console.log('\nBy Sentiment:');
  for (const [sentiment, count] of Object.entries(sentimentCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${sentiment}: ${count}`);
  }
  console.log('\nDone!');
}

main().catch(console.error);
