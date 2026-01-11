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
import { formatCurrency } from "@/lib/formatters";
import type {
  DoorHealthResponse,
  DoorHealthCustomer,
  DudRateByCohort,
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
// CHURN & DUD RATE TREND - Dual Y-axis line chart
// ============================================================================

function ChurnDudTrendChart({
  churnData,
  dudData,
  compact = false,
}: {
  churnData: DoorHealthResponse["churnedByYear"];
  dudData: DudRateByCohort[];
  compact?: boolean;
}) {
  // Merge churn and dud data by year
  const chartData = useMemo(() => {
    // Build a map of years with both metrics
    const yearMap = new Map<string, { year: string; churnRate: number | null; dudRate: number | null; churnCount: number; poolSize: number; dudMature: number; dudTotal: number }>();

    // Add churn data
    for (const row of churnData) {
      const year = String(row.year);
      yearMap.set(year, {
        year,
        churnRate: row.churnRate,
        dudRate: null,
        churnCount: row.count,
        poolSize: row.poolSize,
        dudMature: 0,
        dudTotal: 0,
      });
    }

    // Add dud data (cohort like "2024" or "2025 H1")
    for (const row of dudData) {
      // Extract year from cohort (e.g., "2025 H1" -> "2025")
      const year = row.cohort.split(" ")[0];
      const existing = yearMap.get(year);
      if (existing) {
        // Average dud rates if multiple cohorts per year (H1/H2)
        if (existing.dudRate !== null) {
          existing.dudRate = (existing.dudRate + (row.dudRate || 0)) / 2;
          existing.dudMature += row.matureOneTime;
          existing.dudTotal += row.matureCustomers;
        } else {
          existing.dudRate = row.dudRate;
          existing.dudMature = row.matureOneTime;
          existing.dudTotal = row.matureCustomers;
        }
      } else {
        yearMap.set(year, {
          year,
          churnRate: null,
          dudRate: row.dudRate,
          churnCount: 0,
          poolSize: 0,
          dudMature: row.matureOneTime,
          dudTotal: row.matureCustomers,
        });
      }
    }

    return Array.from(yearMap.values())
      .filter((d) => d.churnRate !== null || d.dudRate !== null)
      .sort((a, b) => a.year.localeCompare(b.year));
  }, [churnData, dudData]);

  if (chartData.length === 0) return null;

  const maxChurn = Math.max(...chartData.map(d => d.churnRate || 0), 1);
  const maxDud = Math.max(...chartData.map(d => d.dudRate || 0), 1);
  const churnAxisMax = Math.ceil(maxChurn / 5) * 5;
  const dudAxisMax = Math.ceil(maxDud / 10) * 10;

  return (
    <div className={`rounded-xl border border-border bg-bg-secondary ${compact ? 'p-4' : 'p-5'}`}>
      <div className="flex items-center justify-between mb-3">
        <MetricLabel
          label="CHURN & DUD TREND"
          tooltip="Annual churn rate (red) vs dud rate (amber). Churn = lost customers / pool. Dud = one-time buyers who never reorder."
          className="text-[10px] uppercase tracking-widest text-text-tertiary"
        />
        <div className="flex items-center gap-3 text-[10px] text-text-muted">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-0.5 rounded" style={{ backgroundColor: '#EF4444' }} />
            Churn
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-0.5 rounded" style={{ backgroundColor: '#F59E0B' }} />
            Dud
          </span>
        </div>
      </div>
      <div className={compact ? "h-36" : "h-52"}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
            <XAxis
              dataKey="year"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#64748B', fontSize: 11 }}
            />
            <YAxis
              yAxisId="churn"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#EF4444', fontSize: 10 }}
              width={40}
              domain={[0, churnAxisMax]}
              tickFormatter={(value) => `${value}%`}
            />
            <YAxis
              yAxisId="dud"
              orientation="right"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#F59E0B', fontSize: 10 }}
              width={45}
              domain={[0, dudAxisMax]}
              tickFormatter={(value) => `${value}%`}
            />
            <Tooltip
              cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1 }}
              contentStyle={{
                backgroundColor: '#12151F',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px',
                fontSize: '11px',
              }}
              labelStyle={{ color: '#94A3B8', marginBottom: '4px' }}
              formatter={(value: number, name: string, props: { payload?: { churnCount?: number; poolSize?: number; dudMature?: number; dudTotal?: number } }) => {
                if (name === 'churnRate') {
                  const count = props.payload?.churnCount || 0;
                  const pool = props.payload?.poolSize || 0;
                  return [
                    <span key="churn" style={{ color: '#EF4444' }}>
                      {value?.toFixed(1)}% churn ({count}/{pool})
                    </span>,
                    '',
                  ];
                }
                if (name === 'dudRate') {
                  const mature = props.payload?.dudMature || 0;
                  const total = props.payload?.dudTotal || 0;
                  return [
                    <span key="dud" style={{ color: '#F59E0B' }}>
                      {value?.toFixed(1)}% dud ({mature}/{total} mature)
                    </span>,
                    '',
                  ];
                }
                return [value, name];
              }}
            />
            <Line
              yAxisId="churn"
              type="monotone"
              dataKey="churnRate"
              stroke="#EF4444"
              strokeWidth={2.5}
              dot={{ fill: '#EF4444', strokeWidth: 0, r: 4 }}
              activeDot={{ r: 6, fill: '#EF4444' }}
              connectNulls
            />
            <Line
              yAxisId="dud"
              type="monotone"
              dataKey="dudRate"
              stroke="#F59E0B"
              strokeWidth={2.5}
              dot={{ fill: '#F59E0B', strokeWidth: 0, r: 4 }}
              activeDot={{ r: 6, fill: '#F59E0B' }}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {!compact && (
        <div className="mt-3 pt-3 border-t border-border/30 text-[10px] text-text-muted">
          <span className="text-red-400">Churn</span> = customers lost (365+ days) ÷ pool at year start •
          <span className="text-amber-400 ml-1">Dud</span> = one-time buyers with 133+ days to reorder
        </div>
      )}
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
    { key: "atRisk", label: "At Risk", count: funnel.atRisk, color: "bg-amber-400", textColor: "text-amber-400", tooltip: "180-269 days since last order. Slipping—outreach recommended." },
    { key: "churning", label: "Churning", count: funnel.churning, color: "bg-orange-500", textColor: "text-orange-400", tooltip: "270-364 days since last order. High churn probability." },
    { key: "churned", label: "Churned", count: funnel.churned, color: "bg-red-500", textColor: "text-red-400", tooltip: "365+ days since last order. Considered lost." },
  ];

  return (
    <div className="rounded-xl border border-border bg-bg-secondary p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-text-muted" />
          <span className="text-[10px] uppercase tracking-widest text-text-tertiary">
            CUSTOMER HEALTH
          </span>
        </div>
        <span className="text-sm font-medium text-text-secondary tabular-nums">
          {total.toLocaleString()} total
        </span>
      </div>

      {/* Single stacked bar */}
      <div className="h-8 flex rounded-lg overflow-hidden bg-bg-tertiary">
        {segments.map((seg) => {
          const pct = total > 0 ? (seg.count / total) * 100 : 0;
          if (pct === 0) return null;
          return (
            <div
              key={seg.key}
              className={`${seg.color} relative group transition-all hover:brightness-110`}
              style={{ width: `${pct}%` }}
              title={`${seg.label}: ${seg.count} (${pct.toFixed(1)}%)`}
            >
              {/* Show label inside if segment is wide enough */}
              {pct > 12 && (
                <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-white/90">
                  {pct.toFixed(0)}%
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend below - each label has its own tooltip */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-3">
        {segments.map((seg) => {
          const pct = total > 0 ? (seg.count / total) * 100 : 0;
          return (
            <div key={seg.key} className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-sm ${seg.color}`} />
              <MetricLabel
                label={seg.label}
                tooltip={seg.tooltip}
                className="text-xs text-text-secondary"
              />
              <span className={`text-xs font-semibold tabular-nums ${seg.textColor}`}>
                {seg.count}
              </span>
              <span className="text-[10px] text-text-muted tabular-nums">
                ({pct.toFixed(1)}%)
              </span>
            </div>
          );
        })}
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
    // Combine ALL customer health segments including churned
    const allCustomers = customersByHealth
      ? [
          ...(customersByHealth.thriving || []),
          ...(customersByHealth.stable || []),
          ...(customersByHealth.declining || []),
          ...(customersByHealth.at_risk || []),
          ...(customersByHealth.churning || []),
          ...(customersByHealth.churned || []),
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

    // The wholesaleData may not include all customers that door-health counts
    // Adjust preHistory to account for any "missing" customers
    const computedTotal = preHistory + Array.from(byQuarter.values()).reduce((a, b) => a + b, 0);
    const actualTotal = totalFromDoorHealth || computedTotal;
    const missingCustomers = actualTotal - computedTotal;
    if (missingCustomers > 0) {
      preHistory += missingCustomers; // These are older customers not in wholesaleData
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
  }, [customersByHealth, totalFromDoorHealth]);

  if (quarterlyData.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-bg-secondary p-4 flex items-center justify-center h-[180px]">
        <span className="text-sm text-text-muted">Loading customer data...</span>
      </div>
    );
  }

  // Get final cumulative from the chart data (now properly adjusted)
  const latestCount = quarterlyData[quarterlyData.length - 1]?.cumulative || 0;
  const startCount = quarterlyData[0]?.cumulative || 0;
  const totalGrowth = startCount > 0 ? ((latestCount - startCount) / startCount * 100).toFixed(0) : '—';

  return (
    <div className="rounded-xl border border-border bg-bg-secondary p-4">
      <div className="flex items-center justify-between mb-3">
        <MetricLabel
          label="B2B GROWTH RATE"
          tooltip="Quarter-over-quarter growth in total B2B customers. Shows new customer acquisition momentum."
          className="text-[10px] uppercase tracking-widest text-text-tertiary"
        />
        <span className="text-xs text-text-muted">
          {latestCount} total · <span className="text-emerald-400">+{totalGrowth}%</span> since Q1 '24
        </span>
      </div>
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={quarterlyData} margin={{ top: 10, right: 10, left: -15, bottom: 5 }}>
            <defs>
              <linearGradient id="growthGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10B981" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#10B981" stopOpacity={0.02} />
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
              width={35}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.[0]) return null;
                const data = payload[0].payload;
                return (
                  <div className="bg-[#12151F] border border-white/10 rounded-md p-3 text-[11px]">
                    <div className="text-text-secondary font-medium mb-2">{label}</div>
                    <div className="space-y-1">
                      <div className="flex justify-between gap-4">
                        <span className="text-text-muted">Growth</span>
                        <span className={data.growthPct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                          {data.growthPct >= 0 ? '+' : ''}{data.growthPct}%
                        </span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span className="text-text-muted">New customers</span>
                        <span className="text-text-primary">+{data.newCustomers}</span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span className="text-text-muted">Total</span>
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
              fill="url(#growthGradient)"
              stroke="transparent"
            />
            <Line
              type="monotone"
              dataKey="growthPct"
              stroke="#10B981"
              strokeWidth={2}
              dot={{ fill: '#10B981', strokeWidth: 0, r: 3 }}
              activeDot={{ r: 5, fill: '#10B981' }}
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
            tooltip="Customers with an order in the last 180 days. These are active, engaged buyers."
            className="text-[10px] uppercase tracking-widest text-text-tertiary"
          />
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-semibold tabular-nums text-emerald-400">
              {fmt.num(funnel.active)}
            </span>
            <span className="text-[10px] text-text-muted">&lt;180d</span>
          </div>
        </div>

        {/* At Risk */}
        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <MetricLabel
            label="AT RISK"
            tooltip="180-269 days since last order. Slipping away—outreach recommended."
            className="text-[10px] uppercase tracking-widest text-text-tertiary"
          />
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-semibold tabular-nums text-amber-400">
              {funnel.atRisk}
            </span>
            <span className="text-[10px] text-text-muted">180-269d</span>
          </div>
        </div>

        {/* Churning */}
        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <MetricLabel
            label="CHURNING"
            tooltip="270-364 days since last order. High probability of permanent loss without intervention."
            className="text-[10px] uppercase tracking-widest text-text-tertiary"
          />
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-semibold tabular-nums text-orange-400">
              {funnel.churning}
            </span>
            <span className="text-[10px] text-text-muted">270-364d</span>
          </div>
        </div>

        {/* Churned */}
        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <MetricLabel
            label="CHURNED"
            tooltip="365+ days since last order. Considered lost—requires win-back campaign."
            className="text-[10px] uppercase tracking-widest text-text-tertiary"
          />
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-semibold tabular-nums text-red-400">
              {funnel.churned}
            </span>
            <span className="text-[10px] text-text-muted">365+d</span>
          </div>
        </div>

        {/* Revenue at Risk */}
        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <MetricLabel
            label="REV AT RISK"
            tooltip="Total lifetime revenue from At Risk + Churning customers (180-364 days). This is money that could walk."
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
            tooltip="Average months between a customer's first and last order. Higher is better—indicates stickier relationships."
            className="text-[10px] uppercase tracking-widest text-text-tertiary"
          />
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-semibold tabular-nums text-text-primary">
              {metrics.avgLifespanMonths}
            </span>
            <span className="text-[10px] text-text-muted">mo</span>
          </div>
        </div>
      </div>

      {/* === ANNUAL CHURN + TREND CHART === */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Annual Churn Table - compact */}
        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="w-3.5 h-3.5 text-text-muted" />
            <MetricLabel
              label="ANNUAL CHURN"
              tooltip="Customers lost per year. Rate = churned ÷ pool at year start (pool shrinks as customers churn)."
              className="text-[10px] uppercase tracking-widest text-text-tertiary"
            />
          </div>
          <div className="space-y-1.5">
            {data.churnedByYear
              .filter(row => row.year > 0)
              .slice(0, 5)
              .map((row) => (
                <div key={row.year} className="flex items-center justify-between py-1 border-b border-border/10 last:border-0">
                  <span className="text-xs font-medium text-text-secondary tabular-nums">{row.year}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-text-primary tabular-nums">{row.count}</span>
                    <span className="text-[10px] text-red-400/70 tabular-nums w-12 text-right">{row.churnRate}%</span>
                  </div>
                </div>
              ))}
          </div>
          <div className="mt-2 pt-2 border-t border-border/20 text-[10px] text-text-muted">
            {formatCurrency(metrics.lostRevenue)} lifetime revenue lost
          </div>
        </div>

        {/* Churn/Dud Trend - takes 2 columns */}
        <div className="lg:col-span-2">
          <ChurnDudTrendChart churnData={data.churnedByYear} dudData={data.dudRateByCohort || []} compact />
        </div>
      </div>

      {/* === B2B GROWTH (Line Chart) === */}
      <B2BGrowthChart
        customersByHealth={wholesaleData?.customersByHealth}
        totalFromDoorHealth={metrics.totalB2BCustomers}
      />

      {/* === DRILL-DOWN TABLE === */}
      <DrillDownTable
        data={data}
        customers={data.customers}
        mode={groupByMode}
        onModeChange={setGroupByMode}
      />

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
