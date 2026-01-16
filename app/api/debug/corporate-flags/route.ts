/**
 * DEBUG: Corporate Flag Diagnostic
 *
 * Purpose: Understand the distribution of corporate flags in the database
 * to identify inconsistencies causing data quality issues.
 *
 * This is a temporary diagnostic endpoint - remove after investigation.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = createServiceClient();

  // Query 1: Distribution of is_corporate values
  const { data: corporateDistribution, error: err1 } = await supabase
    .from("ns_wholesale_customers")
    .select("is_corporate, category")
    .not("lifetime_orders", "is", null);

  if (err1) {
    return NextResponse.json({ error: err1.message }, { status: 500 });
  }

  // Analyze the distribution
  const analysis = {
    is_corporate_null: 0,
    is_corporate_true: 0,
    is_corporate_false: 0,
    categories: {} as Record<string, number>,
    // Corporate customers by detection method
    category_corporate: 0,
    category_4: 0,
    // Mismatches: is_corporate doesn't match category
    mismatches: [] as Array<{ is_corporate: boolean | null; category: string | null }>,
  };

  for (const row of corporateDistribution || []) {
    // Count is_corporate distribution
    if (row.is_corporate === null) {
      analysis.is_corporate_null++;
    } else if (row.is_corporate === true) {
      analysis.is_corporate_true++;
    } else {
      analysis.is_corporate_false++;
    }

    // Count category values
    const cat = row.category || "(null)";
    analysis.categories[cat] = (analysis.categories[cat] || 0) + 1;

    // Count corporate by category
    if (row.category === "Corporate") analysis.category_corporate++;
    if (row.category === "4") analysis.category_4++;

    // Find mismatches: category says corporate but is_corporate doesn't
    const shouldBeCorporate = row.category === "Corporate" || row.category === "4";
    const isCorporate = row.is_corporate === true;

    if (shouldBeCorporate !== isCorporate) {
      // Only track first 10 mismatches as examples
      if (analysis.mismatches.length < 10) {
        analysis.mismatches.push({
          is_corporate: row.is_corporate,
          category: row.category,
        });
      }
    }
  }

  // Query 2: Get actual examples of potential corporate leaks
  // Customers with NULL is_corporate but category suggests corporate
  const { data: nullCorporateExamples } = await supabase
    .from("ns_wholesale_customers")
    .select("ns_customer_id, company_name, category, is_corporate, lifetime_revenue, lifetime_orders")
    .is("is_corporate", null)
    .gt("lifetime_orders", 0)
    .order("lifetime_revenue", { ascending: false })
    .limit(20);

  // Query 3: Corporate category customers that might have is_corporate=false
  const { data: categoryMismatches } = await supabase
    .from("ns_wholesale_customers")
    .select("ns_customer_id, company_name, category, is_corporate, lifetime_revenue")
    .or("category.eq.Corporate,category.eq.4")
    .neq("is_corporate", true)
    .gt("lifetime_orders", 0)
    .order("lifetime_revenue", { ascending: false })
    .limit(20);

  return NextResponse.json({
    summary: {
      total_customers: (corporateDistribution || []).length,
      is_corporate_null: analysis.is_corporate_null,
      is_corporate_true: analysis.is_corporate_true,
      is_corporate_false: analysis.is_corporate_false,
      category_corporate: analysis.category_corporate,
      category_4: analysis.category_4,
    },
    categories: analysis.categories,
    mismatch_examples: analysis.mismatches,
    null_is_corporate_examples: nullCorporateExamples,
    category_but_not_flagged: categoryMismatches,
  });
}
