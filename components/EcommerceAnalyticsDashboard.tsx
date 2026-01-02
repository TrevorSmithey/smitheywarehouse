"use client";

import { useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  AlertCircle,
  ChevronDown,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ComposedChart,
  Bar,
  Line,
  LabelList,
} from "recharts";
import type { AnalyticsData, AnalyticsPeriod } from "@/app/(dashboard)/ecommerce/page";
import { USRevenueMap } from "./USRevenueMap";

interface Props {
  data: AnalyticsData | null;
  loading: boolean;
  error: string | null;
  period: AnalyticsPeriod;
  onPeriodChange: (period: AnalyticsPeriod) => void;
  onRefresh: () => void;
}

const PERIOD_OPTIONS: { value: AnalyticsPeriod; label: string }[] = [
  { value: "mtd", label: "Month to Date" },
  { value: "last_month", label: "Last Month" },
  { value: "qtd", label: "Quarter to Date" },
  { value: "ytd", label: "Year to Date" },
  { value: "30d", label: "Last 30 Days" },
  { value: "90d", label: "Last 90 Days" },
  { value: "12m", label: "Last 12 Months" },
];

// Forge palette - Smithey's cast iron brand identity
const FORGE = {
  copper: "#D97706",
  ember: "#EA580C",
  iron: "#78716C",
  glow: "#FCD34D",
  emerald: "#10B981",
};

const SEGMENT_COLORS = {
  new: FORGE.emerald,
  active: "#3b82f6",
  at_risk: FORGE.copper,
  churned: "#64748B",
  vip: "#8b5cf6",
};

function formatCurrency(value: number): string {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(1)}K`;
  }
  return `$${value.toFixed(0)}`;
}

function formatNumber(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return value.toLocaleString();
}

function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

/**
 * Customer Segments - Smithey-Specific
 *
 * Thresholds calibrated for durable goods (cast iron):
 * - New: 180 days (conversion window)
 * - Engaged: 365 days (active collectors)
 * - Sleeping: 366-545 days (re-engagement)
 * - Lapsed: 545+ days (true churn)
 * - VIP: $1,000+ LTV (separate dimension)
 */
function CustomerSegments({
  segments,
}: {
  segments: AnalyticsData["segments"];
}) {
  const total = segments.total || (segments.new.count + segments.active.count + segments.at_risk.count + segments.churned.count);

  // Rename for clarity - using Smithey terminology
  const segmentData = [
    {
      key: "new",
      label: "New",
      sublabel: "Conversion Window",
      definition: segments.new.definition || "First order within 180 days, single purchase",
      count: segments.new.count,
      avgLTV: segments.new.avgLTV,
      avgOrders: segments.new.avgOrders || 1,
      color: SEGMENT_COLORS.new,
    },
    {
      key: "active",
      label: "Engaged",
      sublabel: "Active Collectors",
      definition: segments.active.definition || "Repeat buyer (2+), last order within 365 days",
      count: segments.active.count,
      avgLTV: segments.active.avgLTV,
      avgOrders: segments.active.avgOrders || 0,
      color: SEGMENT_COLORS.active,
    },
    {
      key: "at_risk",
      label: "Sleeping",
      sublabel: "Re-engagement Window",
      definition: segments.at_risk.definition || "366-545 days since last order",
      count: segments.at_risk.count,
      avgLTV: segments.at_risk.avgLTV,
      avgOrders: segments.at_risk.avgOrders || 0,
      color: SEGMENT_COLORS.at_risk,
    },
    {
      key: "churned",
      label: "Lapsed",
      sublabel: "True Churn",
      definition: segments.churned.definition || "545+ days since last order",
      count: segments.churned.count,
      avgLTV: segments.churned.avgLTV,
      avgOrders: segments.churned.avgOrders || 0,
      color: SEGMENT_COLORS.churned,
    },
  ];

  // VIP is a separate dimension (overlaps with other segments)
  const vip = segments.vip;

  return (
    <div className="bg-bg-secondary border border-border/30 rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <span className="text-[11px] font-semibold tracking-wider text-text-muted uppercase">
            Customer Lifecycle
          </span>
          <span className="text-[10px] text-text-muted ml-2">
            (Calibrated for durable goods)
          </span>
        </div>
        <span className="text-sm text-text-secondary">
          {formatNumber(total)} customers
        </span>
      </div>

      {/* Segment cards grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {segmentData.map((seg) => {
          const pct = total > 0 ? (seg.count / total) * 100 : 0;
          return (
            <div
              key={seg.key}
              className="relative bg-bg-tertiary/50 rounded-lg p-4 border border-border/20"
            >
              {/* Color indicator */}
              <div
                className="absolute top-0 left-0 right-0 h-1 rounded-t-lg"
                style={{ backgroundColor: seg.color }}
              />

              {/* Header */}
              <div className="mb-3 mt-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-text-primary">{seg.label}</span>
                  <span className="text-xs text-text-muted">({pct.toFixed(1)}%)</span>
                </div>
                <span className="text-[10px] text-text-muted">{seg.sublabel}</span>
              </div>

              {/* Count */}
              <div className="text-2xl font-bold text-text-primary mb-1">
                {formatNumber(seg.count)}
              </div>

              {/* Definition */}
              <p className="text-[10px] text-text-muted leading-tight mb-3 min-h-[28px]">
                {seg.definition}
              </p>

              {/* Metrics */}
              <div className="flex justify-between text-xs border-t border-border/20 pt-2">
                <div>
                  <span className="text-text-muted">LTV</span>
                  <span className="ml-1 font-medium text-text-secondary">{formatCurrency(seg.avgLTV)}</span>
                </div>
                <div>
                  <span className="text-text-muted">Orders</span>
                  <span className="ml-1 font-medium text-text-secondary">{seg.avgOrders.toFixed(1)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* VIP callout - separate dimension */}
      {vip && vip.count > 0 && (
        <div className="mt-4 pt-4 border-t border-border/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: SEGMENT_COLORS.vip }}
              />
              <div>
                <span className="text-sm font-semibold text-text-primary">VIP Customers</span>
                <span className="text-xs text-text-muted ml-2">
                  {vip.definition || "$1,000+ lifetime value"}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-6">
              <div className="text-right">
                <span className="text-lg font-bold text-text-primary">{formatNumber(vip.count)}</span>
                <span className="text-xs text-text-muted ml-1">customers</span>
              </div>
              <div className="text-right">
                <span className="text-lg font-bold" style={{ color: SEGMENT_COLORS.vip }}>
                  {formatCurrency(vip.avgLTV)}
                </span>
                <span className="text-xs text-text-muted ml-1">avg LTV</span>
              </div>
              <div className="text-right">
                <span className="text-lg font-bold text-text-secondary">{(vip.avgOrders || 0).toFixed(1)}</span>
                <span className="text-xs text-text-muted ml-1">avg orders</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Insight callout */}
      {segments.active.avgLTV > 0 && segments.new.avgLTV > 0 && (
        <div className="mt-4 pt-4 border-t border-border/20 text-center">
          <span className="text-xs text-text-muted">
            Engaged collectors are worth{" "}
            <span className="font-semibold text-emerald-400">
              {(segments.active.avgLTV / segments.new.avgLTV).toFixed(1)}x
            </span>
            {" "}more than new customers
          </span>
        </div>
      )}
    </div>
  );
}

// Re-engagement Queues - actionable customer counts by lifecycle stage
function ReengagementQueues({
  reengagement,
}: {
  reengagement?: AnalyticsData["reengagement"];
}) {
  if (!reengagement) return null;

  const queues = [
    {
      key: "day90",
      label: "First Nudge",
      sublabel: "75-105 days",
      count: reengagement.day90.count,
      color: FORGE.emerald,
      description: "Single-purchase customers ready for first re-engagement",
    },
    {
      key: "day180",
      label: "Second Push",
      sublabel: "165-195 days",
      count: reengagement.day180.count,
      color: FORGE.copper,
      description: "Still unconverted, 36% of returners come back after this",
    },
    {
      key: "day365",
      label: "Final Attempt",
      sublabel: "350-380 days",
      count: reengagement.day365.count,
      color: "#64748B",
      description: "Last chance before lapsed status",
    },
    {
      key: "lapsedVips",
      label: "VIP Win-back",
      sublabel: "545d+, $1K+ LTV",
      count: reengagement.lapsedVips.count,
      color: "#8b5cf6",
      description: "High-value customers worth dedicated outreach",
    },
  ];

  const totalQueue = queues.reduce((sum, q) => sum + q.count, 0);

  return (
    <div className="bg-bg-secondary border border-border/30 rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <span className="text-[11px] font-semibold tracking-wider text-text-muted uppercase">
            Re-engagement Queues
          </span>
          <span className="text-[10px] text-text-muted ml-2">
            (Actionable today)
          </span>
        </div>
        <span className="text-sm text-text-secondary">
          {formatNumber(totalQueue)} total
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {queues.map((queue) => (
          <div
            key={queue.key}
            className="relative bg-bg-tertiary/50 rounded-lg p-4 border border-border/20 group"
            title={queue.description}
          >
            {/* Color bar */}
            <div
              className="absolute top-0 left-0 right-0 h-1 rounded-t-lg"
              style={{ backgroundColor: queue.color }}
            />

            <div className="pt-1">
              <div className="text-2xl font-bold text-text-primary">
                {formatNumber(queue.count)}
              </div>
              <div className="text-sm font-medium text-text-secondary mt-1">
                {queue.label}
              </div>
              <div className="text-[10px] text-text-muted">
                {queue.sublabel}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Insight */}
      <div className="mt-4 pt-4 border-t border-border/20 text-center">
        <span className="text-xs text-text-muted">
          Based on return curve analysis:{" "}
          <span className="text-text-secondary">
            36% of repeat buyers return after 180 days
          </span>
        </span>
      </div>
    </div>
  );
}

// Product Insights - Cross-sell and repeat rate analytics
function ProductInsights({
  productInsights,
}: {
  productInsights?: AnalyticsData["productInsights"];
}) {
  if (!productInsights) return null;

  const { repeatRates, crossSells, basketPairs, computed_at } = productInsights;

  // Don't render if no data has been computed yet
  if (repeatRates.length === 0 && crossSells.length === 0 && basketPairs.length === 0) {
    return null;
  }

  // Get top 5 repeat rates
  const topRepeatRates = repeatRates.slice(0, 5);

  // Category color mapping
  const categoryColors: Record<string, string> = {
    set: "#8b5cf6",
    skillet: FORGE.copper,
    dutch_oven: "#3b82f6",
    carbon_steel: "#64748B",
    accessory: FORGE.emerald,
    other: "#78716C",
  };

  return (
    <div className="bg-bg-secondary border border-border/30 rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <span className="text-[11px] font-semibold tracking-wider text-text-muted uppercase">
            Product Insights
          </span>
          <span className="text-[10px] text-text-muted ml-2">
            (Pre-computed cross-sell analysis)
          </span>
        </div>
        {computed_at && (
          <span className="text-[10px] text-text-muted">
            Last computed: {new Date(computed_at).toLocaleDateString()}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Repeat Rate Leaders */}
        {topRepeatRates.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-text-secondary mb-3 uppercase tracking-wide">
              Gateway Products
            </h4>
            <div className="space-y-2">
              {topRepeatRates.map((product, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between bg-bg-tertiary/50 rounded-lg px-3 py-2 border border-border/20"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{
                        backgroundColor:
                          categoryColors[product.category] || "#78716C",
                      }}
                    />
                    <span className="text-sm text-text-secondary truncate">
                      {product.product_title}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs text-text-muted">
                      {formatNumber(product.first_buyers)} buyers
                    </span>
                    <span
                      className="text-sm font-semibold"
                      style={{ color: FORGE.copper }}
                    >
                      {product.repeat_rate.toFixed(1)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[10px] text-text-muted text-center">
              First purchase → repeat buyer rate
            </div>
          </div>
        )}

        {/* Cross-sell Cascade */}
        {crossSells.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-text-secondary mb-3 uppercase tracking-wide">
              After No. 12 Skillet
            </h4>
            <div className="space-y-2">
              {crossSells.slice(0, 5).map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between bg-bg-tertiary/50 rounded-lg px-3 py-2 border border-border/20"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-xs text-text-muted w-4">
                      {idx + 1}.
                    </span>
                    <span className="text-sm text-text-secondary truncate">
                      {item.second_product}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs text-text-muted">
                      ~{item.avg_days_between}d
                    </span>
                    <span className="text-sm font-semibold text-text-primary">
                      {formatNumber(item.sequence_count)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[10px] text-text-muted text-center">
              Cross-sell sequence count
            </div>
          </div>
        )}

        {/* Basket Pairs */}
        {basketPairs.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-text-secondary mb-3 uppercase tracking-wide">
              Frequently Together
            </h4>
            <div className="space-y-2">
              {basketPairs.slice(0, 5).map((pair, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between bg-bg-tertiary/50 rounded-lg px-3 py-2 border border-border/20"
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-text-secondary">
                      {pair.product_a.length > 20
                        ? pair.product_a.slice(0, 20) + "..."
                        : pair.product_a}
                    </span>
                    <span className="text-text-muted mx-1">+</span>
                    <span className="text-sm text-text-secondary">
                      {pair.product_b.length > 20
                        ? pair.product_b.slice(0, 20) + "..."
                        : pair.product_b}
                    </span>
                  </div>
                  <div className="flex-shrink-0 ml-2">
                    <span className="text-sm font-semibold text-text-primary">
                      {formatNumber(pair.co_occurrence)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[10px] text-text-muted text-center">
              Same-order co-occurrence
            </div>
          </div>
        )}
      </div>

      {/* Key Insight */}
      <div className="mt-4 pt-4 border-t border-border/20 text-center">
        <span className="text-xs text-text-muted">
          Set buyers repeat at{" "}
          <span className="text-text-secondary font-medium">37%</span> vs
          accessories at{" "}
          <span className="text-text-secondary font-medium">19%</span> — Sets
          attract collection builders
        </span>
      </div>
    </div>
  );
}

// Cohort Retention Table
function CohortRetentionTable({
  cohorts,
}: {
  cohorts: NonNullable<AnalyticsData["cohorts"]>;
}) {
  if (!cohorts || cohorts.length === 0) return null;

  // Show last 12 cohorts
  const displayCohorts = cohorts.slice(0, 12);

  // Format cohort month
  const formatCohort = (cohort: string) => {
    const [year, month] = cohort.split("-");
    const date = new Date(parseInt(year), parseInt(month) - 1);
    return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  };

  // Get retention rate color
  const getRetentionColor = (rate: number, cohortSize: number): string => {
    if (cohortSize === 0) return "text-text-muted";
    if (rate >= 25) return "text-emerald-400";
    if (rate >= 20) return "text-emerald-400/70";
    if (rate >= 15) return "text-text-primary";
    if (rate >= 10) return "text-amber-400/70";
    return "text-text-muted";
  };

  return (
    <div className="bg-bg-secondary border border-border/30 rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-4">
        <span className="text-[11px] font-semibold tracking-wider text-text-muted uppercase">
          Cohort Retention
        </span>
        <span className="text-xs text-text-muted">
          % who made another purchase
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/20">
              <th className="text-left py-2 pr-4 font-semibold text-text-muted">Cohort</th>
              <th className="text-right py-2 px-2 font-semibold text-text-muted">Size</th>
              <th className="text-right py-2 px-2 font-semibold text-text-muted">Return %</th>
              <th className="text-right py-2 px-2 font-semibold text-text-muted">M1</th>
              <th className="text-right py-2 px-2 font-semibold text-text-muted">M2</th>
              <th className="text-right py-2 px-2 font-semibold text-text-muted">M3</th>
              <th className="text-right py-2 px-2 font-semibold text-text-muted hidden lg:table-cell">M6</th>
              <th className="text-right py-2 pl-2 font-semibold text-text-muted hidden lg:table-cell">M12</th>
            </tr>
          </thead>
          <tbody>
            {displayCohorts.map((c) => (
              <tr key={c.cohort} className="border-b border-border/10 hover:bg-bg-tertiary/30">
                <td className="py-2 pr-4 font-medium text-text-secondary">{formatCohort(c.cohort)}</td>
                <td className="py-2 px-2 text-right text-text-muted">{formatNumber(c.cohortSize)}</td>
                <td className={`py-2 px-2 text-right font-semibold ${getRetentionColor(c.returnRate, c.cohortSize)}`}>
                  {c.returnRate.toFixed(1)}%
                </td>
                <td className="py-2 px-2 text-right text-text-muted">
                  {c.m1 > 0 ? formatNumber(c.m1) : "-"}
                </td>
                <td className="py-2 px-2 text-right text-text-muted">
                  {c.m2 > 0 ? formatNumber(c.m2) : "-"}
                </td>
                <td className="py-2 px-2 text-right text-text-muted">
                  {c.m3 > 0 ? formatNumber(c.m3) : "-"}
                </td>
                <td className="py-2 px-2 text-right text-text-muted hidden lg:table-cell">
                  {c.m6 > 0 ? formatNumber(c.m6) : "-"}
                </td>
                <td className="py-2 pl-2 text-right text-text-muted hidden lg:table-cell">
                  {c.m12 > 0 ? formatNumber(c.m12) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Insight */}
      {displayCohorts.length > 0 && (
        <div className="mt-4 pt-3 border-t border-border/20 text-center">
          <span className="text-xs text-text-muted">
            Avg retention rate:{" "}
            <span className="font-semibold text-text-primary">
              {(displayCohorts.reduce((sum, c) => sum + c.returnRate, 0) / displayCohorts.length).toFixed(1)}%
            </span>
            {" "}across {displayCohorts.length} cohorts
          </span>
        </div>
      )}
    </div>
  );
}

// Sessions Chart - Bar chart with YoY comparison and conversion line
function SessionsChart({ sessionMetrics }: { sessionMetrics: AnalyticsData["sessionMetrics"] }) {
  const ytd = sessionMetrics.ytd;
  const trends = sessionMetrics.monthlyTrends;

  // Calculate YoY change
  const yoySessionsChange = ytd.priorYearSessions > 0
    ? ((ytd.totalSessions - ytd.priorYearSessions) / ytd.priorYearSessions) * 100
    : 0;

  // Prepare chart data with YoY change
  // Parse date parts explicitly to avoid timezone issues with ISO strings
  const chartData = trends.map((m) => {
    const [year, monthNum] = m.month.split('-').map(Number);
    const date = new Date(year, monthNum - 1, 1); // month is 0-indexed
    const yoyChange = m.priorYearSessions > 0
      ? Math.round(((m.webSessions - m.priorYearSessions) / m.priorYearSessions) * 100)
      : null;
    return {
      month: date.toLocaleDateString("en-US", { month: "short" }),
      sessions2025: m.webSessions,
      sessions2024: m.priorYearSessions,
      conversionRate: m.conversionRate * 100,
      yoyChange,
    };
  });

  return (
    <div className="bg-bg-secondary border border-border/30 rounded-xl p-5">
      {/* Header */}
      <div className="flex items-baseline justify-between mb-4">
        <span className="text-[11px] font-semibold tracking-wider text-text-muted uppercase">
          Sessions & Conversion
        </span>
        <div className="flex items-baseline gap-4 text-sm">
          <div>
            <span className="font-bold text-lg text-text-primary">{formatNumber(ytd.totalSessions)}</span>
            <span className="text-text-muted ml-1">YTD</span>
            <span className={`ml-2 text-xs font-medium ${yoySessionsChange >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {yoySessionsChange >= 0 ? "+" : ""}{yoySessionsChange.toFixed(1)}% YoY
            </span>
          </div>
          <div className="text-text-muted text-xs">
            <span className="font-medium text-text-secondary">
              {(ytd.avgConversionRate * 100).toFixed(2)}%
            </span>
            {" "}conv
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart data={chartData} barGap={2} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis
              dataKey="month"
              tick={{ fill: "#64748B", fontSize: 11 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
              tickLine={false}
            />
            <YAxis
              yAxisId="sessions"
              tickFormatter={(v) => formatNumber(v)}
              tick={{ fill: "#64748B", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={50}
            />
            <YAxis
              yAxisId="conversion"
              orientation="right"
              tickFormatter={(v) => `${v.toFixed(1)}%`}
              tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              domain={[0, 2.5]}
              width={40}
            />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.03)' }}
              contentStyle={{
                background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.98) 0%, rgba(30, 41, 59, 0.95) 100%)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: "12px",
                boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
                padding: '12px 16px',
              }}
              labelStyle={{ color: '#fff', fontWeight: 600, marginBottom: '8px' }}
              formatter={(value: number, name: string) => {
                const currentYear = new Date().getFullYear();
                if (name === "conversionRate") return [`${value.toFixed(2)}%`, "Conv"];
                if (name === "sessions2025") return [formatNumber(value), String(currentYear)];
                if (name === "sessions2024") return [formatNumber(value), String(currentYear - 1)];
                return [value, name];
              }}
            />
            {/* 2024 bars (faded baseline) */}
            <Bar
              yAxisId="sessions"
              dataKey="sessions2024"
              fill="rgba(100, 116, 139, 0.35)"
              radius={[2, 2, 0, 0]}
              name="sessions2024"
            />
            {/* 2025 bars (bold primary) with YoY % labels */}
            <Bar
              yAxisId="sessions"
              dataKey="sessions2025"
              fill={FORGE.copper}
              radius={[3, 3, 0, 0]}
              name="sessions2025"
            >
              <LabelList
                dataKey="yoyChange"
                position="top"
                formatter={(value) => {
                  if (value === null || value === undefined) return '';
                  const numVal = typeof value === 'number' ? value : 0;
                  return numVal >= 0 ? `+${numVal}%` : `${numVal}%`;
                }}
                style={{
                  fill: 'rgba(255, 255, 255, 0.7)',
                  fontSize: 9,
                  fontWeight: 500,
                }}
              />
            </Bar>
            {/* Conversion rate line (subtle) */}
            <Line
              yAxisId="conversion"
              type="monotone"
              dataKey="conversionRate"
              stroke="rgba(255, 255, 255, 0.5)"
              strokeWidth={2}
              dot={{ fill: 'rgba(255, 255, 255, 0.7)', strokeWidth: 0, r: 3 }}
              activeDot={{ r: 5, fill: '#fff', stroke: FORGE.copper, strokeWidth: 2 }}
              name="conversionRate"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 mt-3 pt-3 border-t border-border/20">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: FORGE.copper }} />
          <span className="text-xs text-text-secondary font-medium">{new Date().getFullYear()}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(100, 116, 139, 0.5)' }} />
          <span className="text-xs text-text-muted">{new Date().getFullYear() - 1}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 rounded-full bg-white/50" />
          <span className="text-xs text-text-muted opacity-70">Conv %</span>
        </div>
      </div>
    </div>
  );
}

// Discount Impact - simple 2-number comparison
function DiscountImpact({ discounts }: { discounts: AnalyticsData["discounts"] }) {
  const difference = discounts.nonDiscountedAOV - discounts.discountedAOV;
  const diffPct = discounts.nonDiscountedAOV > 0
    ? ((difference / discounts.nonDiscountedAOV) * 100).toFixed(0)
    : "0";

  return (
    <div className="bg-bg-secondary border border-border/30 rounded-xl p-5">
      <span className="text-[11px] font-semibold tracking-wider text-text-muted uppercase">
        Discount Impact
      </span>

      <div className="mt-6 flex items-center justify-between gap-4">
        {/* Full Price */}
        <div className="flex-1 text-center">
          <div className="text-3xl font-bold text-emerald-400 tracking-tight">
            {formatCurrency(discounts.nonDiscountedAOV)}
          </div>
          <div className="text-xs text-text-muted mt-1 uppercase tracking-wide">
            Full Price AOV
          </div>
        </div>

        {/* Difference badge */}
        <div className="flex flex-col items-center px-4">
          <div className="text-xs text-text-muted mb-1">vs</div>
          <div
            className="px-3 py-1.5 rounded-full text-xs font-bold"
            style={{ backgroundColor: 'rgba(217, 119, 6, 0.15)', color: FORGE.copper }}
          >
            -{diffPct}%
          </div>
        </div>

        {/* Discounted */}
        <div className="flex-1 text-center">
          <div className="text-3xl font-bold text-text-primary tracking-tight">
            {formatCurrency(discounts.discountedAOV)}
          </div>
          <div className="text-xs text-text-muted mt-1 uppercase tracking-wide">
            Discounted AOV
          </div>
        </div>
      </div>

      <div className="mt-6 pt-4 border-t border-border/20 text-center">
        <span className="text-sm text-text-secondary">
          <span className="font-medium" style={{ color: FORGE.copper }}>
            {discounts.discountRate.toFixed(0)}%
          </span>
          {" "}of orders used a discount
        </span>
      </div>
    </div>
  );
}

// Cohort Health Cards - Clear comparison of each cohort vs benchmark at their age
function CohortMaturationChart({
  cohortMaturation,
}: {
  cohortMaturation?: AnalyticsData["cohortMaturation"];
}) {
  if (!cohortMaturation || cohortMaturation.cohorts.length === 0) return null;

  const { cohorts, benchmarks } = cohortMaturation;

  // For each cohort, find their current milestone and compare to benchmark
  const cohortCards = cohorts.map((cohort) => {
    // Determine the furthest milestone this cohort has reached
    let currentMilestone: "m1" | "m3" | "m6" | "m9" | "m12" = "m1";
    let currentValue = cohort.m1;

    if (cohort.m12 !== null) {
      currentMilestone = "m12";
      currentValue = cohort.m12;
    } else if (cohort.m9 !== null) {
      currentMilestone = "m9";
      currentValue = cohort.m9;
    } else if (cohort.m6 !== null) {
      currentMilestone = "m6";
      currentValue = cohort.m6;
    } else if (cohort.m3 !== null) {
      currentMilestone = "m3";
      currentValue = cohort.m3;
    }

    const benchmark = benchmarks[currentMilestone];
    const percentVsBenchmark = benchmark > 0 && currentValue
      ? Math.round(((currentValue - benchmark) / benchmark) * 100)
      : 0;

    const milestoneLabel = currentMilestone.toUpperCase().replace("M", "M");

    return {
      ...cohort,
      currentMilestone,
      milestoneLabel,
      currentValue,
      benchmark,
      percentVsBenchmark,
    };
  });

  // Reverse so most recent is first
  const displayCards = [...cohortCards].reverse();

  return (
    <div className="bg-bg-secondary border border-border/30 rounded-xl p-6">
      {/* Header */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-text-primary mb-1">
          Cohort Health
        </h3>
        <p className="text-xs text-text-muted">
          How each cohort compares to mature customers at the same age
        </p>
      </div>

      {/* Cohort Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {displayCards.map((card, idx) => {
          const isAbove = card.percentVsBenchmark >= 0;
          const isRecent = idx === 0;

          return (
            <div
              key={card.cohort}
              className={`relative rounded-lg p-4 ${
                isRecent
                  ? "bg-emerald-500/10 border border-emerald-500/30"
                  : "bg-bg-tertiary/50 border border-border/20"
              }`}
            >
              {/* Cohort name & age */}
              <div className="flex items-center justify-between mb-3">
                <span className={`text-sm font-semibold ${isRecent ? "text-emerald-400" : "text-text-primary"}`}>
                  {card.cohort}
                </span>
                <span className="text-[10px] text-text-muted bg-bg-tertiary px-1.5 py-0.5 rounded">
                  {card.milestoneLabel}
                </span>
              </div>

              {/* Current LTV */}
              <div className="mb-3">
                <div className="text-2xl font-bold text-text-primary">
                  {card.currentValue ? formatCurrency(card.currentValue) : "—"}
                </div>
                <div className="text-[10px] text-text-muted mt-0.5">
                  {formatNumber(card.customerCount)} customers
                </div>
              </div>

              {/* Comparison to benchmark */}
              <div className="flex items-center gap-2">
                <div
                  className={`text-xs font-semibold px-2 py-0.5 rounded ${
                    isAbove
                      ? "bg-emerald-500/20 text-emerald-400"
                      : "bg-amber-500/20 text-amber-400"
                  }`}
                >
                  {isAbove ? "+" : ""}{card.percentVsBenchmark}%
                </div>
                <span className="text-[10px] text-text-muted">
                  vs {formatCurrency(card.benchmark)} expected
                </span>
              </div>

              {/* Progress bar showing where they are vs benchmark */}
              <div className="mt-3 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    isAbove ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                  style={{
                    width: `${Math.min(100, Math.max(0, ((card.currentValue || 0) / card.benchmark) * 100))}%`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer - Benchmark explanation */}
      <div className="mt-5 pt-4 border-t border-border/20">
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>
            Benchmarks based on mature cohorts (12+ months old)
          </span>
          <div className="flex items-center gap-4">
            <span>M3: {formatCurrency(benchmarks.m3)}</span>
            <span>M6: {formatCurrency(benchmarks.m6)}</span>
            <span>M12: {formatCurrency(benchmarks.m12)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Deep Dives Section - Collapsible container for secondary analytics
function DeepDivesSection({
  segments,
  cohorts,
  productInsights,
  geographic,
  loading,
}: {
  segments: AnalyticsData["segments"];
  cohorts?: AnalyticsData["cohorts"];
  productInsights?: AnalyticsData["productInsights"];
  geographic: AnalyticsData["geographic"];
  loading: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="border border-border/30 rounded-xl overflow-hidden">
      {/* Header - always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 bg-bg-secondary hover:bg-bg-tertiary/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-text-primary">Deep Dives</span>
          <span className="text-xs text-text-muted">
            Segments, Cohorts, Products, Geography
          </span>
        </div>
        <ChevronDown
          className={`w-5 h-5 text-text-muted transition-transform ${
            isExpanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Collapsible content */}
      {isExpanded && (
        <div className="p-4 pt-0 space-y-6 bg-bg-secondary">
          <CustomerSegments segments={segments} />

          {cohorts && cohorts.length > 0 && (
            <CohortRetentionTable cohorts={cohorts} />
          )}

          <ProductInsights productInsights={productInsights} />

          <USRevenueMap data={geographic.topStates} loading={loading} />
        </div>
      )}
    </div>
  );
}

export function EcommerceAnalyticsDashboard({
  data,
  loading,
  error,
  period,
  onPeriodChange,
  onRefresh,
}: Props) {
  // Error state
  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-6">
        <AlertCircle className="w-12 h-12 text-status-error" />
        <p className="text-text-secondary">{error}</p>
        <button
          onClick={onRefresh}
          className="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors"
          style={{ backgroundColor: 'rgba(217, 119, 6, 0.15)', color: FORGE.copper }}
        >
          <RefreshCw className="w-4 h-4" />
          Try Again
        </button>
      </div>
    );
  }

  // Loading state
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-4">
          <div
            className="w-10 h-10 border-2 rounded-full animate-spin"
            style={{ borderColor: 'rgba(217, 119, 6, 0.2)', borderTopColor: FORGE.copper }}
          />
          <span className="text-text-muted text-sm">Loading analytics...</span>
        </div>
      </div>
    );
  }

  if (!data) return null;

  // Prepare chart data
  const monthlyTrendData = (data.acquisition?.monthlyTrends || []).map((m) => {
    const [year, month] = m.month.split('-').map(Number);
    const date = new Date(year, month - 1, 1);
    return {
      month: date.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      newRevenue: m.newCustomerRevenue,
      returningRevenue: m.returningCustomerRevenue,
    };
  });

  const isPositive = (data.summary.revenueDeltaPct ?? 0) >= 0;

  return (
    <div className="space-y-6">
      {/* ============================================
          HERO - The Pulse (Scannable in 2 seconds)
          ============================================ */}
      <div className="bg-bg-secondary border border-border/30 rounded-xl p-5">
        {/* Top row: Controls */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-text-muted">
              {new Date(data.dateRange.start).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {new Date(data.dateRange.end).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={period}
              onChange={(e) => onPeriodChange(e.target.value as AnalyticsPeriod)}
              className="px-3 py-1.5 bg-bg-tertiary border border-border/30 rounded-lg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-amber-600/50 transition-all"
            >
              {PERIOD_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button
              onClick={onRefresh}
              disabled={loading}
              className="p-1.5 bg-bg-tertiary border border-border/30 rounded-lg text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Metrics row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 md:gap-6">
          {/* Revenue */}
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold" style={{ color: FORGE.copper }}>
                {formatCurrency(data.summary.totalRevenue)}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] text-text-muted uppercase tracking-wide">Revenue</span>
              {data.summary.revenueDeltaPct !== undefined && (
                <span className={`text-xs font-medium ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
                  {isPositive ? "↑" : "↓"} {formatPercent(Math.abs(data.summary.revenueDeltaPct))}
                </span>
              )}
            </div>
          </div>

          {/* Orders */}
          <div>
            <div className="text-2xl font-bold text-text-primary">
              {formatNumber(data.summary.totalOrders)}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] text-text-muted uppercase tracking-wide">Orders</span>
              {data.summary.ordersDelta !== undefined && data.summary.ordersDelta !== 0 && (
                <span className={`text-xs font-medium ${data.summary.ordersDelta > 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {data.summary.ordersDelta > 0 ? "↑" : "↓"} {formatNumber(Math.abs(data.summary.ordersDelta))}
                </span>
              )}
            </div>
          </div>

          {/* AOV */}
          <div>
            <div className="text-2xl font-bold text-text-primary">
              {formatCurrency(data.summary.avgOrderValue)}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] text-text-muted uppercase tracking-wide">AOV</span>
              {data.summary.aovDeltaPct !== undefined && data.summary.aovDeltaPct !== 0 && (
                <span className={`text-xs font-medium ${data.summary.aovDeltaPct > 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {data.summary.aovDeltaPct > 0 ? "↑" : "↓"} {formatPercent(Math.abs(data.summary.aovDeltaPct))}
                </span>
              )}
            </div>
          </div>

          {/* Conversion */}
          <div>
            <div className="text-2xl font-bold text-text-primary">
              {data.sessionMetrics?.currentMonth?.conversionRate
                ? `${(data.sessionMetrics.currentMonth.conversionRate * 100).toFixed(1)}%`
                : "—"}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] text-text-muted uppercase tracking-wide">Conv Rate</span>
              {data.sessionMetrics?.currentMonth?.conversionRate && data.sessionMetrics?.priorMonth?.conversionRate && (
                (() => {
                  const delta = data.sessionMetrics.currentMonth.conversionRate - data.sessionMetrics.priorMonth.conversionRate;
                  const deltaPct = delta * 100;
                  if (Math.abs(deltaPct) < 0.1) return null;
                  return (
                    <span className={`text-xs font-medium ${delta > 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {delta > 0 ? "↑" : "↓"} {Math.abs(deltaPct).toFixed(1)}%
                    </span>
                  );
                })()
              )}
            </div>
          </div>

          {/* Repeat Rate */}
          <div>
            <div className="text-2xl font-bold text-text-primary">
              {data.summary.repeatPurchaseRate.toFixed(1)}%
            </div>
            <div className="text-[10px] text-text-muted uppercase tracking-wide mt-1">
              Repeat Rate
            </div>
          </div>
        </div>

        {/* Comparison context */}
        <div className="mt-4 pt-4 border-t border-border/20 text-xs text-text-muted">
          Comparing to {["30d", "90d", "12m"].includes(period) ? "prior period" : "same period last year"}
        </div>
      </div>

      {/* ============================================
          CUSTOMER COMPOSITION + TREND
          ============================================ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue Split Donut */}
        <div className="bg-bg-secondary border border-border/30 rounded-xl p-5 relative overflow-hidden">
          <div
            className="absolute inset-0 opacity-40"
            style={{
              background: `radial-gradient(ellipse at 30% 20%, rgba(16, 185, 129, 0.06) 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(217, 119, 6, 0.06) 0%, transparent 50%)`
            }}
          />

          <span className="relative text-[11px] font-semibold tracking-wider text-text-muted uppercase">
            Revenue Split
          </span>

          {/* Custom Donut */}
          <div className="relative flex justify-center my-6">
            <div className="relative">
              <svg width="160" height="160" viewBox="0 0 160 160" className="transform -rotate-90">
                <circle
                  cx="80"
                  cy="80"
                  r="60"
                  fill="none"
                  stroke="rgba(255,255,255,0.05)"
                  strokeWidth="16"
                />
                {/* Returning segment (copper) */}
                <circle
                  cx="80"
                  cy="80"
                  r="60"
                  fill="none"
                  stroke={FORGE.copper}
                  strokeWidth="16"
                  strokeDasharray={`${(100 - (data.acquisition?.newVsReturning?.newRevenuePct ?? 0)) * 3.77} 377`}
                  strokeLinecap="round"
                  className="transition-all duration-700 ease-out"
                />
                {/* New segment (emerald) */}
                <circle
                  cx="80"
                  cy="80"
                  r="60"
                  fill="none"
                  stroke={FORGE.emerald}
                  strokeWidth="16"
                  strokeDasharray={`${(data.acquisition?.newVsReturning?.newRevenuePct ?? 0) * 3.77} 377`}
                  strokeDashoffset={`-${(100 - (data.acquisition?.newVsReturning?.newRevenuePct ?? 0)) * 3.77}`}
                  strokeLinecap="round"
                  className="transition-all duration-700 ease-out"
                />
              </svg>

              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold text-text-primary tracking-tight">
                  {formatCurrency(data.summary.totalRevenue)}
                </span>
                <span className="text-[10px] text-text-muted uppercase tracking-wider mt-0.5">
                  Total
                </span>
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="relative space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20" />
                <span className="text-sm text-text-secondary">New Customers</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-text-primary">
                  {formatCurrency(data.acquisition?.newVsReturning?.newRevenue ?? 0)}
                </span>
                <span className="text-xs font-medium text-emerald-400">
                  {data.acquisition?.newVsReturning?.newRevenuePct ?? 0}%
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-2.5 h-2.5 rounded-full ring-2 ring-amber-600/20"
                  style={{ backgroundColor: FORGE.copper }}
                />
                <span className="text-sm text-text-secondary">Returning Customers</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-text-primary">
                  {formatCurrency(data.acquisition?.newVsReturning?.returningRevenue ?? 0)}
                </span>
                <span className="text-xs font-medium" style={{ color: FORGE.copper }}>
                  {(100 - (data.acquisition?.newVsReturning?.newRevenuePct ?? 0)).toFixed(1)}%
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Monthly Trend Chart */}
        <div className="lg:col-span-2 bg-bg-secondary border border-border/30 rounded-xl p-5">
          <span className="text-[11px] font-semibold tracking-wider text-text-muted uppercase">
            Revenue Trend
          </span>
          <div className="h-64 mt-4">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <AreaChart data={monthlyTrendData}>
                <defs>
                  <linearGradient id="gradientCopper" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={FORGE.copper} stopOpacity={0.4}/>
                    <stop offset="95%" stopColor={FORGE.copper} stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="gradientEmerald" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={FORGE.emerald} stopOpacity={0.4}/>
                    <stop offset="95%" stopColor={FORGE.emerald} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="month"
                  tick={{ fill: "#64748B", fontSize: 11 }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                />
                <YAxis
                  tickFormatter={(v) => formatCurrency(v)}
                  tick={{ fill: "#64748B", fontSize: 11 }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                />
                <Tooltip
                  formatter={(value: number) => formatCurrency(value)}
                  contentStyle={{
                    background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.98) 0%, rgba(30, 41, 59, 0.95) 100%)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: "12px",
                    boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
                  }}
                  labelStyle={{ color: '#fff', fontWeight: 600 }}
                />
                <Area
                  type="monotone"
                  dataKey="returningRevenue"
                  stackId="1"
                  stroke={FORGE.copper}
                  fill="url(#gradientCopper)"
                  name="Returning Customers"
                />
                <Area
                  type="monotone"
                  dataKey="newRevenue"
                  stackId="1"
                  stroke={FORGE.emerald}
                  fill="url(#gradientEmerald)"
                  name="New Customers"
                />
                <Legend
                  wrapperStyle={{ paddingTop: '16px' }}
                  formatter={(value) => <span style={{ color: '#94A3B8', fontSize: '12px' }}>{value}</span>}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ============================================
          COHORT HEALTH
          ============================================ */}
      <CohortMaturationChart cohortMaturation={data.cohortMaturation} />

      {/* ============================================
          SESSIONS & CONVERSION
          ============================================ */}
      <SessionsChart sessionMetrics={data.sessionMetrics} />

      {/* ============================================
          DEEP DIVES (Secondary - collapsed by default on mobile)
          ============================================ */}
      <DeepDivesSection
        segments={data.segments}
        cohorts={data.cohorts}
        productInsights={data.productInsights}
        geographic={data.geographic}
        loading={loading}
      />
    </div>
  );
}
