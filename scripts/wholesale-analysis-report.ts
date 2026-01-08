/**
 * Wholesale Support Analysis Report (V2)
 *
 * Generates comprehensive analytics focused on:
 * - Sales vs Support routing decisions
 * - Topic distribution and complexity
 * - Actionable insights for team structure
 *
 * Usage: npx tsx scripts/wholesale-analysis-report.ts
 * Output: ~/Downloads/wholesale-support-analysis-{date}.md
 */

import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface ConversationRow {
  id: number;
  reamaze_slug: string;
  subject: string;
  customer_name: string;
  customer_email: string;
  customer_company: string;
  created_at: string;
  // V2 classification fields
  is_noise: boolean;
  noise_type: string | null;
  what_they_want: string;
  primary_topic: string;
  known_category: string;
  requires: string;
  requires_reasoning: string;
  complexity: string;
  products_mentioned: string[];
}

async function generateReport() {
  console.log("=== Generating Wholesale Support Analysis Report (V2) ===\n");

  // Fetch all classified conversations
  const { data: allConversations, error } = await supabase
    .from("wholesale_conversations")
    .select("*")
    .not("classified_at", "is", null)
    .order("created_at", { ascending: false });

  if (error || !allConversations) {
    console.error("Error fetching data:", error?.message);
    return;
  }

  console.log(`Total classified: ${allConversations.length}`);

  // Split noise vs real
  const noiseConversations = allConversations.filter(c => c.is_noise);
  const realConversations = allConversations.filter(c => !c.is_noise);

  console.log(`Noise filtered: ${noiseConversations.length}`);
  console.log(`Real inquiries: ${realConversations.length}\n`);

  // === METRICS ===

  // Requires distribution (Sales vs Support vs Either)
  const requiresCount: Record<string, number> = {};
  for (const c of realConversations) {
    const req = c.requires || "Unknown";
    requiresCount[req] = (requiresCount[req] || 0) + 1;
  }

  // Known category distribution
  const categoryCount: Record<string, number> = {};
  for (const c of realConversations) {
    const cat = c.known_category || "Unknown";
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;
  }
  const sortedCategories = Object.entries(categoryCount).sort((a, b) => b[1] - a[1]);

  // Complexity distribution
  const complexityCount: Record<string, number> = {};
  for (const c of realConversations) {
    const comp = c.complexity || "Unknown";
    complexityCount[comp] = (complexityCount[comp] || 0) + 1;
  }

  // Products mentioned
  const productCount: Record<string, number> = {};
  for (const c of realConversations) {
    for (const product of c.products_mentioned || []) {
      productCount[product] = (productCount[product] || 0) + 1;
    }
  }
  const sortedProducts = Object.entries(productCount).sort((a, b) => b[1] - a[1]);

  // Primary topics (free-form)
  const topicCount: Record<string, number> = {};
  for (const c of realConversations) {
    const topic = c.primary_topic || "Unknown";
    topicCount[topic] = (topicCount[topic] || 0) + 1;
  }
  const sortedTopics = Object.entries(topicCount).sort((a, b) => b[1] - a[1]);

  // By year
  const byYear: Record<string, number> = {};
  for (const c of realConversations) {
    const year = c.created_at?.substring(0, 4) || "Unknown";
    byYear[year] = (byYear[year] || 0) + 1;
  }

  // By month (last 12)
  const byMonth: Record<string, number> = {};
  for (const c of realConversations) {
    const month = c.created_at?.substring(0, 7) || "Unknown";
    byMonth[month] = (byMonth[month] || 0) + 1;
  }
  const sortedMonths = Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12);

  // Cross-tab: Category x Requires
  const categoryByRequires: Record<string, Record<string, number>> = {};
  for (const c of realConversations) {
    const cat = c.known_category || "Unknown";
    const req = c.requires || "Unknown";
    if (!categoryByRequires[cat]) categoryByRequires[cat] = {};
    categoryByRequires[cat][req] = (categoryByRequires[cat][req] || 0) + 1;
  }

  // Cross-tab: Category x Complexity
  const categoryByComplexity: Record<string, Record<string, number>> = {};
  for (const c of realConversations) {
    const cat = c.known_category || "Unknown";
    const comp = c.complexity || "Unknown";
    if (!categoryByComplexity[cat]) categoryByComplexity[cat] = {};
    categoryByComplexity[cat][comp] = (categoryByComplexity[cat][comp] || 0) + 1;
  }

  // Noise type breakdown
  const noiseTypeCount: Record<string, number> = {};
  for (const c of noiseConversations) {
    const nt = c.noise_type || "Unspecified";
    noiseTypeCount[nt] = (noiseTypeCount[nt] || 0) + 1;
  }
  const sortedNoiseTypes = Object.entries(noiseTypeCount).sort((a, b) => b[1] - a[1]);

  // Top customers
  const customerCount: Record<string, { count: number; company: string; salesCount: number }> = {};
  for (const c of realConversations) {
    const email = c.customer_email || "unknown";
    if (!customerCount[email]) {
      customerCount[email] = { count: 0, company: c.customer_company || "", salesCount: 0 };
    }
    customerCount[email].count++;
    if (c.requires === "Sales") customerCount[email].salesCount++;
  }
  const topCustomers = Object.entries(customerCount)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 25);

  // === GENERATE MARKDOWN ===

  let md = `# Wholesale Support Analysis Report

**Generated:** ${new Date().toISOString()}
**Data Range:** ${realConversations.length > 0 ? realConversations[realConversations.length - 1].created_at?.split("T")[0] : "N/A"} to ${realConversations.length > 0 ? realConversations[0].created_at?.split("T")[0] : "N/A"}

---

## Executive Summary

| Metric | Count | % |
|--------|-------|---|
| Total Classified | ${allConversations.length} | 100% |
| **Noise Filtered** | ${noiseConversations.length} | ${((noiseConversations.length / allConversations.length) * 100).toFixed(0)}% |
| **Real Inquiries** | ${realConversations.length} | ${((realConversations.length / allConversations.length) * 100).toFixed(0)}% |

### The Key Question: Who Should Handle These?

| Owner | Count | % of Real | Implication |
|-------|-------|-----------|-------------|
| **Support** | ${requiresCount["Support"] || 0} | ${(((requiresCount["Support"] || 0) / realConversations.length) * 100).toFixed(0)}% | Process execution, trained staff |
| **Sales** | ${requiresCount["Sales"] || 0} | ${(((requiresCount["Sales"] || 0) / realConversations.length) * 100).toFixed(0)}% | Commercial judgment, relationship |
| **Either** | ${requiresCount["Either"] || 0} | ${(((requiresCount["Either"] || 0) / realConversations.length) * 100).toFixed(0)}% | Escalation path matters |

### Complexity Distribution

| Complexity | Count | % |
|------------|-------|---|
| Simple | ${complexityCount["Simple"] || 0} | ${(((complexityCount["Simple"] || 0) / realConversations.length) * 100).toFixed(0)}% |
| Moderate | ${complexityCount["Moderate"] || 0} | ${(((complexityCount["Moderate"] || 0) / realConversations.length) * 100).toFixed(0)}% |
| Complex | ${complexityCount["Complex"] || 0} | ${(((complexityCount["Complex"] || 0) / realConversations.length) * 100).toFixed(0)}% |

---

## Topic Categories

| Category | Count | % | Sales | Support | Either |
|----------|-------|---|-------|---------|--------|
`;

  for (const [cat, count] of sortedCategories) {
    const pct = ((count / realConversations.length) * 100).toFixed(1);
    const byReq = categoryByRequires[cat] || {};
    md += `| ${cat} | ${count} | ${pct}% | ${byReq["Sales"] || 0} | ${byReq["Support"] || 0} | ${byReq["Either"] || 0} |\n`;
  }

  md += `
---

## Category × Complexity Matrix

| Category | Simple | Moderate | Complex |
|----------|--------|----------|---------|
`;

  for (const [cat] of sortedCategories.slice(0, 10)) {
    const byComp = categoryByComplexity[cat] || {};
    md += `| ${cat} | ${byComp["Simple"] || 0} | ${byComp["Moderate"] || 0} | ${byComp["Complex"] || 0} |\n`;
  }

  md += `
---

## Top Primary Topics (Free-Form)

| Topic | Count |
|-------|-------|
`;

  for (const [topic, count] of sortedTopics.slice(0, 30)) {
    md += `| ${topic} | ${count} |\n`;
  }

  md += `
---

## Products Most Mentioned

| Product | Times Mentioned |
|---------|-----------------|
`;

  for (const [product, count] of sortedProducts.slice(0, 20)) {
    md += `| ${product} | ${count} |\n`;
  }

  md += `
---

## Noise Breakdown

| Noise Type | Count |
|------------|-------|
`;

  for (const [nt, count] of sortedNoiseTypes) {
    md += `| ${nt} | ${count} |\n`;
  }

  md += `
---

## Volume by Year

| Year | Inquiries |
|------|-----------|
`;

  for (const [year, count] of Object.entries(byYear).sort((a, b) => b[0].localeCompare(a[0]))) {
    md += `| ${year} | ${count} |\n`;
  }

  md += `
---

## Volume by Month (Last 12)

| Month | Inquiries |
|-------|-----------|
`;

  for (const [month, count] of sortedMonths) {
    md += `| ${month} | ${count} |\n`;
  }

  md += `
---

## Top 25 Customers by Inquiry Volume

| Customer | Company | Total | Sales-Level |
|----------|---------|-------|-------------|
`;

  for (const [email, data] of topCustomers) {
    md += `| ${email} | ${data.company || "-"} | ${data.count} | ${data.salesCount} |\n`;
  }

  md += `
---

## Sample Conversations by Category

`;

  // Show samples from each major category
  for (const [cat] of sortedCategories.slice(0, 8)) {
    const samples = realConversations
      .filter(c => c.known_category === cat)
      .slice(0, 5);

    md += `### ${cat}\n\n`;

    for (const c of samples) {
      md += `**[${c.created_at?.split("T")[0]}]** ${c.customer_company || c.customer_name || "Unknown"}\n`;
      md += `- **What they want:** ${c.what_they_want || "N/A"}\n`;
      md += `- **Requires:** ${c.requires} (${c.complexity}) — ${c.requires_reasoning || ""}\n`;
      md += `- **Products:** ${(c.products_mentioned || []).join(", ") || "None"}\n\n`;
    }
  }

  md += `
---

## Recommendations

### Team Structure Implications

Based on ${realConversations.length} real customer inquiries:

1. **Support Team Scope:** ${(((requiresCount["Support"] || 0) + (requiresCount["Either"] || 0)) / realConversations.length * 100).toFixed(0)}% of inquiries can be handled by trained support staff
   - Primary topics: Order status, restock dates, defect claims, invoice copies
   - Complexity: Mostly Simple/Moderate with clear processes

2. **Sales Team Focus:** ${((requiresCount["Sales"] || 0) / realConversations.length * 100).toFixed(0)}% require sales involvement
   - Primary topics: Pricing negotiations, new accounts, relationship issues
   - These need commercial judgment or relationship context

3. **Escalation Path:** ${((requiresCount["Either"] || 0) / realConversations.length * 100).toFixed(0)}% could go either way
   - Train support to handle standard cases
   - Clear criteria for when to escalate to sales

### Noise Reduction

${noiseConversations.length} conversations (${((noiseConversations.length / allConversations.length) * 100).toFixed(0)}%) are noise:
${sortedNoiseTypes.slice(0, 5).map(([nt, count]) => `- ${nt}: ${count}`).join("\n")}

Consider email rules or integrations to route these automatically.

---

*Report generated from ${allConversations.length} classified conversations using Claude API.*
`;

  // Write file
  const dateStr = new Date().toISOString().split("T")[0];
  const outputPath = path.join(
    process.env.HOME || "/tmp",
    "Downloads",
    `wholesale-support-analysis-${dateStr}.md`
  );

  fs.writeFileSync(outputPath, md);
  console.log(`Report saved to: ${outputPath}`);
  console.log(`File size: ${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB`);

  // Console summary
  console.log("\n=== Quick Summary ===\n");
  console.log("Who Should Handle:");
  console.log(`  Support: ${requiresCount["Support"] || 0} (${(((requiresCount["Support"] || 0) / realConversations.length) * 100).toFixed(0)}%)`);
  console.log(`  Sales: ${requiresCount["Sales"] || 0} (${(((requiresCount["Sales"] || 0) / realConversations.length) * 100).toFixed(0)}%)`);
  console.log(`  Either: ${requiresCount["Either"] || 0} (${(((requiresCount["Either"] || 0) / realConversations.length) * 100).toFixed(0)}%)`);
  console.log("\nTop Categories:");
  for (const [cat, count] of sortedCategories.slice(0, 6)) {
    console.log(`  ${cat}: ${count}`);
  }
}

// Run
generateReport().catch(console.error);
