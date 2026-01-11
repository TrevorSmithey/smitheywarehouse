"use client";

import { useState, useMemo, Fragment } from "react";
import Link from "next/link";
import {
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
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
import { MetricLabel } from "@/components/MetricLabel";
import { formatCurrency, formatCurrencyFull } from "@/lib/formatters";
import type {
  DoorHealthResponse,
  DoorHealthCustomer,
  DudRateByCohort,
  CohortRetention,
  CustomerSegment,
  LifespanBucket,
  WholesaleResponse,
  WholesaleOrderingAnomaly,
  OrderingAnomalySeverity,
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
// SEGMENT BADGE - Now defined below with InfoTooltip support
// ============================================================================

// ============================================================================
// COHORT RETENTION TABLE - The honest churn numbers
// Shows what % of each acquisition cohort has churned vs retained
// ============================================================================

function CohortRetentionTable({
  cohortData,
}: {
  cohortData: CohortRetention[];
}) {
  if (!cohortData || cohortData.length === 0) return null;

  // All cohorts, sorted by year descending (newest first)
  const allCohorts = [...cohortData].sort((a, b) => b.year - a.year);

  // Calculate average from MATURE cohorts only (confirmed data)
  const matureCohorts = allCohorts.filter((c) => !c.isMaturing);
  const avgChurnPct = matureCohorts.length > 0
    ? Math.round(matureCohorts.reduce((sum, c) => sum + c.churnPct, 0) / matureCohorts.length)
    : 0;

  return (
    <div className="rounded-xl border border-border bg-bg-secondary p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingDown className="w-3.5 h-3.5 text-red-400" />
          <MetricLabel
            label="COHORT CHURN"
            tooltip="Churned = 365+ days since last order (gone). At risk = 180-364 days (at-risk + churning combined)."
            className="text-[10px] uppercase tracking-widest text-text-tertiary"
          />
        </div>
        <div className="text-right">
          <span className="text-lg font-bold text-red-400 tabular-nums">{avgChurnPct}%</span>
          <span className="text-[10px] text-text-muted ml-1">avg</span>
        </div>
      </div>

      {/* All cohorts - unified list */}
      <div className="space-y-2">
        {allCohorts.map((cohort) => {
          // "At risk" combines: at_risk (180-269d) + churning (270-364d)
          const trendingCount = cohort.atRisk + cohort.churning;

          // Percentages (whole numbers only)
          const churnedPct = Math.round(cohort.churnPct);
          const trendingPct = cohort.acquired > 0
            ? Math.round((trendingCount / cohort.acquired) * 100)
            : 0;
          const totalPct = churnedPct + trendingPct;

          return (
            <div key={cohort.year} className="py-2.5 border-b border-border/10 last:border-0">
              {/* Row 1: Year + percentages with clear labels */}
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-text-primary tabular-nums">
                    {cohort.year}
                  </span>
                  {cohort.isMaturing && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-medium">
                      still maturing
                    </span>
                  )}
                </div>
                {/* Clear format: "X% churned · Y% at risk" */}
                <div className="flex items-baseline gap-1">
                  <span className="text-sm font-bold tabular-nums text-red-400">
                    {churnedPct}%
                  </span>
                  <span className="text-[9px] text-red-400/60 mr-1">churned</span>
                  {trendingPct > 0 && (
                    <>
                      <span className="text-[10px] text-text-muted ml-1">·</span>
                      <span className="text-[11px] font-medium tabular-nums text-amber-400/70 ml-1">
                        {trendingPct}%
                      </span>
                      <span className="text-[9px] text-amber-400/50">at risk</span>
                    </>
                  )}
                </div>
              </div>

              {/* Row 2: Counts breakdown */}
              <div className="flex items-center justify-between mb-1.5 text-[10px] tabular-nums">
                <span className="text-text-muted">{cohort.acquired} acquired</span>
                <div className="flex items-center gap-2">
                  {cohort.churned > 0 && (
                    <span className="text-red-400/70">{cohort.churned} gone</span>
                  )}
                  {trendingCount > 0 && (
                    <span className="text-amber-400/70">{trendingCount} trending</span>
                  )}
                </div>
              </div>

              {/* Blended gradient bar - smooth red → orange transition */}
              <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                {totalPct > 0 && (
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${totalPct}%`,
                      background: trendingPct > 0 && churnedPct > 0
                        ? `linear-gradient(to right, #dc2626 0%, #ef4444 ${(churnedPct / totalPct) * 100 - 5}%, #f97316 ${(churnedPct / totalPct) * 100 + 5}%, #f59e0b 100%)`
                        : trendingPct > 0
                          ? 'linear-gradient(to right, #f97316, #f59e0b)'
                          : 'linear-gradient(to right, #dc2626, #ef4444)',
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// CUSTOMER HEALTH BAR - Single stacked bar showing health distribution
// ============================================================================

function CustomerHealthBar({
  funnel,
  total,
}: {
  funnel: DoorHealthResponse["funnel"];
  total: number;
}) {
  const segments = [
    { key: "active", label: "Healthy", count: funnel.active, color: "bg-emerald-500", textColor: "text-emerald-400", tooltip: "Ordered within 180 days. Active, engaged buyers." },
    { key: "atRisk", label: "At Risk", count: funnel.atRisk, color: "bg-amber-500", textColor: "text-amber-400", tooltip: "180-269 days since last order. Slipping—outreach recommended." },
    { key: "churning", label: "Churning", count: funnel.churning, color: "bg-orange-500", textColor: "text-orange-400", tooltip: "270-364 days since last order. High churn probability." },
    { key: "churned", label: "Churned", count: funnel.churned, color: "bg-red-500", textColor: "text-red-400", tooltip: "365+ days since last order. Considered lost." },
  ];

  const segmentsWithPct = segments.map(seg => ({
    ...seg,
    pct: total > 0 ? (seg.count / total) * 100 : 0,
  }));

  return (
    <div className="rounded-xl border border-border/30 bg-bg-secondary p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-text-muted" />
          <span className="text-[10px] uppercase tracking-widest text-text-tertiary">
            CUSTOMER HEALTH
          </span>
        </div>
        <span className="text-sm text-text-secondary tabular-nums">
          {total.toLocaleString()} total
        </span>
      </div>

      {/* Stacked bar with floating labels for narrow segments */}
      <div className="relative">
        {/* Floating labels for narrow segments (positioned above bar) */}
        <div className="h-4 relative mb-1">
          {(() => {
            let cumulative = 0;
            return segmentsWithPct.map((seg) => {
              const left = cumulative;
              cumulative += seg.pct;
              // Only show floating label for narrow segments (< 12%)
              if (seg.pct === 0 || seg.pct >= 12) return null;
              return (
                <span
                  key={`float-${seg.key}`}
                  className="absolute text-[10px] font-medium text-text-secondary tabular-nums"
                  style={{
                    left: `${left + seg.pct / 2}%`,
                    transform: 'translateX(-50%)',
                  }}
                >
                  {seg.pct.toFixed(0)}%
                </span>
              );
            });
          })()}
        </div>

        {/* The bar itself */}
        <div className="h-8 flex rounded-lg overflow-hidden bg-bg-tertiary">
          {segmentsWithPct.map((seg) => {
            if (seg.pct === 0) return null;
            return (
              <div
                key={seg.key}
                className={`${seg.color} relative`}
                style={{ width: `${seg.pct}%` }}
                title={`${seg.label}: ${seg.count} (${seg.pct.toFixed(1)}%)`}
              >
                {/* Show % inside for wide segments only */}
                {seg.pct >= 12 && (
                  <span className="absolute inset-0 flex items-center justify-center text-[11px] font-medium text-white/90 tabular-nums">
                    {seg.pct.toFixed(0)}%
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend - inline with percentages */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mt-3">
        {segmentsWithPct.map((seg) => (
          <div key={seg.key} className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-sm ${seg.color}`} />
            <MetricLabel
              label={seg.label}
              tooltip={seg.tooltip}
              className="text-xs text-text-secondary"
            />
            <span className={`text-xs font-semibold tabular-nums ${seg.textColor}`}>
              {seg.count}
            </span>
            <span className="text-[10px] text-text-muted tabular-nums">
              ({seg.pct.toFixed(1)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// B2B GROWTH - Line chart showing QoQ % growth rate
// ============================================================================

function B2BGrowthChart({
  customersByHealth,
  totalFromDoorHealth,
}: {
  customersByHealth: WholesaleResponse["customersByHealth"] | undefined;
  totalFromDoorHealth?: number;
}) {
  const quarterlyData = useMemo(() => {
    // Combine ALL customer health segments - must include ALL 8 buckets from wholesale API
    const allCustomers = customersByHealth
      ? [
          ...(customersByHealth.thriving || []),
          ...(customersByHealth.stable || []),
          ...(customersByHealth.declining || []),
          ...(customersByHealth.at_risk || []),
          ...(customersByHealth.churning || []),
          ...(customersByHealth.churned || []),
          ...(customersByHealth.new || []),       // Was missing!
          ...(customersByHealth.one_time || []),  // Was missing!
        ]
      : [];

    if (allCustomers.length === 0) return [];

    // Filter out corporate, count the rest
    const b2bCustomers = allCustomers.filter(c => !c.is_corporate_gifting);

    // Group customers by acquisition quarter (starting Q1 2024)
    const byQuarter = new Map<string, number>();
    let preHistory = 0; // Customers acquired before Q1 2024 or without dates

    for (const c of b2bCustomers) {
      if (!c.first_sale_date) {
        preHistory++;
        continue;
      }
      const date = new Date(c.first_sale_date);
      // Pre-2024 customers go into preHistory
      if (date < new Date('2024-01-01')) {
        preHistory++;
        continue;
      }
      const year = date.getFullYear();
      const quarter = Math.floor(date.getMonth() / 3) + 1;
      const key = `${year}-Q${quarter}`;
      byQuarter.set(key, (byQuarter.get(key) || 0) + 1);
    }

    // Build quarterly data with % change (starting Q1 2024)
    const quarters: { quarter: string; label: string; newCustomers: number; cumulative: number; growthPct: number }[] = [];
    let cumulative = preHistory;
    let prevCumulative = preHistory;

    const currentYear = new Date().getFullYear();
    const currentQuarter = Math.floor(new Date().getMonth() / 3) + 1;

    for (let year = 2024; year <= currentYear; year++) {
      const maxQ = year === currentYear ? currentQuarter : 4;
      for (let q = 1; q <= maxQ; q++) {
        const key = `${year}-Q${q}`;
        const newCustomers = byQuarter.get(key) || 0;
        prevCumulative = cumulative;
        cumulative += newCustomers;
        const growthPct = prevCumulative > 0 ? ((cumulative - prevCumulative) / prevCumulative) * 100 : 0;
        quarters.push({
          quarter: key,
          label: `Q${q} '${String(year).slice(-2)}`,
          newCustomers,
          cumulative,
          growthPct: Math.round(growthPct * 10) / 10,
        });
      }
    }

    return quarters;
  }, [customersByHealth]);

  if (quarterlyData.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-bg-secondary p-4 flex items-center justify-center h-full min-h-[180px]">
        <span className="text-sm text-text-muted">Loading customer data...</span>
      </div>
    );
  }

  // Get final cumulative from the chart data
  const latestCount = quarterlyData[quarterlyData.length - 1]?.cumulative || 0;
  const startCount = quarterlyData[0]?.cumulative || 0;
  const totalGrowth = startCount > 0 ? ((latestCount - startCount) / startCount * 100).toFixed(0) : '—';

  return (
    <div className="rounded-xl border border-border bg-bg-secondary p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <MetricLabel
          label="B2B CUSTOMER ACQUISITION"
          tooltip="QoQ % increase in cumulative B2B customers by first order date."
          className="text-[10px] uppercase tracking-widest text-text-tertiary"
        />
        <span className="text-xs text-text-muted">
          {latestCount} total · <span className="text-emerald-400">+{totalGrowth}%</span> since Q1 '24
        </span>
      </div>
      <div className="flex-1 min-h-[144px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={quarterlyData} margin={{ top: 10, right: 25, left: -10, bottom: 5 }}>
            <defs>
              {/* Thermal gradient for line stroke: green (high) → yellow (mid) → orange (low) */}
              <linearGradient id="b2bGrowthLineGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22C55E" />
                <stop offset="30%" stopColor="#22C55E" />
                <stop offset="50%" stopColor="#84CC16" />
                <stop offset="70%" stopColor="#EAB308" />
                <stop offset="85%" stopColor="#F59E0B" />
                <stop offset="100%" stopColor="#F97316" />
              </linearGradient>
              {/* Thermal gradient for fill area with transparency */}
              <linearGradient id="b2bGrowthFillGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22C55E" stopOpacity={0.20} />
                <stop offset="40%" stopColor="#22C55E" stopOpacity={0.10} />
                <stop offset="60%" stopColor="#84CC16" stopOpacity={0.06} />
                <stop offset="80%" stopColor="#EAB308" stopOpacity={0.04} />
                <stop offset="100%" stopColor="#F97316" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#64748B', fontSize: 10 }}
              interval={0}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#64748B', fontSize: 10 }}
              width={42}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.[0]) return null;
                const data = payload[0].payload as { growthPct: number; newCustomers: number; cumulative: number };
                // Thermal color based on growth value
                const getColor = (v: number) => {
                  if (v >= 8) return "#22C55E";
                  if (v >= 5) return "#84CC16";
                  if (v >= 3) return "#EAB308";
                  if (v >= 1) return "#F59E0B";
                  return "#F97316";
                };
                const color = getColor(data.growthPct);
                return (
                  <div className="bg-[#12151F] border border-white/10 rounded-md p-3 text-[11px]">
                    <div className="text-text-secondary font-medium mb-2">{label}</div>
                    <div className="space-y-1">
                      <div className="flex justify-between gap-4">
                        <span className="text-text-muted">QoQ growth</span>
                        <span style={{ color }}>
                          {data.growthPct >= 0 ? '+' : ''}{data.growthPct}%
                        </span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span className="text-text-muted">New B2B acquired</span>
                        <span className="text-text-primary">+{data.newCustomers}</span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span className="text-text-muted">Cumulative total</span>
                        <span className="text-accent-blue">{data.cumulative}</span>
                      </div>
                    </div>
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="growthPct"
              fill="url(#b2bGrowthFillGradient)"
              stroke="url(#b2bGrowthLineGradient)"
              strokeWidth={2.5}
              dot={(props) => {
                const { cx, cy, payload } = props as { cx?: number; cy?: number; payload?: { growthPct: number } };
                if (cx === undefined || cy === undefined || !payload) return null;
                const v = payload.growthPct;
                const getColor = (val: number) => {
                  if (val >= 8) return "#22C55E";
                  if (val >= 5) return "#84CC16";
                  if (val >= 3) return "#EAB308";
                  if (val >= 1) return "#F59E0B";
                  return "#F97316";
                };
                return (
                  <circle cx={cx} cy={cy} r={3.5} fill={getColor(v)} stroke="none" />
                );
              }}
              activeDot={(props) => {
                const { cx, cy, payload } = props as { cx?: number; cy?: number; payload?: { growthPct: number } };
                if (cx === undefined || cy === undefined || !payload) return null;
                const v = payload.growthPct;
                const getColor = (val: number) => {
                  if (val >= 8) return "#22C55E";
                  if (val >= 5) return "#84CC16";
                  if (val >= 3) return "#EAB308";
                  if (val >= 1) return "#F59E0B";
                  return "#F97316";
                };
                return (
                  <circle cx={cx} cy={cy} r={5} fill={getColor(v)} stroke="none" />
                );
              }}
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
// ORDERING ANOMALIES (moved from Wholesale - retention signal)
// ============================================================================

function InfoTooltip({
  children,
  content,
  position = "bottom"
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
          ${isTop ? "bottom-full mb-2" : "top-full mt-2"}
          left-1/2 -translate-x-1/2
        `}
      >
        <div className="relative bg-bg-tertiary border border-border/50 rounded-lg px-3 py-2 shadow-xl">
          <div className={`absolute left-1/2 -translate-x-1/2 w-2 h-2 bg-bg-tertiary border-border/50 rotate-45 ${
            isTop ? "bottom-[-5px] border-b border-r" : "top-[-5px] border-t border-l"
          }`} />
          <span className="relative z-10 text-xs text-text-secondary whitespace-nowrap">
            {content}
          </span>
        </div>
      </div>
    </div>
  );
}

function SegmentBadge({ segment, isCorporate }: { segment: CustomerSegment; isCorporate?: boolean }) {
  if (isCorporate) {
    return (
      <InfoTooltip content="Corporate Gifting Customer">
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">
          CORP
        </span>
      </InfoTooltip>
    );
  }

  const config: Record<CustomerSegment, { label: string; color: string; tooltip: string }> = {
    major: { label: "MAJOR", color: "bg-status-good/20 text-status-good", tooltip: "Lifetime revenue $25,000+" },
    large: { label: "LARGE", color: "bg-accent-blue/20 text-accent-blue", tooltip: "$10,000 – $25,000 lifetime" },
    mid: { label: "MID", color: "bg-purple-400/20 text-purple-400", tooltip: "$5,000 – $10,000 lifetime" },
    small: { label: "SMALL", color: "bg-status-warning/20 text-status-warning", tooltip: "$1,000 – $5,000 lifetime" },
    starter: { label: "STARTER", color: "bg-text-muted/20 text-text-secondary", tooltip: "$500 – $1,000 lifetime" },
    minimal: { label: "MINIMAL", color: "bg-text-muted/10 text-text-muted", tooltip: "Under $500 lifetime" },
  };
  const { label, color, tooltip } = config[segment];
  return (
    <InfoTooltip content={tooltip}>
      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${color}`}>
        {label}
      </span>
    </InfoTooltip>
  );
}

function SeverityBadge({ severity }: { severity: OrderingAnomalySeverity }) {
  const config: Record<OrderingAnomalySeverity, { label: string; color: string }> = {
    critical: { label: "CRITICAL", color: "bg-status-bad/20 text-status-bad" },
    warning: { label: "WARNING", color: "bg-status-warning/20 text-status-warning" },
    watch: { label: "WATCH", color: "bg-accent-blue/20 text-accent-blue" },
  };
  const { label, color } = config[severity];
  return (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${color}`}>
      {label}
    </span>
  );
}

function OrderingAnomalyCard({ anomaly }: { anomaly: WholesaleOrderingAnomaly }) {
  const borderColor =
    anomaly.severity === "critical" ? "border-status-bad/50 bg-status-bad/5" :
    anomaly.severity === "warning" ? "border-status-warning/50 bg-status-warning/5" :
    "border-accent-blue/30 bg-accent-blue/5";

  return (
    <Link
      href={`/sales/customer/${anomaly.ns_customer_id}`}
      className={`block rounded-lg border p-4 ${borderColor} cursor-pointer transition-all hover:scale-[1.02] hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-accent-blue/50`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0 mr-3">
          <div className="text-sm font-medium text-text-primary truncate">
            {anomaly.company_name}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <SegmentBadge segment={anomaly.segment} isCorporate={anomaly.is_corporate_gifting} />
            <SeverityBadge severity={anomaly.severity} />
          </div>
        </div>
        <div className="text-right">
          <div className={`text-lg font-bold tabular-nums ${
            anomaly.severity === "critical" ? "text-status-bad" :
            anomaly.severity === "warning" ? "text-status-warning" :
            "text-accent-blue"
          }`}>
            {anomaly.overdue_ratio.toFixed(1)}x
          </div>
          <div className="text-[9px] text-text-muted">late</div>
        </div>
      </div>

      <div className="space-y-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-text-muted">Typical interval</span>
          <span className="font-medium text-text-primary tabular-nums">
            {anomaly.avg_order_interval_days}d between orders
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-text-muted">Days since last order</span>
          <span className={`font-semibold tabular-nums ${
            anomaly.severity === "critical" ? "text-status-bad" :
            anomaly.severity === "warning" ? "text-status-warning" :
            "text-text-primary"
          }`}>
            {anomaly.days_since_last_order}d
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-text-muted">Total orders</span>
          <span className="font-medium text-text-primary tabular-nums">
            {anomaly.order_count.toLocaleString()}
          </span>
        </div>
        <div className="flex items-center justify-between pt-1 border-t border-border/20">
          <span className="text-text-muted">Lifetime value</span>
          <span className="font-semibold text-text-primary tabular-nums">
            {formatCurrencyFull(anomaly.total_revenue)}
          </span>
        </div>
      </div>
    </Link>
  );
}

function OrderingAnomaliesSection({
  anomalies,
  hideChurned,
  onToggleChurned,
}: {
  anomalies: WholesaleOrderingAnomaly[];
  hideChurned: boolean;
  onToggleChurned: () => void;
}) {
  const nonCorporateAnomalies = anomalies.filter(a => !a.is_corporate_gifting);

  if (!nonCorporateAnomalies || nonCorporateAnomalies.length === 0) return null;

  const filtered = hideChurned ? nonCorporateAnomalies.filter(a => !a.is_churned) : nonCorporateAnomalies;
  const churnedCount = nonCorporateAnomalies.filter(a => a.is_churned).length;

  const criticalCount = filtered.filter(a => a.severity === "critical").length;
  const warningCount = filtered.filter(a => a.severity === "warning").length;
  const watchCount = filtered.filter(a => a.severity === "watch").length;

  return (
    <div className="bg-bg-secondary rounded-xl border border-status-warning/30 overflow-hidden">
      <div className="px-5 py-4 border-b border-border/20 flex items-center justify-between bg-status-warning/5">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-status-warning" />
          <h3 className="text-[10px] uppercase tracking-[0.2em] text-status-warning font-semibold">
            ORDERING ANOMALIES
          </h3>
        </div>
        <div className="flex items-center gap-3 text-[10px]">
          {criticalCount > 0 && (
            <span className="text-status-bad font-semibold">{criticalCount} critical</span>
          )}
          {warningCount > 0 && (
            <span className="text-status-warning font-semibold">{warningCount} warning</span>
          )}
          {watchCount > 0 && (
            <span className="text-accent-blue font-semibold">{watchCount} watch</span>
          )}
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-text-muted">
            Customers overdue based on their historical ordering pattern.
          </p>
          {churnedCount > 0 && (
            <button
              onClick={onToggleChurned}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
                hideChurned
                  ? "bg-accent-blue/20 text-accent-blue"
                  : "bg-text-muted/10 text-text-muted hover:bg-text-muted/20"
              }`}
            >
              {hideChurned ? "Show" : "Hide"} {churnedCount} churned
            </button>
          )}
        </div>

        <div className="max-h-[500px] overflow-y-auto scrollbar-thin pr-1">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filtered.map((anomaly) => (
              <OrderingAnomalyCard key={anomaly.ns_customer_id} anomaly={anomaly} />
            ))}
          </div>
        </div>
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
  const [hideChurnedAnomalies, setHideChurnedAnomalies] = useState(true); // Hide churned by default

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

  return (
    <div className="space-y-6">
      {/* === HERO: CUSTOMER HEALTH BAR === */}
      <CustomerHealthBar funnel={funnel} total={metrics.totalB2BCustomers} />

      {/* === STAT CARDS WITH TOOLTIPS === */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {/* Healthy Doors */}
        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <MetricLabel
            label="HEALTHY"
            tooltip="Ordered within last 180 days"
            className="text-[10px] uppercase tracking-widest text-text-tertiary"
          />
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-semibold tabular-nums text-emerald-400">
              {fmt.num(funnel.active)}
            </span>
            <span className="text-[10px] text-text-muted">Last order &lt;180d</span>
          </div>
        </div>

        {/* At Risk */}
        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <MetricLabel
            label="AT RISK"
            tooltip="180-269 days since last order"
            className="text-[10px] uppercase tracking-widest text-text-tertiary"
          />
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-semibold tabular-nums text-amber-400">
              {funnel.atRisk}
            </span>
            <span className="text-[10px] text-text-muted">Last order 180-269d</span>
          </div>
        </div>

        {/* Churning */}
        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <MetricLabel
            label="CHURNING"
            tooltip="270-364 days since last order"
            className="text-[10px] uppercase tracking-widest text-text-tertiary"
          />
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-semibold tabular-nums text-orange-400">
              {funnel.churning}
            </span>
            <span className="text-[10px] text-text-muted">Last order 270-364d</span>
          </div>
        </div>

        {/* Churned */}
        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <MetricLabel
            label="CHURNED"
            tooltip="365+ days since last order"
            className="text-[10px] uppercase tracking-widest text-text-tertiary"
          />
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-semibold tabular-nums text-red-400">
              {funnel.churned}
            </span>
            <span className="text-[10px] text-text-muted">Last order 365+d ago</span>
          </div>
        </div>

        {/* Revenue at Risk */}
        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <MetricLabel
            label="REV AT RISK"
            tooltip="Lifetime revenue from At Risk + Churning customers"
            className="text-[10px] uppercase tracking-widest text-text-tertiary"
          />
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-semibold tabular-nums text-amber-400">
              {formatCurrency(metrics.revenueAtRisk).replace('.00', '')}
            </span>
          </div>
        </div>

        {/* Avg Lifespan */}
        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <MetricLabel
            label="AVG LIFESPAN"
            tooltip="Average months between first and last order"
            className="text-[10px] uppercase tracking-widest text-text-tertiary"
          />
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-semibold tabular-nums text-text-primary">
              {metrics.avgLifespanMonths}
            </span>
            <span className="text-[10px] text-text-muted">mo, first to last order</span>
          </div>
        </div>
      </div>

      {/* === COHORT CHURN + B2B ACQUISITION (side by side) === */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
        <CohortRetentionTable cohortData={data.cohortRetention || []} />
        <div className="lg:col-span-2 h-full">
          <B2BGrowthChart
            customersByHealth={wholesaleData?.customersByHealth}
            totalFromDoorHealth={metrics.totalB2BCustomers}
          />
        </div>
      </div>

      {/* === DRILL-DOWN TABLE === */}
      <DrillDownTable
        data={data}
        customers={data.customers}
        mode={groupByMode}
        onModeChange={setGroupByMode}
      />

      {/* === ORDERING ANOMALIES === */}
      {wholesaleData?.orderingAnomalies && wholesaleData.orderingAnomalies.length > 0 && (
        <OrderingAnomaliesSection
          anomalies={wholesaleData.orderingAnomalies}
          hideChurned={hideChurnedAnomalies}
          onToggleChurned={() => setHideChurnedAnomalies(!hideChurnedAnomalies)}
        />
      )}

      {/* === DEFINITIONS === */}
      <div className="rounded-xl border border-border bg-bg-secondary p-5">
        <h3 className="text-[10px] uppercase tracking-widest text-text-tertiary mb-4">
          Definitions & Methodology
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
          {/* Terms */}
          <div className="space-y-2">
            <h4 className="text-[9px] uppercase tracking-wider text-text-muted mb-2">Terms</h4>
            <div className="flex justify-between text-xs">
              <span className="text-text-secondary">Customer</span>
              <span className="text-text-muted">B2B account with ≥1 order (excl. corporate/test)</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-text-secondary">Active</span>
              <span className="text-text-muted">&lt;180 days since last order</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-text-secondary">At Risk</span>
              <span className="text-text-muted">180-269 days since last order</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-text-secondary">Churning</span>
              <span className="text-text-muted">270-364 days since last order</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-text-secondary">Churned</span>
              <span className="text-text-muted">≥365 days since last order</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-text-secondary">Lifespan</span>
              <span className="text-text-muted">Months between first and last order</span>
            </div>
          </div>

          {/* Advanced Metrics */}
          <div className="space-y-2">
            <h4 className="text-[9px] uppercase tracking-wider text-text-muted mb-2">Advanced Metrics</h4>
            <div className="flex justify-between text-xs">
              <span className="text-text-secondary">Dud</span>
              <span className="text-text-muted">One-order customer ≥133 days to reorder</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-text-secondary">Dud Maturity</span>
              <span className="text-text-muted">133 days (2× median reorder interval)</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-text-secondary">Churn Year</span>
              <span className="text-text-muted">Year customer crossed 365-day threshold</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-text-secondary">Annual Churn Rate</span>
              <span className="text-text-muted">Churned ÷ pool at start of year</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-text-secondary">Pool-Shrinking</span>
              <span className="text-text-muted">Prior year churned removed from denominator</span>
            </div>
          </div>
        </div>
        <div className="mt-4 pt-3 border-t border-border/30">
          <p className="text-[10px] text-text-muted">
            All metrics exclude corporate customers. Churn threshold of 365 days is industry standard (12 months).
            Dud maturity of 133 days is 2× the median reorder interval of 67 days observed in this dataset.
          </p>
        </div>
      </div>
    </div>
  );
}
