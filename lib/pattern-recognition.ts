/**
 * Pattern Recognition Engine for Wholesale Customer Behavior
 *
 * This module analyzes individual customer transaction patterns to detect:
 * 1. Order interval anomalies (ordering slower than their pattern)
 * 2. Order size trends (shrinking order values)
 * 3. Pre-churn signatures (combinations that preceded historical churns)
 * 4. Seasonal patterns (some customers order quarterly, others monthly)
 *
 * The key insight: Every customer has their OWN rhythm. A 90-day gap is
 * concerning for someone who orders monthly, but normal for someone
 * who orders quarterly. This engine learns each customer's pattern.
 */

import type { CustomerSegment } from "./types";

// ============================================================
// Types
// ============================================================

export interface CustomerTransaction {
  ns_transaction_id: number;
  tran_date: string; // YYYY-MM-DD
  foreign_total: number;
}

export interface CustomerOrderHistory {
  ns_customer_id: number;
  company_name: string;
  segment: CustomerSegment;
  transactions: CustomerTransaction[];
}

export interface OrderIntervalStats {
  avgIntervalDays: number;
  medianIntervalDays: number;
  ewmaIntervalDays: number;  // EWMA-based "typical" interval (adapts to recent behavior)
  stdDevDays: number;
  minIntervalDays: number;
  maxIntervalDays: number;
  intervalCount: number; // number of intervals (orders - 1)
  isConsistent: boolean; // low std dev relative to mean
}

export interface OrderSizeStats {
  avgOrderSize: number;
  medianOrderSize: number;
  stdDevSize: number;
  recentAvg: number; // last 3 orders
  historicalAvg: number; // all orders except last 3
  sizeTrend: number; // % change (negative = shrinking)
  isShrinking: boolean;
}

export interface SeasonalPattern {
  hasSeasonalPattern: boolean;
  peakMonths: number[]; // 1-12
  lowMonths: number[];
  quarterlyBuyer: boolean;
  monthlyBuyer: boolean;
  annualBuyer: boolean;
}

export interface CustomerPattern {
  ns_customer_id: number;
  company_name: string;
  segment: CustomerSegment;
  orderCount: number;
  firstOrderDate: string;
  lastOrderDate: string;
  daysSinceLastOrder: number;
  // Interval analysis
  intervalStats: OrderIntervalStats | null;
  // Size analysis
  sizeStats: OrderSizeStats | null;
  // Seasonal analysis
  seasonalPattern: SeasonalPattern | null;
  // Anomaly detection
  intervalAnomaly: IntervalAnomaly | null;
  sizeAnomaly: SizeAnomaly | null;
  // Combined risk assessment
  churnRiskScore: number; // 0-100
  churnSignals: ChurnSignal[];
}

export interface IntervalAnomaly {
  expectedOrderDate: string;
  daysOverdue: number;
  overdueRatio: number; // >1 means late
  severity: "critical" | "warning" | "watch";
  explanation: string;
}

export interface SizeAnomaly {
  recentAvg: number;
  historicalAvg: number;
  declinePct: number;
  severity: "critical" | "warning" | "watch";
  explanation: string;
}

export interface ChurnSignal {
  type: "interval_extended" | "size_declining" | "frequency_dropped" | "pattern_break" | "combined_warning";
  severity: "critical" | "warning" | "watch";
  description: string;
  evidence: string;
}

export interface ChurnPrediction {
  ns_customer_id: number;
  company_name: string;
  segment: CustomerSegment;
  churnRiskScore: number;
  riskLevel: "critical" | "high" | "medium" | "low";
  signals: ChurnSignal[];
  narrative: string; // Human-readable story like "Customer X ordered every 45 days for 18 months..."
  revenueAtRisk: number;
  recommendedAction: string;
  confidenceLevel: number; // 0-100, based on data quality
}

// ============================================================
// Core Analysis Functions
// ============================================================

/**
 * Calculate order interval statistics for a customer
 *
 * MINIMUM DATA REQUIREMENTS:
 * - Need at least 6 orders (5 intervals) to claim any pattern
 * - With fewer orders, we have noise, not signal
 */
export function analyzeOrderIntervals(
  transactions: CustomerTransaction[]
): OrderIntervalStats | null {
  if (transactions.length < 6) {
    // 3-5 orders = noise, not a pattern. Don't claim patterns without data.
    return null;
  }

  // Sort by date
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.tran_date).getTime() - new Date(b.tran_date).getTime()
  );

  // Calculate intervals between consecutive orders
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prevDate = new Date(sorted[i - 1].tran_date);
    const currDate = new Date(sorted[i].tran_date);
    const daysBetween = Math.round(
      (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Filter out same-day or next-day orders (likely split shipments, not separate orders)
    if (daysBetween >= 7) {
      intervals.push(daysBetween);
    }
  }

  if (intervals.length < 5) {
    // Need at least 5 valid intervals to establish a pattern
    return null;
  }

  // Calculate statistics
  const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const sortedIntervals = [...intervals].sort((a, b) => a - b);
  const median = sortedIntervals[Math.floor(sortedIntervals.length / 2)];
  const min = Math.min(...intervals);
  const max = Math.max(...intervals);

  // Standard deviation
  const squaredDiffs = intervals.map((i) => Math.pow(i - avg, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / intervals.length;
  const stdDev = Math.sqrt(avgSquaredDiff);

  // EWMA: Exponentially Weighted Moving Average (α = 0.3)
  // This adapts to recent behavior changes - critical for customers like Forager
  // whose historical median (18d) doesn't reflect their current pattern (50d)
  const alpha = 0.3;
  let ewma = intervals[0];
  for (let i = 1; i < intervals.length; i++) {
    ewma = alpha * intervals[i] + (1 - alpha) * ewma;
  }

  // Coefficient of variation (std dev / mean) - if < 0.5, they're consistent
  const cv = stdDev / avg;
  const isConsistent = cv < 0.5;

  return {
    avgIntervalDays: Math.round(avg),
    medianIntervalDays: median,
    ewmaIntervalDays: Math.round(ewma),
    stdDevDays: Math.round(stdDev),
    minIntervalDays: min,
    maxIntervalDays: max,
    intervalCount: intervals.length,
    isConsistent,
  };
}

/**
 * Analyze order size trends
 *
 * MINIMUM DATA REQUIREMENTS:
 * - Need at least 8 orders to claim a "trend"
 * - Comparing 3 recent vs 5+ historical orders
 * - Anything less is statistical noise
 */
export function analyzeOrderSizes(
  transactions: CustomerTransaction[]
): OrderSizeStats | null {
  if (transactions.length < 8) {
    // 4-7 orders is not enough to claim a trend exists
    return null;
  }

  // Sort by date
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.tran_date).getTime() - new Date(b.tran_date).getTime()
  );

  const orderSizes = sorted.map((t) => t.foreign_total);

  // Calculate overall stats
  const avg = orderSizes.reduce((a, b) => a + b, 0) / orderSizes.length;
  const sortedSizes = [...orderSizes].sort((a, b) => a - b);
  const median = sortedSizes[Math.floor(sortedSizes.length / 2)];

  // Standard deviation
  const squaredDiffs = orderSizes.map((s) => Math.pow(s - avg, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / orderSizes.length;
  const stdDev = Math.sqrt(avgSquaredDiff);

  // Compare recent (last 3) vs historical (all others)
  const recentCount = Math.min(3, Math.floor(orderSizes.length / 2));
  const recentOrders = orderSizes.slice(-recentCount);
  const historicalOrders = orderSizes.slice(0, -recentCount);

  const recentAvg = recentOrders.reduce((a, b) => a + b, 0) / recentOrders.length;
  const historicalAvg = historicalOrders.reduce((a, b) => a + b, 0) / historicalOrders.length;

  // Size trend: % change from historical to recent
  const sizeTrend = historicalAvg > 0 ? ((recentAvg - historicalAvg) / historicalAvg) * 100 : 0;

  // Shrinking if recent is 20%+ below historical
  const isShrinking = sizeTrend < -20;

  return {
    avgOrderSize: Math.round(avg),
    medianOrderSize: Math.round(median),
    stdDevSize: Math.round(stdDev),
    recentAvg: Math.round(recentAvg),
    historicalAvg: Math.round(historicalAvg),
    sizeTrend: Math.round(sizeTrend),
    isShrinking,
  };
}

/**
 * Detect seasonal ordering patterns
 */
export function analyzeSeasonality(
  transactions: CustomerTransaction[]
): SeasonalPattern | null {
  if (transactions.length < 6) {
    // Need at least 6 orders to detect seasonality
    return null;
  }

  // Count orders by month
  const monthCounts = new Array(12).fill(0);
  const quarterCounts = new Array(4).fill(0);

  for (const t of transactions) {
    const date = new Date(t.tran_date);
    const month = date.getMonth(); // 0-11
    monthCounts[month]++;
    quarterCounts[Math.floor(month / 3)]++;
  }

  // Find peak and low months
  const avgPerMonth = transactions.length / 12;
  const peakMonths = monthCounts
    .map((count, month) => ({ month: month + 1, count }))
    .filter((m) => m.count > avgPerMonth * 1.5)
    .map((m) => m.month);

  const lowMonths = monthCounts
    .map((count, month) => ({ month: month + 1, count }))
    .filter((m) => m.count < avgPerMonth * 0.5 && m.count === 0)
    .map((m) => m.month);

  // Check for quarterly pattern (orders concentrated in specific quarters)
  const avgPerQuarter = transactions.length / 4;
  const quarterVariance = quarterCounts.reduce(
    (sum, count) => sum + Math.pow(count - avgPerQuarter, 2),
    0
  ) / 4;
  const quarterlyBuyer = quarterVariance > avgPerQuarter;

  // Check for monthly buyer (orders in most months)
  const monthsWithOrders = monthCounts.filter((c) => c > 0).length;
  const monthlyBuyer = monthsWithOrders >= 8;

  // Annual buyer (orders only once or twice per year)
  const annualBuyer = transactions.length <= 4 && monthsWithOrders <= 3;

  const hasSeasonalPattern = peakMonths.length > 0 || quarterlyBuyer || annualBuyer;

  return {
    hasSeasonalPattern,
    peakMonths,
    lowMonths,
    quarterlyBuyer,
    monthlyBuyer,
    annualBuyer,
  };
}

/**
 * Detect interval anomaly (customer ordering later than their pattern)
 */
export function detectIntervalAnomaly(
  intervalStats: OrderIntervalStats,
  lastOrderDate: string,
  now: Date = new Date()
): IntervalAnomaly | null {
  const lastOrder = new Date(lastOrderDate);
  const daysSinceLastOrder = Math.round(
    (now.getTime() - lastOrder.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Use EWMA for expected interval (adapts to behavior changes like Forager: 18d median → 49d EWMA)
  const expectedInterval = intervalStats.ewmaIntervalDays;
  const expectedOrderDate = new Date(lastOrder);
  expectedOrderDate.setDate(expectedOrderDate.getDate() + expectedInterval);

  const daysOverdue = daysSinceLastOrder - expectedInterval;
  const overdueRatio = daysSinceLastOrder / expectedInterval;

  // Only flag if they're at least 20% late
  if (overdueRatio < 1.2) {
    return null;
  }

  let severity: "critical" | "warning" | "watch";
  let explanation: string;

  if (overdueRatio >= 2.5) {
    severity = "critical";
    explanation = `${daysOverdue} days overdue (${Math.round(overdueRatio)}x their typical ${expectedInterval}-day pattern). Immediate outreach needed.`;
  } else if (overdueRatio >= 1.8) {
    severity = "warning";
    explanation = `${daysOverdue} days overdue (${overdueRatio.toFixed(1)}x their typical ${expectedInterval}-day pattern). Proactive check-in recommended.`;
  } else {
    severity = "watch";
    explanation = `${daysOverdue} days past expected order date. Pattern may be shifting.`;
  }

  return {
    expectedOrderDate: expectedOrderDate.toISOString().split("T")[0],
    daysOverdue,
    overdueRatio: Math.round(overdueRatio * 100) / 100,
    severity,
    explanation,
  };
}

/**
 * Detect order size anomaly (shrinking orders)
 */
export function detectSizeAnomaly(sizeStats: OrderSizeStats): SizeAnomaly | null {
  if (!sizeStats.isShrinking) {
    return null;
  }

  const declinePct = Math.abs(sizeStats.sizeTrend);

  let severity: "critical" | "warning" | "watch";
  let explanation: string;

  if (declinePct >= 50) {
    severity = "critical";
    explanation = `Recent orders averaging $${sizeStats.recentAvg.toLocaleString()}, down ${declinePct}% from historical $${sizeStats.historicalAvg.toLocaleString()}. Major reduction in purchasing.`;
  } else if (declinePct >= 35) {
    severity = "warning";
    explanation = `Recent orders averaging $${sizeStats.recentAvg.toLocaleString()}, down ${declinePct}% from their norm. Possible budget cuts or testing alternatives.`;
  } else {
    severity = "watch";
    explanation = `Order sizes trending down ${declinePct}%. May warrant a check-in.`;
  }

  return {
    recentAvg: sizeStats.recentAvg,
    historicalAvg: sizeStats.historicalAvg,
    declinePct,
    severity,
    explanation,
  };
}

/**
 * Calculate churn risk score (0-100) based on multiple signals
 */
export function calculateChurnRiskScore(
  intervalAnomaly: IntervalAnomaly | null,
  sizeAnomaly: SizeAnomaly | null,
  intervalStats: OrderIntervalStats | null,
  daysSinceLastOrder: number
): { score: number; signals: ChurnSignal[] } {
  let score = 0;
  const signals: ChurnSignal[] = [];

  // Factor 1: Interval anomaly (0-40 points)
  if (intervalAnomaly) {
    if (intervalAnomaly.severity === "critical") {
      score += 40;
      signals.push({
        type: "interval_extended",
        severity: "critical",
        description: "Significantly overdue for next order",
        evidence: intervalAnomaly.explanation,
      });
    } else if (intervalAnomaly.severity === "warning") {
      score += 25;
      signals.push({
        type: "interval_extended",
        severity: "warning",
        description: "Overdue for next order",
        evidence: intervalAnomaly.explanation,
      });
    } else {
      score += 10;
      signals.push({
        type: "interval_extended",
        severity: "watch",
        description: "Past expected order date",
        evidence: intervalAnomaly.explanation,
      });
    }
  }

  // Factor 2: Order size decline (0-30 points)
  if (sizeAnomaly) {
    if (sizeAnomaly.severity === "critical") {
      score += 30;
      signals.push({
        type: "size_declining",
        severity: "critical",
        description: "Order sizes dropped significantly",
        evidence: sizeAnomaly.explanation,
      });
    } else if (sizeAnomaly.severity === "warning") {
      score += 20;
      signals.push({
        type: "size_declining",
        severity: "warning",
        description: "Order sizes declining",
        evidence: sizeAnomaly.explanation,
      });
    } else {
      score += 10;
      signals.push({
        type: "size_declining",
        severity: "watch",
        description: "Order sizes trending down",
        evidence: sizeAnomaly.explanation,
      });
    }
  }

  // Factor 3: Absolute time gap (0-20 points)
  // Even consistent patterns can churn if gap gets too long
  if (daysSinceLastOrder > 180) {
    score += 20;
    signals.push({
      type: "frequency_dropped",
      severity: "critical",
      description: "No orders in 6+ months",
      evidence: `Last order was ${daysSinceLastOrder} days ago`,
    });
  } else if (daysSinceLastOrder > 120) {
    score += 12;
    signals.push({
      type: "frequency_dropped",
      severity: "warning",
      description: "No orders in 4+ months",
      evidence: `Last order was ${daysSinceLastOrder} days ago`,
    });
  } else if (daysSinceLastOrder > 90) {
    score += 5;
  }

  // Factor 4: Combined warning - both interval AND size issues (0-10 bonus)
  if (intervalAnomaly && sizeAnomaly) {
    score += 10;
    signals.push({
      type: "combined_warning",
      severity: intervalAnomaly.severity === "critical" || sizeAnomaly.severity === "critical" ? "critical" : "warning",
      description: "Both ordering pattern and order sizes deteriorating",
      evidence: "Multiple pre-churn signals detected simultaneously",
    });
  }

  // Factor 5: Pattern consistency bonus (if they WERE consistent, deviation is more concerning)
  if (intervalStats?.isConsistent && intervalAnomaly?.severity === "critical") {
    score += 5;
    signals.push({
      type: "pattern_break",
      severity: "warning",
      description: "Breaking an otherwise consistent ordering pattern",
      evidence: `Customer had a reliable ${intervalStats.ewmaIntervalDays}-day order cycle`,
    });
  }

  return { score: Math.min(100, score), signals };
}

/**
 * Generate human-readable narrative for a churn prediction
 * IMPORTANT: Only claim patterns when data actually supports them
 */
export function generateNarrative(
  pattern: CustomerPattern,
  prediction: Partial<ChurnPrediction>
): string {
  const parts: string[] = [];
  const { company_name, orderCount, intervalStats, sizeStats, intervalAnomaly, sizeAnomaly, daysSinceLastOrder } = pattern;

  // Opening - establish what we ACTUALLY know
  if (intervalStats && intervalStats.isConsistent && orderCount >= 10) {
    // Only claim "consistent" with 10+ orders AND low variance
    parts.push(
      `${company_name} has an established ordering pattern of approximately every ${intervalStats.ewmaIntervalDays} days across ${orderCount} orders.`
    );
  } else if (intervalStats && orderCount >= 6) {
    // 6-9 orders: we see a pattern but shouldn't oversell it
    parts.push(
      `${company_name} has placed ${orderCount} orders, typically about ${intervalStats.ewmaIntervalDays} days apart.`
    );
  } else {
    // Not enough data to claim a pattern - just state the facts
    parts.push(`${company_name} has ${orderCount} orders. Last order was ${daysSinceLastOrder} days ago.`);
  }

  // Only add concerning changes if we have enough data to detect them
  if (intervalAnomaly && intervalStats && orderCount >= 6) {
    if (sizeAnomaly && sizeStats && orderCount >= 8) {
      // Both interval and size issues - but only claim if we have the data
      parts.push(
        `They're ${intervalAnomaly.daysOverdue} days past their typical ${intervalStats.ewmaIntervalDays}-day interval. Order sizes also declining: recent avg $${sizeStats.recentAvg.toLocaleString()} vs historical $${sizeStats.historicalAvg.toLocaleString()}.`
      );
    } else {
      parts.push(
        `They're ${intervalAnomaly.daysOverdue} days past their typical ${intervalStats.ewmaIntervalDays}-day interval (${intervalAnomaly.overdueRatio.toFixed(1)}x normal gap).`
      );
    }
  } else if (sizeAnomaly && sizeStats && orderCount >= 8) {
    // Size issue only - need 8+ orders to claim trend
    parts.push(
      `Recent orders averaging $${sizeStats.recentAvg.toLocaleString()}, down ${Math.abs(sizeStats.sizeTrend)}% from their historical $${sizeStats.historicalAvg.toLocaleString()}.`
    );
  } else if (daysSinceLastOrder > 120) {
    // No pattern data, but they haven't ordered in 4+ months - that's a fact
    parts.push(`No orders in ${Math.round(daysSinceLastOrder / 30)} months.`);
  }

  return parts.join(" ");
}

/**
 * Get recommended action based on risk level and signals
 */
export function getRecommendedAction(
  riskLevel: "critical" | "high" | "medium" | "low",
  signals: ChurnSignal[],
  segment: CustomerSegment
): string {
  const hasSizeIssue = signals.some((s) => s.type === "size_declining");
  const hasIntervalIssue = signals.some((s) => s.type === "interval_extended");
  const hasPatternBreak = signals.some((s) => s.type === "pattern_break");

  if (riskLevel === "critical") {
    // Updated 2026-01-15: Simplified to 3-tier system (major now includes former "large")
    if (segment === "major") {
      return "Immediate executive-level outreach. Schedule a call to understand their current needs and address any concerns. This is a key account showing pre-churn behavior.";
    }
    if (hasSizeIssue && hasIntervalIssue) {
      return "Direct outreach from sales rep within 24 hours. Both order size and frequency are declining - they may be testing alternatives or facing budget constraints.";
    }
    return "Personal outreach from sales rep this week. Re-engagement offer may be appropriate.";
  }

  if (riskLevel === "high") {
    if (hasPatternBreak) {
      return "Schedule a check-in call to understand what's changed. Their reliable pattern has broken - something external may have shifted.";
    }
    if (hasSizeIssue) {
      return "Review their recent orders and reach out to discuss their current product mix. They may need different SKUs or pricing.";
    }
    return "Add to proactive outreach list for next week. A friendly check-in may prevent further decline.";
  }

  if (riskLevel === "medium") {
    return "Monitor closely over next 30 days. If pattern continues, escalate to active outreach.";
  }

  return "No immediate action needed. Continue normal account management.";
}

/**
 * Master function: Analyze a customer's complete pattern
 */
export function analyzeCustomerPattern(
  history: CustomerOrderHistory,
  now: Date = new Date()
): CustomerPattern {
  const { ns_customer_id, company_name, segment, transactions } = history;

  // Sort transactions by date
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.tran_date).getTime() - new Date(b.tran_date).getTime()
  );

  const orderCount = sorted.length;
  const firstOrderDate = sorted[0]?.tran_date || "";
  const lastOrderDate = sorted[sorted.length - 1]?.tran_date || "";
  const daysSinceLastOrder = lastOrderDate
    ? Math.round((now.getTime() - new Date(lastOrderDate).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  // Run analyses
  const intervalStats = analyzeOrderIntervals(sorted);
  const sizeStats = analyzeOrderSizes(sorted);
  const seasonalPattern = analyzeSeasonality(sorted);

  // Detect anomalies
  let intervalAnomaly: IntervalAnomaly | null = null;
  if (intervalStats && lastOrderDate) {
    intervalAnomaly = detectIntervalAnomaly(intervalStats, lastOrderDate, now);
  }

  const sizeAnomaly = sizeStats ? detectSizeAnomaly(sizeStats) : null;

  // Calculate risk score
  const { score, signals } = calculateChurnRiskScore(
    intervalAnomaly,
    sizeAnomaly,
    intervalStats,
    daysSinceLastOrder
  );

  return {
    ns_customer_id,
    company_name,
    segment,
    orderCount,
    firstOrderDate,
    lastOrderDate,
    daysSinceLastOrder,
    intervalStats,
    sizeStats,
    seasonalPattern,
    intervalAnomaly,
    sizeAnomaly,
    churnRiskScore: score,
    churnSignals: signals,
  };
}

/**
 * Generate a full churn prediction from a customer pattern
 */
export function generateChurnPrediction(pattern: CustomerPattern): ChurnPrediction {
  const { churnRiskScore, churnSignals, segment, sizeStats, orderCount } = pattern;

  // Determine risk level
  let riskLevel: "critical" | "high" | "medium" | "low";
  if (churnRiskScore >= 60) riskLevel = "critical";
  else if (churnRiskScore >= 40) riskLevel = "high";
  else if (churnRiskScore >= 20) riskLevel = "medium";
  else riskLevel = "low";

  // Estimate revenue at risk (use recent avg if available, otherwise lifetime avg)
  const revenueAtRisk = sizeStats
    ? sizeStats.recentAvg * 4 // Assume 4 orders/year at risk
    : 0;

  // Generate narrative
  const narrative = generateNarrative(pattern, {});

  // Get recommended action
  const recommendedAction = getRecommendedAction(riskLevel, churnSignals, segment);

  // Confidence level based on data quality
  // Be HONEST about what the data supports
  let confidenceLevel: number;
  if (orderCount >= 15 && pattern.intervalStats?.isConsistent) {
    confidenceLevel = 85; // Strong confidence - substantial data, proven pattern
  } else if (orderCount >= 10 && pattern.intervalStats?.isConsistent) {
    confidenceLevel = 70; // Good confidence - enough to see a real pattern
  } else if (orderCount >= 8 && pattern.intervalStats) {
    confidenceLevel = 55; // Moderate - pattern emerging but not proven
  } else if (orderCount >= 6 && pattern.intervalStats) {
    confidenceLevel = 40; // Low - barely enough data to claim anything
  } else {
    // Without interval stats, we're just guessing based on time gaps
    // That's not pattern recognition, it's speculation
    confidenceLevel = 25;
  }

  return {
    ns_customer_id: pattern.ns_customer_id,
    company_name: pattern.company_name,
    segment: pattern.segment,
    churnRiskScore: pattern.churnRiskScore,
    riskLevel,
    signals: churnSignals,
    narrative,
    revenueAtRisk,
    recommendedAction,
    confidenceLevel,
  };
}
