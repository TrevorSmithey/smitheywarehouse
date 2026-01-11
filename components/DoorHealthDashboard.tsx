"use client";

import { useState, useMemo, Fragment } from "react";
import Link from "next/link";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  LabelList,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronRight,
  Users,
  AlertTriangle,
  Activity,
  Clock,
  Calendar,
  Layers,
  BarChart3,
} from "lucide-react";
import { SmitheyPageLoader } from "@/components/SmitheyLoader";
import { formatCurrency } from "@/lib/formatters";
import type {
  DoorHealthResponse,
  DoorHealthCustomer,
  ChurnedByYear,
  ChurnedBySegment,
  ChurnedByLifespan,
  CustomerSegment,
  LifespanBucket,
} from "@/lib/types";

// ============================================================================
// TYPES
// ============================================================================

interface DoorHealthDashboardProps {
  data: DoorHealthResponse | null;
  loading: boolean;
  error?: string | null;
  onRefresh: () => void;
}

type GroupByMode = "year" | "segment" | "lifespan";

// ============================================================================
// CONSTANTS
// ============================================================================

const SEGMENT_LABELS: Record<CustomerSegment, string> = {
  major: "Major",
  large: "Large",
  mid: "Mid",
  small: "Small",
  starter: "Starter",
  minimal: "Minimal",
};

// Using design system colors: accent-blue, accent-cyan, and text hierarchy
const SEGMENT_COLORS: Record<CustomerSegment, string> = {
  major: "text-accent-blue",
  large: "text-accent-cyan",
  mid: "text-text-primary",
  small: "text-text-secondary",
  starter: "text-text-tertiary",
  minimal: "text-text-muted",
};

const LIFESPAN_LABELS: Record<LifespanBucket, string> = {
  "<1yr": "< 1 Year",
  "1-2yr": "1-2 Years",
  "2-3yr": "2-3 Years",
  "3+yr": "3+ Years",
};

// ============================================================================
// TOOLTIP COMPONENT
// ============================================================================

function InfoTooltip({
  children,
  content,
  position = "bottom",
}: {
  children: React.ReactNode;
  content: string;
  position?: "top" | "bottom";
}) {
  const isTop = position === "top";

  return (
    <div className="relative group/tooltip inline-flex justify-center">
      {children}
      <div
        className={`
          absolute z-[100] pointer-events-none
          opacity-0 group-hover/tooltip:opacity-100
          transition-all duration-150 ease-out delay-75
          scale-95 group-hover/tooltip:scale-100
          left-1/2 -translate-x-1/2
          ${isTop ? "bottom-full mb-2" : "top-full mt-2"}
        `}
      >
        <div className="relative">
          <div className="px-3.5 py-1.5 rounded-full bg-bg-tertiary border border-border/10 shadow-xl">
            <span className="text-[11px] font-medium text-text-primary whitespace-nowrap">
              {content}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// SEGMENT BADGE
// ============================================================================

function SegmentBadge({ segment }: { segment: CustomerSegment }) {
  const colorClass = SEGMENT_COLORS[segment];
  return (
    <span className={`text-xs font-medium ${colorClass}`}>
      {SEGMENT_LABELS[segment]}
    </span>
  );
}

// ============================================================================
// METRIC CARD
// ============================================================================

function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  trendLabel,
  tooltip,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  trend?: number;
  trendLabel?: string;
  tooltip?: string;
}) {
  const TrendIcon = trend && trend > 0 ? TrendingUp : TrendingDown;
  const trendColor = trend
    ? trend > 0
      ? "text-status-bad" // Higher churn = bad
      : "text-status-good" // Lower churn = good
    : "";

  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30 p-5">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-text-muted" />
          {tooltip ? (
            <InfoTooltip content={tooltip}>
              <span className="text-xs uppercase tracking-wider text-text-muted cursor-help">
                {title}
              </span>
            </InfoTooltip>
          ) : (
            <span className="text-xs uppercase tracking-wider text-text-muted">
              {title}
            </span>
          )}
        </div>
        {trend !== undefined && (
          <div className={`flex items-center gap-1 ${trendColor}`}>
            <TrendIcon className="w-3 h-3" />
            <span className="text-xs font-medium">
              {Math.abs(trend).toFixed(1)}pp
            </span>
          </div>
        )}
      </div>
      <div className="text-metric font-bold text-text-primary tabular-nums">
        {value}
      </div>
      {subtitle && (
        <div className="text-xs text-text-muted mt-1">{subtitle}</div>
      )}
      {trendLabel && (
        <div className="text-xs text-text-tertiary mt-1">{trendLabel}</div>
      )}
    </div>
  );
}

// ============================================================================
// FUNNEL VISUALIZATION
// ============================================================================

function RetentionFunnel({
  funnel,
  total,
}: {
  funnel: DoorHealthResponse["funnel"];
  total: number;
}) {
  // Funnel uses a visual progression from healthy (green) to churned (red)
  // status-warning is #F59E0B (same as amber-500), orange-500 is intermediate
  const stages = [
    { key: "active", label: "Active", count: funnel.active, color: "bg-status-good" },
    { key: "atRisk", label: "At Risk", count: funnel.atRisk, color: "bg-status-warning" },
    { key: "churning", label: "Churning", count: funnel.churning, color: "bg-status-warning/70" },
    { key: "churned", label: "Churned", count: funnel.churned, color: "bg-status-bad" },
  ];

  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-4 h-4 text-text-muted" />
        <span className="text-xs uppercase tracking-wider text-text-muted">
          Retention Funnel
        </span>
      </div>

      <div className="space-y-3">
        {stages.map((stage) => {
          const pct = total > 0 ? (stage.count / total) * 100 : 0;
          return (
            <div key={stage.key}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-text-secondary">{stage.label}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary tabular-nums">
                    {stage.count}
                  </span>
                  <span className="text-xs text-text-muted tabular-nums w-12 text-right">
                    {pct.toFixed(1)}%
                  </span>
                </div>
              </div>
              <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
                <div
                  className={`h-full ${stage.color} rounded-full transition-all duration-500`}
                  style={{ width: `${Math.max(pct, 1)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 pt-4 border-t border-border/20">
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">Thresholds</span>
          <div className="flex gap-3">
            <span className="text-text-tertiary">At Risk: 180d</span>
            <span className="text-text-tertiary">Churning: 270d</span>
            <span className="text-text-tertiary">Churned: 365d</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// CHURN TREND CHART
// ============================================================================

function ChurnTrendChart({
  data,
  currentYear,
}: {
  data: DoorHealthResponse["churnedByYear"];
  currentYear: number;
}) {
  // Sort by year ascending for the chart
  const chartData = useMemo(() => {
    return [...data]
      .sort((a, b) => a.year - b.year)
      .map((row) => ({
        year: row.year,
        count: row.count,
        revenue: row.revenue,
        isCurrentYear: row.year === currentYear,
        label: row.year === currentYear ? `${row.count} YTD` : String(row.count),
      }));
  }, [data, currentYear]);

  if (chartData.length === 0) {
    return null;
  }

  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-text-muted" />
          <span className="text-xs uppercase tracking-wider text-text-muted">
            Churn Trend by Year
          </span>
        </div>
        <span className="text-xs text-text-tertiary">
          Customers crossing 365-day threshold
        </span>
      </div>

      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 25, right: 10, left: -15, bottom: 5 }}>
            <XAxis
              dataKey="year"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#64748B", fontSize: 11 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#64748B", fontSize: 10 }}
              width={40}
            />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.02)" }}
              contentStyle={{
                backgroundColor: "#12151F",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "8px",
                fontSize: "12px",
              }}
              labelStyle={{ color: "#94A3B8", marginBottom: "4px" }}
              itemStyle={{ color: "#FFFFFF" }}
              formatter={(value, _name, props) => {
                const revenue = (props.payload as { revenue: number })?.revenue || 0;
                return [
                  <span key="value">
                    {value} customers
                    <br />
                    <span style={{ color: "#DC2626", fontSize: "11px" }}>
                      {formatCurrency(revenue)} lost
                    </span>
                  </span>,
                  "",
                ];
              }}
              labelFormatter={(year) => `${year}${Number(year) === currentYear ? " (YTD)" : ""}`}
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={60}>
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.isCurrentYear ? "#F59E0B" : "#DC2626"}
                  fillOpacity={entry.isCurrentYear ? 0.8 : 0.9}
                />
              ))}
              <LabelList
                dataKey="label"
                position="top"
                fill="#94A3B8"
                fontSize={11}
                fontWeight={500}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ============================================================================
// DRILL-DOWN TABLE
// ============================================================================

function DrillDownTable({
  data,
  customers,
  mode,
  onModeChange,
}: {
  data: DoorHealthResponse;
  customers: DoorHealthCustomer[];
  mode: GroupByMode;
  onModeChange: (mode: GroupByMode) => void;
}) {
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  // Get grouped data based on mode
  const groupedData = useMemo(() => {
    switch (mode) {
      case "year":
        return data.churnedByYear.map((row) => ({
          key: String(row.year),
          label: String(row.year),
          count: row.count,
          revenue: row.revenue,
          sublabel: null as string | null,
        }));
      case "segment":
        return data.churnedBySegment.map((row) => ({
          key: row.segment,
          label: SEGMENT_LABELS[row.segment],
          count: row.count,
          revenue: row.revenue,
          sublabel: `Avg lifespan: ${row.avgLifespanMonths.toFixed(1)} mo`,
        }));
      case "lifespan":
        return data.churnedByLifespan.map((row) => ({
          key: row.bucket,
          label: LIFESPAN_LABELS[row.bucket],
          count: row.count,
          revenue: row.revenue,
          sublabel: null,
        }));
    }
  }, [data, mode]);

  // Filter customers for expanded group
  const expandedCustomers = useMemo(() => {
    if (!expandedGroup) return [];
    return customers.filter((c) => {
      switch (mode) {
        case "year":
          return String(c.churn_year) === expandedGroup;
        case "segment":
          return c.segment === expandedGroup;
        case "lifespan":
          const bucket = getLifespanBucket(c.lifespan_months);
          return bucket === expandedGroup;
      }
    });
  }, [customers, expandedGroup, mode]);

  // Memoize sorted/sliced customers to avoid sorting on every render
  const sortedExpandedCustomers = useMemo(() => {
    if (!expandedCustomers.length) return [];
    return [...expandedCustomers]
      .sort((a, b) => b.total_revenue - a.total_revenue)
      .slice(0, 20);
  }, [expandedCustomers]);

  function getLifespanBucket(months: number | null): LifespanBucket {
    if (months === null || months < 12) return "<1yr";
    if (months < 24) return "1-2yr";
    if (months < 36) return "2-3yr";
    return "3+yr";
  }

  const modeIcons = {
    year: Calendar,
    segment: Layers,
    lifespan: Clock,
  };

  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30 overflow-hidden">
      {/* Header with mode toggle */}
      <div className="flex items-center justify-between p-4 border-b border-border/20">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-text-muted" />
          <span className="text-xs uppercase tracking-wider text-text-muted">
            Churned Customers
          </span>
          <span className="text-xs text-text-tertiary">
            ({data.funnel.churned} total)
          </span>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-1 bg-bg-tertiary rounded-lg p-1">
          {(["year", "segment", "lifespan"] as GroupByMode[]).map((m) => {
            const Icon = modeIcons[m];
            const isActive = mode === m;
            return (
              <button
                key={m}
                onClick={() => {
                  onModeChange(m);
                  setExpandedGroup(null);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  isActive
                    ? "bg-accent-blue text-white"
                    : "text-text-tertiary hover:text-text-secondary"
                }`}
              >
                <Icon className="w-3 h-3" />
                {m === "year" ? "Year" : m === "segment" ? "Segment" : "Lifespan"}
              </button>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <div className="max-h-[400px] overflow-y-auto scrollbar-thin">
        <table className="w-full">
          <thead className="sticky top-0 bg-bg-tertiary/95 backdrop-blur-sm z-10">
            <tr className="border-b border-border/20">
              <th className="py-2 px-4 text-left text-[10px] font-semibold uppercase tracking-wider text-text-muted w-8" />
              <th className="py-2 px-4 text-left text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                {mode === "year" ? "Year" : mode === "segment" ? "Segment" : "Lifespan"}
              </th>
              <th className="py-2 px-4 text-right text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                Count
              </th>
              <th className="py-2 px-4 text-right text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                Lost Revenue
              </th>
            </tr>
          </thead>
          <tbody>
            {groupedData.map((row) => {
              const isExpanded = expandedGroup === row.key;
              return (
                <Fragment key={row.key}>
                  <tr
                    onClick={() => setExpandedGroup(isExpanded ? null : row.key)}
                    className="border-b border-border-subtle hover:bg-white/[0.02] transition-colors cursor-pointer"
                  >
                    <td className="py-2.5 px-4">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-text-muted" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-text-muted" />
                      )}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-text-primary">
                          {row.label}
                        </span>
                        {row.sublabel && (
                          <span className="text-xs text-text-muted">{row.sublabel}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <span className="text-sm font-medium text-text-primary tabular-nums">
                        {row.count}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <span className="text-sm text-status-bad tabular-nums">
                        {formatCurrency(row.revenue)}
                      </span>
                    </td>
                  </tr>

                  {/* Expanded customer list */}
                  {isExpanded && (
                    <tr>
                      <td colSpan={4} className="p-0">
                        <div className="bg-bg-primary/50 border-y border-border/10">
                          <table className="w-full">
                            <thead>
                              <tr>
                                <th className="py-2 px-6 text-left text-[10px] font-medium uppercase tracking-wider text-text-muted">
                                  Company
                                </th>
                                <th className="py-2 px-4 text-left text-[10px] font-medium uppercase tracking-wider text-text-muted">
                                  Segment
                                </th>
                                <th className="py-2 px-4 text-right text-[10px] font-medium uppercase tracking-wider text-text-muted">
                                  Last Order
                                </th>
                                <th className="py-2 px-4 text-right text-[10px] font-medium uppercase tracking-wider text-text-muted">
                                  Lifespan
                                </th>
                                <th className="py-2 px-4 text-right text-[10px] font-medium uppercase tracking-wider text-text-muted">
                                  Revenue
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {sortedExpandedCustomers.map((customer) => (
                                  <tr
                                    key={customer.ns_customer_id}
                                    className="hover:bg-white/[0.02] transition-colors"
                                  >
                                    <td className="py-2 px-6">
                                      <Link
                                        href={`/sales/customer/${customer.ns_customer_id}`}
                                        className="text-sm text-accent-blue hover:underline"
                                      >
                                        {customer.company_name}
                                      </Link>
                                    </td>
                                    <td className="py-2 px-4">
                                      <SegmentBadge segment={customer.segment} />
                                    </td>
                                    <td className="py-2 px-4 text-right">
                                      <span className="text-xs text-text-muted tabular-nums">
                                        {customer.last_sale_date
                                          ? new Date(customer.last_sale_date).toLocaleDateString()
                                          : "—"}
                                      </span>
                                    </td>
                                    <td className="py-2 px-4 text-right">
                                      <span className="text-xs text-text-muted tabular-nums">
                                        {customer.lifespan_months !== null
                                          ? `${customer.lifespan_months} mo`
                                          : "—"}
                                      </span>
                                    </td>
                                    <td className="py-2 px-4 text-right">
                                      <span className="text-sm text-text-primary tabular-nums">
                                        {formatCurrency(customer.total_revenue)}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              {expandedCustomers.length > 20 && (
                                <tr>
                                  <td
                                    colSpan={5}
                                    className="py-2 px-6 text-xs text-text-muted text-center"
                                  >
                                    +{expandedCustomers.length - 20} more customers
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {groupedData.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-text-muted text-sm">
                  No churned customers
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN DASHBOARD
// ============================================================================

export function DoorHealthDashboard({
  data,
  loading,
  error,
  onRefresh,
}: DoorHealthDashboardProps) {
  const [groupByMode, setGroupByMode] = useState<GroupByMode>("year");

  // Loading state
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <SmitheyPageLoader message="Analyzing door health..." />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="bg-bg-secondary rounded-xl border border-status-bad/30 p-8 text-center">
        <AlertTriangle className="w-8 h-8 text-status-bad mx-auto mb-3" />
        <h3 className="text-lg font-semibold text-text-primary mb-2">
          Failed to load door health data
        </h3>
        <p className="text-sm text-text-muted mb-4">{error}</p>
        <button
          onClick={onRefresh}
          className="px-4 py-2 bg-accent-blue text-white text-sm font-medium rounded-lg hover:bg-accent-blue/90 transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  // No data state
  if (!data) {
    return (
      <div className="bg-bg-secondary rounded-xl border border-border/30 p-8 text-center">
        <Users className="w-8 h-8 text-text-muted mx-auto mb-3 opacity-40" />
        <p className="text-sm text-text-muted">No data available</p>
      </div>
    );
  }

  const { metrics, funnel } = data;
  const currentYear = new Date().getFullYear();

  // Calculate YTD churned count from churnedByYear data
  const churnedYtd = data.churnedByYear.find((y) => y.year === currentYear)?.count || 0;
  const churnedPriorYear = data.churnedByYear.find((y) => y.year === currentYear - 1)?.count || 0;
  const churnedYtdChange = churnedYtd - churnedPriorYear;

  return (
    <div className="space-y-6">
      {/* 1. TREND CHART - The headline: "Is churn getting better or worse?" */}
      <ChurnTrendChart data={data.churnedByYear} currentYear={currentYear} />

      {/* 2. KEY METRICS - Simplified to 3 actionable cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard
          title="Churned YTD"
          value={churnedYtd}
          icon={TrendingDown}
          trend={churnedYtdChange}
          trendLabel={`${churnedPriorYear} same time last year`}
          tooltip="Customers who crossed 365-day threshold this year"
        />
        <MetricCard
          title="At Risk"
          value={funnel.atRisk + funnel.churning}
          icon={AlertTriangle}
          subtitle={`${funnel.atRisk} at risk (180-270d) + ${funnel.churning} churning (270-365d)`}
          tooltip="Customers you can still save before they churn"
        />
        <MetricCard
          title="Avg Lifespan"
          value={`${metrics.avgLifespanMonths} mo`}
          icon={Clock}
          subtitle={`${metrics.avgLifespanMonthsPriorYear} mo prior year`}
          tooltip="Average tenure from first to last order"
        />
      </div>

      {/* 3. FUNNEL + DRILL-DOWN */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <RetentionFunnel funnel={funnel} total={metrics.totalB2BCustomers} />
        </div>
        <div className="lg:col-span-2">
          <DrillDownTable
            data={data}
            customers={data.customers}
            mode={groupByMode}
            onModeChange={setGroupByMode}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="text-xs text-text-muted text-center pt-4">
        Excludes corporate/gifting customers • Thresholds: At Risk 180d, Churning 270d, Churned 365d
      </div>
    </div>
  );
}
