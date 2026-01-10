/**
 * Data Depth Diagnostic API
 * Assesses whether there's enough historical data for AI-powered pattern recognition
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth/server";
import { checkRateLimit, rateLimitedResponse, RATE_LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Auth check - requires admin session
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

  // Rate limiting
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  const rateLimitResult = checkRateLimit(`wholesale-depth:${ip}`, RATE_LIMITS.API);
  if (!rateLimitResult.success) {
    return rateLimitedResponse(rateLimitResult);
  }

  try {
    const supabase = createServiceClient();

    // 1. Transaction history depth
    const { data: transactionRange, error: rangeError } = await supabase
      .from("ns_wholesale_transactions")
      .select("tran_date")
      .order("tran_date", { ascending: true })
      .limit(1);

    const { data: latestTransaction } = await supabase
      .from("ns_wholesale_transactions")
      .select("tran_date")
      .order("tran_date", { ascending: false })
      .limit(1);

    // 2. Total transaction count
    const { count: totalTransactions } = await supabase
      .from("ns_wholesale_transactions")
      .select("*", { count: "exact", head: true });

    // 3. Total customer count
    const { count: totalCustomers } = await supabase
      .from("ns_wholesale_customers")
      .select("*", { count: "exact", head: true });

    // 4. Customers with 5+ orders (enough for pattern analysis)
    // IMPORTANT: Use *_sale_date (from transaction sync, current) NOT *_order_date (from customer sync, stale)
    const { data: customersWithHistory } = await supabase
      .from("ns_wholesale_customers")
      .select("ns_customer_id, company_name, lifetime_orders, first_sale_date, last_sale_date")
      .gte("lifetime_orders", 5)
      .order("lifetime_orders", { ascending: false });

    // 5. Customers with 10+ orders (strong pattern candidates)
    const strongPatternCustomers = customersWithHistory?.filter(
      (c) => c.lifetime_orders >= 10
    ) || [];

    // 6. Customers with 2+ years history (for seasonal pattern detection)
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    const longHistoryCustomers = customersWithHistory?.filter((c) => {
      if (!c.first_sale_date) return false;
      return new Date(c.first_sale_date) <= twoYearsAgo;
    }) || [];

    // 7. Distribution of order counts
    const { data: allCustomers } = await supabase
      .from("ns_wholesale_customers")
      .select("lifetime_orders");

    const orderCountDistribution = {
      "1_order": 0,
      "2-4_orders": 0,
      "5-9_orders": 0,
      "10-19_orders": 0,
      "20-49_orders": 0,
      "50+_orders": 0,
    };

    for (const c of allCustomers || []) {
      const orders = c.lifetime_orders || 0;
      if (orders === 1) orderCountDistribution["1_order"]++;
      else if (orders >= 2 && orders <= 4) orderCountDistribution["2-4_orders"]++;
      else if (orders >= 5 && orders <= 9) orderCountDistribution["5-9_orders"]++;
      else if (orders >= 10 && orders <= 19) orderCountDistribution["10-19_orders"]++;
      else if (orders >= 20 && orders <= 49) orderCountDistribution["20-49_orders"]++;
      else if (orders >= 50) orderCountDistribution["50+_orders"]++;
    }

    const earliestDate = transactionRange?.[0]?.tran_date || null;
    const latestDate = latestTransaction?.[0]?.tran_date || null;

    let historyMonths = 0;
    if (earliestDate && latestDate) {
      const earliest = new Date(earliestDate);
      const latest = new Date(latestDate);
      historyMonths = Math.round((latest.getTime() - earliest.getTime()) / (1000 * 60 * 60 * 24 * 30));
    }

    const response = {
      summary: {
        total_transactions: totalTransactions || 0,
        total_customers: totalCustomers || 0,
        history_range: {
          earliest_transaction: earliestDate,
          latest_transaction: latestDate,
          months_of_history: historyMonths,
        },
      },
      pattern_analysis_readiness: {
        customers_with_5_plus_orders: customersWithHistory?.length || 0,
        customers_with_10_plus_orders: strongPatternCustomers.length,
        customers_with_2_plus_years_history: longHistoryCustomers.length,
        order_count_distribution: orderCountDistribution,
      },
      top_pattern_candidates: strongPatternCustomers.slice(0, 15).map((c) => ({
        company_name: c.company_name,
        lifetime_orders: c.lifetime_orders,
        first_order: c.first_sale_date,
        last_order: c.last_sale_date,
      })),
      ai_viability_assessment: {
        has_enough_history: historyMonths >= 18,
        has_enough_repeat_customers: (customersWithHistory?.length || 0) >= 50,
        has_strong_pattern_candidates: strongPatternCustomers.length >= 20,
        recommendation: getRecommendation(
          historyMonths,
          customersWithHistory?.length || 0,
          strongPatternCustomers.length
        ),
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("[DATA DEPTH API] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to assess data depth" },
      { status: 500 }
    );
  }
}

function getRecommendation(
  historyMonths: number,
  customersWithFivePlus: number,
  customersWithTenPlus: number
): string {
  if (historyMonths < 12) {
    return "INSUFFICIENT: Less than 12 months of history. AI pattern recognition would be unreliable.";
  }
  if (customersWithFivePlus < 30) {
    return "LIMITED: Too few repeat customers for meaningful pattern analysis.";
  }
  if (customersWithTenPlus < 10) {
    return "MODERATE: Enough for basic pattern detection, but limited high-confidence candidates.";
  }
  if (historyMonths >= 24 && customersWithTenPlus >= 30) {
    return "EXCELLENT: Rich historical data. AI pattern recognition could identify seasonal patterns, churn signals, and ordering anomalies with high confidence.";
  }
  return "GOOD: Sufficient data for AI pattern recognition. Focus on high-frequency customers for best results.";
}
