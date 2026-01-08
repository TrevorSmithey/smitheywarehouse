import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function deepAnalysis() {
  const { data: convs } = await supabase
    .from("wholesale_conversations")
    .select("*")
    .eq("is_noise", false)
    .not("classified_at", "is", null);

  if (!convs) {
    console.error("No data");
    return;
  }

  console.log("=== DEEP ANALYSIS ===");
  console.log("Total real inquiries:", convs.length);

  // 1. Monthly breakdown
  console.log("\n--- MONTHLY VOLUME ---");
  const byMonth: Record<string, number> = {};
  for (const c of convs) {
    const d = new Date(c.created_at);
    const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    byMonth[key] = (byMonth[key] || 0) + 1;
  }
  const sortedMonths = Object.entries(byMonth).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [month, count] of sortedMonths) {
    console.log(month + ": " + count);
  }

  // 2. Top companies by inquiry volume
  console.log("\n--- TOP 25 COMPANIES BY VOLUME ---");
  const byCompany: Record<string, number> = {};
  for (const c of convs) {
    const co = c.customer_company || "Unknown";
    if (co && co !== "Unknown") {
      byCompany[co] = (byCompany[co] || 0) + 1;
    }
  }
  const topCompanies = Object.entries(byCompany)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25);
  for (const [co, count] of topCompanies) {
    console.log(co + ": " + count);
  }

  // 3. The Either cases - what are they?
  console.log("\n--- EITHER CASES - BREAKDOWN ---");
  const eitherCases = convs.filter(c => c.requires === "Either");
  const eitherByTopic: Record<string, number> = {};
  for (const c of eitherCases) {
    eitherByTopic[c.known_category] = (eitherByTopic[c.known_category] || 0) + 1;
  }
  for (const [topic, count] of Object.entries(eitherByTopic).sort((a, b) => b[1] - a[1])) {
    console.log(topic + ": " + count);
  }
  console.log("\nSample Either cases:");
  for (const c of eitherCases.slice(0, 12)) {
    console.log("  [" + (c.customer_company || "Unknown") + "] " + c.what_they_want);
    console.log("    Why either: " + c.requires_reasoning);
  }

  // 4. Complex cases - what makes them complex?
  console.log("\n--- COMPLEX CASES ---");
  const complexCases = convs.filter(c => c.complexity === "Complex");
  console.log("Total complex:", complexCases.length);
  for (const c of complexCases.slice(0, 20)) {
    console.log("  [" + (c.customer_company || "Unknown") + "] " + c.what_they_want);
    console.log("    Topic: " + c.known_category + " | Owner: " + c.requires);
  }

  // 5. None of These category
  console.log("\n--- NONE OF THESE ---");
  const noneOfThese = convs.filter(c => c.known_category === "None of These");
  console.log("Total:", noneOfThese.length);
  const noneByRequires: Record<string, number> = { Sales: 0, Support: 0, Either: 0 };
  for (const c of noneOfThese) {
    noneByRequires[c.requires] = (noneByRequires[c.requires] || 0) + 1;
  }
  console.log("Split: Sales " + noneByRequires.Sales + " | Support " + noneByRequires.Support + " | Either " + noneByRequires.Either);
  console.log("\nSamples:");
  for (const c of noneOfThese.slice(0, 15)) {
    console.log("  [" + c.requires + "] " + c.what_they_want);
  }

  // 6. Year-over-year shift
  console.log("\n--- SALES VS SUPPORT BY YEAR ---");
  const byYearRequires: Record<number, { Sales: number; Support: number; Either: number; total: number }> = {};
  for (const c of convs) {
    const year = new Date(c.created_at).getFullYear();
    if (!byYearRequires[year]) byYearRequires[year] = { Sales: 0, Support: 0, Either: 0, total: 0 };
    byYearRequires[year][c.requires as "Sales" | "Support" | "Either"]++;
    byYearRequires[year].total++;
  }
  for (const [year, counts] of Object.entries(byYearRequires).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const c = counts as { Sales: number; Support: number; Either: number; total: number };
    console.log(year + ": Sales " + ((c.Sales/c.total)*100).toFixed(0) + "% (" + c.Sales + ") | Support " + ((c.Support/c.total)*100).toFixed(0) + "% (" + c.Support + ") | Either " + ((c.Either/c.total)*100).toFixed(0) + "% (" + c.Either + ")");
  }

  // 7. Products mentioned
  console.log("\n--- PRODUCTS MENTIONED (top 25) ---");
  const productCounts: Record<string, number> = {};
  for (const c of convs) {
    for (const p of (c.products_mentioned || [])) {
      const normalized = (p as string).toLowerCase().trim();
      if (normalized && normalized.length > 2) {
        productCounts[normalized] = (productCounts[normalized] || 0) + 1;
      }
    }
  }
  const topProducts = Object.entries(productCounts).sort((a, b) => b[1] - a[1]).slice(0, 25);
  for (const [product, count] of topProducts) {
    console.log(product + ": " + count);
  }

  // 8. Extended samples by category
  console.log("\n--- EXTENDED SAMPLES BY CATEGORY ---");
  const categories = ["Order/Restock", "New Business", "Payment/Credit", "Product Issue", "Relationship", "Pricing/Terms"];
  for (const cat of categories) {
    console.log("\n## " + cat);
    const catConvs = convs.filter(c => c.known_category === cat);

    // Sales samples
    const salesSamples = catConvs.filter(c => c.requires === "Sales" && c.what_they_want).slice(0, 8);
    if (salesSamples.length > 0) {
      console.log("SALES (" + catConvs.filter(c => c.requires === "Sales").length + " total):");
      for (const s of salesSamples) {
        console.log("  • [" + (s.customer_company || s.customer_name || "Unknown") + "] " + s.what_they_want);
      }
    }

    // Support samples
    const supportSamples = catConvs.filter(c => c.requires === "Support" && c.what_they_want).slice(0, 8);
    if (supportSamples.length > 0) {
      console.log("SUPPORT (" + catConvs.filter(c => c.requires === "Support").length + " total):");
      for (const s of supportSamples) {
        console.log("  • [" + (s.customer_company || s.customer_name || "Unknown") + "] " + s.what_they_want);
      }
    }
  }

  // 9. Reasoning patterns
  console.log("\n--- SAMPLE REASONING (why Sales vs Support) ---");
  const salesWithReasoning = convs.filter(c => c.requires === "Sales" && c.requires_reasoning).slice(0, 15);
  console.log("Why these need SALES:");
  for (const c of salesWithReasoning) {
    console.log("  • " + c.requires_reasoning);
  }

  const supportWithReasoning = convs.filter(c => c.requires === "Support" && c.requires_reasoning).slice(0, 15);
  console.log("\nWhy these are SUPPORT:");
  for (const c of supportWithReasoning) {
    console.log("  • " + c.requires_reasoning);
  }

  // 10. Topic breakdown by year
  console.log("\n--- TOPIC BREAKDOWN BY YEAR ---");
  const topicByYear: Record<string, Record<string, number>> = {};
  for (const c of convs) {
    const year = new Date(c.created_at).getFullYear().toString();
    if (!topicByYear[year]) topicByYear[year] = {};
    topicByYear[year][c.known_category] = (topicByYear[year][c.known_category] || 0) + 1;
  }
  for (const [year, topics] of Object.entries(topicByYear).sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log("\n" + year + ":");
    for (const [topic, count] of Object.entries(topics).sort((a, b) => b[1] - a[1])) {
      console.log("  " + topic + ": " + count);
    }
  }
}

deepAnalysis().catch(console.error);
