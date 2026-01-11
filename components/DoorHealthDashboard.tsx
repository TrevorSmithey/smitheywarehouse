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
  ComposedChart,
  Line,
  Area,
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
  CustomerSegment,
  LifespanBucket,
  WholesaleResponse,
} from "@/lib/types";

// ============================================================================
// TYPES
// ============================================================================

interface DoorHealthDashboardProps {
  data: DoorHealthResponse | null;
  loading: boolean;
  error?: string | null;
  onRefresh: () => void;
  wholesaleData?: WholesaleResponse | null;
}

type GroupByMode = "year" | "segment" | "lifespan";

// ============================================================================
// FORGE PALETTE - Industrial heat colors (from AssemblyDashboard)
// ============================================================================

const FORGE = {
  molten: "#FCD34D",    // Glowing yellow - peak heat
  heat: "#F59E0B",      // Amber - hot
  ember: "#EA580C",     // Orange-red - cooling
  copper: "#D97706",    // Deep copper
  iron: "#78716C",      // Cool iron
  slag: "#44403C",      // Dark residue
  steel: "#A1A1AA",     // Polished steel
};

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
// HELPERS
// ============================================================================

const fmt = {
  num: (n: number) => n.toLocaleString(),
  delta: (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`,
  compact: (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n),
};

function getLifespanBucket(months: number | null): LifespanBucket {
  if (months === null || months < 12) return "<1yr";
  if (months < 24) return "1-2yr";
  if (months < 36) return "2-3yr";
  return "3+yr";
}

// ============================================================================
// TREND INDICATOR
// ============================================================================

function Trend({ value, inverted = false, size = "sm" }: { value: number; inverted?: boolean; size?: "sm" | "lg" }) {
  // For churn metrics, higher is bad (inverted)
  const isPositive = inverted ? value < 0 : value >= 0;
  const Icon = value >= 0 ? TrendingUp : TrendingDown;
  const sizeClasses = size === "lg" ? "text-base" : "text-xs";
  return (
    <span className={`inline-flex items-center gap-1 tabular-nums ${sizeClasses} ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
      <Icon className={size === "lg" ? "w-4 h-4" : "w-3 h-3"} />
      {Math.abs(value).toFixed(1)}
    </span>
  );
}

// ============================================================================
// SEGMENT BADGE
// ============================================================================

function SegmentBadge({ segment }: { segment: CustomerSegment }) {
  return (
    <span className={`text-xs font-medium ${SEGMENT_COLORS[segment]}`}>
      {SEGMENT_LABELS[segment]}
    </span>
  );
}

// ============================================================================
// CHURN TREND CHART - Compact bar chart matching design system
// ============================================================================

function ChurnTrendChart({
  data,
  currentYear,
  totalCustomers,
}: {
  data: DoorHealthResponse["churnedByYear"];
  currentYear: number;
  totalCustomers: number;
}) {
  const chartData = useMemo(() => {
    return [...data]
      .sort((a, b) => a.year - b.year)
      .map((row) => ({
        year: String(row.year),
        count: row.count,
        rate: totalCustomers > 0 ? (row.count / totalCustomers) * 100 : 0,
        revenue: row.revenue,
        isCurrentYear: row.year === currentYear,
      }));
  }, [data, currentYear, totalCustomers]);

  if (chartData.length === 0) return null;

  const maxRate = Math.max(...chartData.map(d => d.rate), 1);
  const yAxisMax = Math.ceil(maxRate / 5) * 5; // Round up to nearest 5%

  return (
    <div className="rounded-xl border border-border bg-bg-secondary p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[10px] uppercase tracking-widest text-text-tertiary">
          Churn Rate by Year
        </h3>
        <div className="flex items-center gap-4 text-[10px] text-text-muted">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'linear-gradient(180deg, #EF4444, #B91C1C)' }} />
            Historical
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'linear-gradient(180deg, #FBBF24, #D97706)' }} />
            YTD
          </span>
        </div>
      </div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 15, right: 10, left: -10, bottom: 5 }}>
            <defs>
              <linearGradient id="churnHistorical" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#EF4444" stopOpacity={0.9} />
                <stop offset="100%" stopColor="#B91C1C" stopOpacity={0.7} />
              </linearGradient>
              <linearGradient id="churnYtd" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={FORGE.molten} stopOpacity={0.9} />
                <stop offset="100%" stopColor={FORGE.copper} stopOpacity={0.8} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="year"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#64748B', fontSize: 10 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#64748B', fontSize: 10 }}
              width={40}
              domain={[0, yAxisMax]}
              tickFormatter={(value) => `${value}%`}
            />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.02)' }}
              contentStyle={{
                backgroundColor: '#12151F',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px',
                fontSize: '11px',
              }}
              labelStyle={{ color: '#94A3B8', marginBottom: '4px' }}
              formatter={(value: number, _name: string, props: { payload?: { count?: number; revenue?: number; isCurrentYear?: boolean } }) => {
                const count = props.payload?.count || 0;
                const revenue = props.payload?.revenue || 0;
                const isYtd = props.payload?.isCurrentYear;
                return [
                  <span key="val" className="text-text-primary">
                    {value.toFixed(1)}% churn rate{isYtd ? " (YTD)" : ""}
                    <br />
                    <span style={{ color: '#94A3B8' }}>{count} customers</span>
                    <br />
                    <span style={{ color: '#EF4444' }}>{formatCurrency(revenue)} lost</span>
                  </span>,
                  "",
                ];
              }}
            />
            <Bar dataKey="rate" radius={[3, 3, 0, 0]} maxBarSize={45}>
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.isCurrentYear ? "url(#churnYtd)" : "url(#churnHistorical)"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ============================================================================
// RETENTION FUNNEL - Horizontal bar visualization
// ============================================================================

function RetentionFunnel({
  funnel,
  total,
}: {
  funnel: DoorHealthResponse["funnel"];
  total: number;
}) {
  const stages = [
    { key: "active", label: "Healthy", count: funnel.active, gradient: "from-emerald-500 to-emerald-600", description: "< 180 days" },
    { key: "atRisk", label: "At Risk", count: funnel.atRisk, gradient: "from-amber-400 to-amber-500", description: "180-269 days" },
    { key: "churning", label: "Churning", count: funnel.churning, gradient: "from-orange-400 to-orange-500", description: "270-364 days" },
    { key: "churned", label: "Churned", count: funnel.churned, gradient: "from-red-500 to-red-600", description: ">= 365 days" },
  ];

  return (
    <div className="rounded-xl border border-border bg-bg-secondary p-5">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-4 h-4 text-text-muted" />
        <span className="text-[10px] uppercase tracking-widest text-text-tertiary">
          Retention Funnel
        </span>
      </div>

      <div className="space-y-3">
        {stages.map((stage) => {
          const pct = total > 0 ? (stage.count / total) * 100 : 0;
          return (
            <div key={stage.key}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-text-secondary">{stage.label}</span>
                  <span className="text-[10px] text-text-muted">{stage.description}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-text-primary tabular-nums">
                    {stage.count}
                  </span>
                  <span className="text-xs text-text-muted tabular-nums w-12 text-right">
                    {pct.toFixed(1)}%
                  </span>
                </div>
              </div>
              <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
                <div
                  className={`h-full bg-gradient-to-r ${stage.gradient} rounded-full transition-all duration-500`}
                  style={{ width: `${Math.max(pct, 1)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// B2B GROWTH CHART - Cumulative revenue from wholesaleData.monthly
// ============================================================================

function B2BGrowthChart({
  monthly,
}: {
  monthly: WholesaleResponse["monthly"] | undefined;
}) {
  // Build cumulative data from wholesaleData.monthly (regular_revenue = B2B excluding corporate)
  const chartData = useMemo(() => {
    if (!monthly || monthly.length === 0) return [];

    // Sort by date and take last 24 months
    const sorted = [...monthly]
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-24);

    let cumulativeRevenue = 0;
    let cumulativeCustomers = 0;

    return sorted.map((row) => {
      cumulativeRevenue += row.regular_revenue || 0;
      cumulativeCustomers += row.unique_customers || 0;
      const date = new Date(row.month);
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return {
        month: `${monthNames[date.getMonth()]} '${String(date.getFullYear()).slice(2)}`,
        revenue: row.regular_revenue || 0,
        customers: row.unique_customers || 0,
        cumulativeRevenue,
        cumulativeCustomers,
      };
    });
  }, [monthly]);

  if (chartData.length < 3) {
    return (
      <div className="rounded-xl border border-border bg-bg-secondary p-5 flex items-center justify-center h-[232px]">
        <span className="text-sm text-text-muted">Loading wholesale data...</span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-bg-secondary p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[10px] uppercase tracking-widest text-text-tertiary">
          Cumulative B2B Revenue · Last 24 Months
        </h3>
        <div className="flex items-center gap-4 text-[10px] text-text-muted">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 rounded" style={{ backgroundColor: '#10B981' }} />
            Revenue (excl. Corp)
          </span>
        </div>
      </div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
            <defs>
              <linearGradient id="revenueArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10B981" stopOpacity={0.2} />
                <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="month"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#64748B', fontSize: 9 }}
              interval={2}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#64748B', fontSize: 10 }}
              width={50}
              tickFormatter={(v) => v >= 1000000 ? `$${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `$${(v / 1000).toFixed(0)}K` : `$${v}`}
            />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.02)' }}
              contentStyle={{
                backgroundColor: '#12151F',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px',
                fontSize: '11px',
              }}
              labelStyle={{ color: '#94A3B8', marginBottom: '4px' }}
              formatter={(value: number, name: string) => {
                if (name === 'cumulativeRevenue') return [formatCurrency(value), 'Cumulative Revenue'];
                if (name === 'revenue') return [formatCurrency(value), 'Monthly Revenue'];
                return [value, name];
              }}
            />
            <Area
              type="monotone"
              dataKey="cumulativeRevenue"
              fill="url(#revenueArea)"
              stroke="#10B981"
              strokeWidth={2}
            />
          </ComposedChart>
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

  const sortedExpandedCustomers = useMemo(() => {
    if (!expandedCustomers.length) return [];
    return [...expandedCustomers]
      .sort((a, b) => b.total_revenue - a.total_revenue)
      .slice(0, 20);
  }, [expandedCustomers]);

  const modeIcons = {
    year: Calendar,
    segment: Layers,
    lifespan: Clock,
  };

  return (
    <div className="rounded-xl border border-border bg-bg-secondary overflow-hidden">
      {/* Header with mode toggle */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-text-muted" />
          <span className="text-[10px] uppercase tracking-widest text-text-tertiary">
            Churned Customers
          </span>
          <span className="text-xs text-text-muted ml-1">
            ({data.funnel.churned})
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
      <div className="max-h-[350px] overflow-y-auto scrollbar-thin">
        <table className="w-full">
          <thead className="sticky top-0 bg-bg-tertiary/95 backdrop-blur-sm z-10">
            <tr className="border-b border-border/20">
              <th className="py-2.5 px-4 text-left text-[9px] font-semibold uppercase tracking-wider text-text-muted w-8" />
              <th className="py-2.5 px-4 text-left text-[9px] font-semibold uppercase tracking-wider text-text-muted">
                {mode === "year" ? "Year" : mode === "segment" ? "Segment" : "Lifespan"}
              </th>
              <th className="py-2.5 px-4 text-right text-[9px] font-semibold uppercase tracking-wider text-text-muted">
                Count
              </th>
              <th className="py-2.5 px-4 text-right text-[9px] font-semibold uppercase tracking-wider text-text-muted">
                Lost Revenue
              </th>
            </tr>
          </thead>
          <tbody>
            {groupedData.map((row, idx) => {
              const isExpanded = expandedGroup === row.key;
              return (
                <Fragment key={row.key}>
                  <tr
                    onClick={() => setExpandedGroup(isExpanded ? null : row.key)}
                    className={`border-b border-border/30 hover:bg-white/[0.02] transition-colors cursor-pointer ${idx % 2 === 0 ? 'bg-bg-tertiary/20' : ''}`}
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
                          <span className="text-[10px] text-text-muted">{row.sublabel}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <span className="text-sm font-semibold text-text-primary tabular-nums">
                        {row.count}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <span className="text-sm text-red-400 tabular-nums font-medium">
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
                              <tr className="border-b border-border/20">
                                <th className="py-2 px-6 text-left text-[9px] font-medium uppercase tracking-wider text-text-muted">
                                  Company
                                </th>
                                <th className="py-2 px-4 text-left text-[9px] font-medium uppercase tracking-wider text-text-muted">
                                  Segment
                                </th>
                                <th className="py-2 px-4 text-right text-[9px] font-medium uppercase tracking-wider text-text-muted">
                                  Last Order
                                </th>
                                <th className="py-2 px-4 text-right text-[9px] font-medium uppercase tracking-wider text-text-muted">
                                  Lifespan
                                </th>
                                <th className="py-2 px-4 text-right text-[9px] font-medium uppercase tracking-wider text-text-muted">
                                  Revenue
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {sortedExpandedCustomers.map((customer) => (
                                <tr
                                  key={customer.ns_customer_id}
                                  className="hover:bg-white/[0.02] transition-colors border-b border-border/10"
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
  wholesaleData,
}: DoorHealthDashboardProps) {
  const [groupByMode, setGroupByMode] = useState<GroupByMode>("year");

  // Loading state
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="flex flex-col items-center gap-6">
          <div className="relative">
            <div className="w-16 h-16 rounded-full border-2 border-border" />
            <div
              className="absolute inset-0 w-16 h-16 rounded-full border-2 border-transparent animate-spin"
              style={{ borderTopColor: '#0EA5E9', animationDuration: '1.2s' }}
            />
            <Users className="absolute inset-0 m-auto w-6 h-6 animate-pulse text-text-muted" />
          </div>
          <div className="text-xs uppercase tracking-widest text-text-tertiary">
            Analyzing door health
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="bg-bg-secondary rounded-xl border border-red-500/30 p-8 text-center">
        <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
        <h3 className="text-lg font-semibold text-text-primary mb-2">
          Failed to load data
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

  // YTD stats
  const churnedYtd = data.churnedByYear.find((y) => y.year === currentYear)?.count || 0;
  const churnedPriorYear = data.churnedByYear.find((y) => y.year === currentYear - 1)?.count || 0;
  const churnedYtdDelta = churnedPriorYear > 0 ? ((churnedYtd - churnedPriorYear) / churnedPriorYear) * 100 : 0;

  // Revenue at risk (at_risk + churning customers)
  const atRiskRevenue = data.customers
    .filter(c => c.days_since_last_order !== null && c.days_since_last_order >= 180 && c.days_since_last_order < 365)
    .reduce((sum, c) => sum + c.total_revenue, 0);

  // Gradient based on YTD performance
  const heroGradient = churnedYtdDelta <= 0
    ? "from-emerald-950/30 via-bg-secondary to-bg-secondary"
    : "from-red-950/30 via-bg-secondary to-bg-secondary";

  return (
    <div className="space-y-6">
      {/* === HERO ROW === */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Primary: YTD Churn */}
        <div className={`relative overflow-hidden rounded-xl border border-border bg-gradient-to-br ${heroGradient} p-5`}>
          <div className="flex items-center gap-2 mb-3">
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: churnedYtdDelta <= 0 ? '#10B981' : '#EF4444' }}
            />
            <span className="text-[10px] uppercase tracking-widest text-text-tertiary">
              {currentYear} Churn
            </span>
          </div>
          <div className="flex items-baseline gap-3 mb-2">
            <span className="text-4xl font-semibold tabular-nums text-text-primary">
              {churnedYtd}
            </span>
            <span className="text-sm text-text-tertiary">customers lost</span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <Trend value={churnedYtdDelta} inverted size="lg" />
            <span className="text-text-muted">
              vs {churnedPriorYear} in {currentYear - 1}
            </span>
          </div>
        </div>

        {/* Secondary: Revenue At Risk */}
        <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-amber-950/20 via-bg-secondary to-bg-secondary p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[10px] uppercase tracking-widest text-text-tertiary">
              Revenue at Risk
            </span>
          </div>
          <div className="flex items-baseline gap-3 mb-2">
            <span className="text-4xl font-semibold tabular-nums text-amber-400">
              {formatCurrency(atRiskRevenue)}
            </span>
          </div>
          <div className="text-sm text-text-muted">
            {funnel.atRisk + funnel.churning} customers between 180-365 days silent
          </div>
        </div>
      </div>

      {/* === SECONDARY STATS === */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <div className="text-[10px] uppercase tracking-widest text-text-tertiary mb-2">
            Healthy Doors
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums text-emerald-400">
              {fmt.num(funnel.active)}
            </span>
            <span className="text-xs text-text-muted">&lt; 180d</span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <div className="text-[10px] uppercase tracking-widest text-text-tertiary mb-2">
            At Risk
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums text-amber-400">
              {funnel.atRisk}
            </span>
            <span className="text-xs text-text-muted">180-270d</span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <div className="text-[10px] uppercase tracking-widest text-text-tertiary mb-2">
            Churning
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums text-orange-400">
              {funnel.churning}
            </span>
            <span className="text-xs text-text-muted">270-365d</span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <div className="text-[10px] uppercase tracking-widest text-text-tertiary mb-2">
            Avg Lifespan
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums text-text-primary">
              {metrics.avgLifespanMonths}
            </span>
            <span className="text-xs text-text-muted">months</span>
          </div>
        </div>
      </div>

      {/* === CHARTS ROW === */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChurnTrendChart data={data.churnedByYear} currentYear={currentYear} totalCustomers={metrics.totalB2BCustomers} />
        <B2BGrowthChart monthly={wholesaleData?.monthly} />
      </div>

      {/* === FUNNEL + DRILL-DOWN === */}
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

      {/* === FOOTER === */}
      <div className="flex items-center justify-center text-[10px] text-text-muted pt-2">
        <span>
          Excludes corporate customers • Thresholds: At Risk 180d, Churning 270d, Churned 365d
        </span>
      </div>
    </div>
  );
}
