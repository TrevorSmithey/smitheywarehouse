/**
 * Wholesale AI Insights API
 * Returns pattern-based churn predictions and behavioral insights
 *
 * This is NOT generic "AI slop" - it's actual pattern recognition on real customer data.
 * The insights are based on each customer's individual ordering behavior, not arbitrary thresholds.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import type { CustomerSegment } from "@/lib/types";
import {
  analyzeCustomerPattern,
  generateChurnPrediction,
  type CustomerOrderHistory,
  type CustomerPattern,
  type ChurnPrediction,
} from "@/lib/pattern-recognition";
import { checkRateLimit, rateLimitedResponse, RATE_LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Customer IDs to exclude (D2C aggregates)
const EXCLUDED_CUSTOMER_IDS = [2501];

// Minimum orders required for pattern analysis
// 6 orders = 5 intervals, which is the bare minimum to detect a pattern
// Anything less is statistical noise, not signal
const MIN_ORDERS_FOR_PATTERN = 6;

// Maximum days since last order (exclude churned customers - they're gone)
const MAX_DAYS_SINCE_LAST_ORDER = 365;

// Helper to determine customer segment based on revenue
function getCustomerSegment(totalRevenue: number): CustomerSegment {
  if (totalRevenue >= 50000) return "major";
  if (totalRevenue >= 20000) return "large";
  if (totalRevenue >= 10000) return "mid";
  if (totalRevenue >= 5000) return "small";
  if (totalRevenue >= 2000) return "starter";
  return "minimal";
}

export interface PatternInsightsResponse {
  // Churn predictions sorted by risk score
  predictions: ChurnPrediction[];
  // Summary stats
  summary: {
    totalAnalyzed: number;
    criticalRisk: number;
    highRisk: number;
    mediumRisk: number;
    lowRisk: number;
    totalRevenueAtRisk: number;
    avgConfidence: number;
  };
  // Pattern stats (what we learned about the customer base)
  patternStats: {
    avgOrderInterval: number;
    avgOrderSize: number;
    customersWithConsistentPatterns: number;
    customersWithSeasonalPatterns: number;
    customersWithSizeTrend: number;
  };
  // Top signals (what's driving the predictions)
  topSignals: {
    intervalExtended: number;
    sizeDeclining: number;
    frequencyDropped: number;
    patternBreak: number;
    combinedWarning: number;
  };
  lastAnalyzed: string;
}

export async function GET(request: Request) {
  // Rate limiting
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  const rateLimitResult = checkRateLimit(`wholesale-insights:${ip}`, RATE_LIMITS.API);
  if (!rateLimitResult.success) {
    return rateLimitedResponse(rateLimitResult);
  }

  try {
    const supabase = createServiceClient();
    const now = new Date();

    // Step 1: Get active customers (ordered within last 365 days)
    // Churned customers are irrelevant - focus on here and now
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - MAX_DAYS_SINCE_LAST_ORDER);
    const cutoffDateStr = cutoffDate.toISOString().split("T")[0];

    // IMPORTANT: Use last_sale_date (from transaction sync, current) NOT last_order_date (from customer sync, stale)
    // This was a data integrity bug - last_order_date can be 6+ months out of date
    const { data: customers, error: customersError } = await supabase
      .from("ns_wholesale_customers")
      .select("ns_customer_id, company_name, lifetime_revenue, lifetime_orders, segment, last_sale_date")
      .not("ns_customer_id", "in", `(${EXCLUDED_CUSTOMER_IDS.join(",")})`)
      .gte("lifetime_orders", MIN_ORDERS_FOR_PATTERN)
      .gte("last_sale_date", cutoffDateStr)
      .order("lifetime_revenue", { ascending: false });

    if (customersError) {
      throw new Error(`Failed to fetch customers: ${customersError.message}`);
    }

    if (!customers || customers.length === 0) {
      return NextResponse.json({
        predictions: [],
        summary: {
          totalAnalyzed: 0,
          criticalRisk: 0,
          highRisk: 0,
          mediumRisk: 0,
          lowRisk: 0,
          totalRevenueAtRisk: 0,
          avgConfidence: 0,
        },
        patternStats: {
          avgOrderInterval: 0,
          avgOrderSize: 0,
          customersWithConsistentPatterns: 0,
          customersWithSeasonalPatterns: 0,
          customersWithSizeTrend: 0,
        },
        topSignals: {
          intervalExtended: 0,
          sizeDeclining: 0,
          frequencyDropped: 0,
          patternBreak: 0,
          combinedWarning: 0,
        },
        lastAnalyzed: now.toISOString(),
      });
    }

    // Step 2: Get all transactions for these customers
    const customerIds = customers.map((c) => c.ns_customer_id);

    const { data: transactions, error: txnError } = await supabase
      .from("ns_wholesale_transactions")
      .select("ns_customer_id, ns_transaction_id, tran_date, foreign_total")
      .in("ns_customer_id", customerIds)
      .order("tran_date", { ascending: true });

    if (txnError) {
      throw new Error(`Failed to fetch transactions: ${txnError.message}`);
    }

    // Step 3: Group transactions by customer
    const txnsByCustomer = new Map<number, CustomerOrderHistory["transactions"]>();
    for (const t of transactions || []) {
      const customerId = t.ns_customer_id;
      if (!txnsByCustomer.has(customerId)) {
        txnsByCustomer.set(customerId, []);
      }
      txnsByCustomer.get(customerId)!.push({
        ns_transaction_id: t.ns_transaction_id,
        tran_date: t.tran_date,
        foreign_total: parseFloat(t.foreign_total) || 0,
      });
    }

    // Step 4: Analyze each customer's pattern
    const patterns: CustomerPattern[] = [];
    const predictions: ChurnPrediction[] = [];

    for (const customer of customers) {
      const customerTxns = txnsByCustomer.get(customer.ns_customer_id);
      if (!customerTxns || customerTxns.length < MIN_ORDERS_FOR_PATTERN) {
        continue;
      }

      const segment =
        (customer.segment as CustomerSegment) ||
        getCustomerSegment(parseFloat(customer.lifetime_revenue) || 0);

      const history: CustomerOrderHistory = {
        ns_customer_id: customer.ns_customer_id,
        company_name: customer.company_name || `Customer ${customer.ns_customer_id}`,
        segment,
        transactions: customerTxns,
      };

      const pattern = analyzeCustomerPattern(history, now);
      patterns.push(pattern);

      // Only generate predictions for customers with some risk
      if (pattern.churnRiskScore >= 15) {
        const prediction = generateChurnPrediction(pattern);
        predictions.push(prediction);
      }
    }

    // Step 5: Sort predictions by risk score (highest first)
    predictions.sort((a, b) => b.churnRiskScore - a.churnRiskScore);

    // Step 6: Calculate summary stats
    const criticalRisk = predictions.filter((p) => p.riskLevel === "critical").length;
    const highRisk = predictions.filter((p) => p.riskLevel === "high").length;
    const mediumRisk = predictions.filter((p) => p.riskLevel === "medium").length;
    const lowRisk = predictions.filter((p) => p.riskLevel === "low").length;
    const totalRevenueAtRisk = predictions.reduce((sum, p) => sum + p.revenueAtRisk, 0);
    const avgConfidence =
      predictions.length > 0
        ? predictions.reduce((sum, p) => sum + p.confidenceLevel, 0) / predictions.length
        : 0;

    // Step 7: Calculate pattern stats
    const allIntervals = patterns
      .filter((p) => p.intervalStats)
      .map((p) => p.intervalStats!.avgIntervalDays);
    const avgOrderInterval =
      allIntervals.length > 0
        ? Math.round(allIntervals.reduce((a, b) => a + b, 0) / allIntervals.length)
        : 0;

    const allSizes = patterns.filter((p) => p.sizeStats).map((p) => p.sizeStats!.avgOrderSize);
    const avgOrderSize =
      allSizes.length > 0
        ? Math.round(allSizes.reduce((a, b) => a + b, 0) / allSizes.length)
        : 0;

    const customersWithConsistentPatterns = patterns.filter(
      (p) => p.intervalStats?.isConsistent
    ).length;
    const customersWithSeasonalPatterns = patterns.filter(
      (p) => p.seasonalPattern?.hasSeasonalPattern
    ).length;
    const customersWithSizeTrend = patterns.filter((p) => p.sizeStats?.isShrinking).length;

    // Step 8: Count signal types
    const topSignals = {
      intervalExtended: 0,
      sizeDeclining: 0,
      frequencyDropped: 0,
      patternBreak: 0,
      combinedWarning: 0,
    };

    for (const prediction of predictions) {
      for (const signal of prediction.signals) {
        switch (signal.type) {
          case "interval_extended":
            topSignals.intervalExtended++;
            break;
          case "size_declining":
            topSignals.sizeDeclining++;
            break;
          case "frequency_dropped":
            topSignals.frequencyDropped++;
            break;
          case "pattern_break":
            topSignals.patternBreak++;
            break;
          case "combined_warning":
            topSignals.combinedWarning++;
            break;
        }
      }
    }

    const response: PatternInsightsResponse = {
      predictions: predictions.slice(0, 50), // Top 50 at-risk customers
      summary: {
        totalAnalyzed: patterns.length,
        criticalRisk,
        highRisk,
        mediumRisk,
        lowRisk,
        totalRevenueAtRisk: Math.round(totalRevenueAtRisk),
        avgConfidence: Math.round(avgConfidence),
      },
      patternStats: {
        avgOrderInterval,
        avgOrderSize,
        customersWithConsistentPatterns,
        customersWithSeasonalPatterns,
        customersWithSizeTrend,
      },
      topSignals,
      lastAnalyzed: now.toISOString(),
    };

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (error) {
    console.error("[WHOLESALE INSIGHTS API] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate insights" },
      { status: 500 }
    );
  }
}
