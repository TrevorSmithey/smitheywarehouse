"use client";

import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  LabelList,
  ReferenceLine,
  CartesianGrid,
} from "recharts";
import { useDashboard } from "../layout";

// ============================================================================
// TYPES
// ============================================================================

interface CategoryData {
  web: number;
  wholesale: number;
  total: number;
}

interface MonthlyData {
  month: string;
  monthNum: number;
  web: number;
  wholesale: number;
  total: number;
  byCategory: Record<string, CategoryData>;
}

interface MonthComparison {
  category: string;
  current: number;
  prior: number;
  yoyPercent: number;
  currentWeb?: number;
  currentWholesale?: number;
  priorWeb?: number;
  priorWholesale?: number;
}

interface AggregateComparison {
  current: CategoryData | number;
  prior: CategoryData | number;
  yoyPercent: number;
}

interface YtdClosedData {
  throughMonth: number;
  throughMonthName: string;
  current: { web: number; wholesale: number; total: number; byCategory: Record<string, CategoryData> };
  prior: { web: number; wholesale: number; total: number; byCategory: Record<string, CategoryData> };
  comparison: MonthComparison[];
  cookware: AggregateComparison;
  grossRevenue: { current: number; prior: number; yoyPercent: number };
  discounts: { current: number; prior: number; yoyPercent: number };
  netRevenue: { current: number; prior: number; yoyPercent: number };
}

interface PLData {
  year: number;
  priorYear: number;
  monthly: MonthlyData[];
  priorMonthly: MonthlyData[];
  cumulativeYtd: { month: string; monthNum: number; current: number; prior: number }[];
  ytd: { web: number; wholesale: number; total: number; byCategory: Record<string, CategoryData> };
  priorYtd: { web: number; wholesale: number; total: number; byCategory: Record<string, CategoryData> };
  lastMonth: {
    month: string;
    monthNum: number;
    data: MonthlyData | null;
    priorData: MonthlyData | null;
    comparison: MonthComparison[];
    cookware: AggregateComparison;
    grossRevenue: { current: number; prior: number; yoyPercent: number };
    discounts: { current: number; prior: number; yoyPercent: number };
    netRevenue: { current: number; prior: number; yoyPercent: number };
  };
  ytdSummary: {
    comparison: MonthComparison[];
    cookware: AggregateComparison;
    grossRevenue: { current: number; prior: number; yoyPercent: number };
    discounts: { current: number; prior: number; yoyPercent: number };
    netRevenue: { current: number; prior: number; yoyPercent: number };
  };
  ytdClosed: YtdClosedData | null;
  categories: string[];
  lastSync: string | null;
}

// ============================================================================
// DESIGN CONSTANTS
// ============================================================================

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const colors = {
  // Fathom-style colors
  current: "#22C55E",       // Green - current year
  currentLight: "#86EFAC",
  prior: "#9CA3AF",         // Gray - prior year
  priorLight: "#D1D5DB",

  // Category colors - high contrast, easily distinguishable
  castIron: "#3B82F6",      // Blue - primary product
  carbonSteel: "#F97316",   // Orange - warm contrast to blue
  accessories: "#A855F7",   // Purple - cool but distinct
  services: "#14B8A6",      // Teal - seafoam green

  // Channel colors
  web: "#3B82F6",           // Blue
  wholesale: "#F97316",     // Orange

  // Status
  positive: "#22C55E",
  negative: "#EF4444",
  neutral: "#6B7280",
};

// ============================================================================
// FORMATTERS
// ============================================================================

const fmt = {
  currency: (n: number) => {
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n.toFixed(0)}`;
  },
  currencyFull: (n: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n);
  },
  currencyParens: (n: number) => {
    if (n < 0) return `(${fmt.currencyFull(Math.abs(n))})`;
    return fmt.currencyFull(n);
  },
  percent: (n: number) => `${n.toFixed(2)}%`,
  percentChange: (n: number) => {
    const sign = n >= 0 ? "" : "";
    return `${sign}${n.toFixed(2)}%`;
  },
};

// ============================================================================
// CUSTOM CHART COMPONENTS
// ============================================================================

// Large donut chart with center label
function LargeDonutChart({
  data,
  title,
  centerLabel,
  centerValue,
}: {
  data: { name: string; value: number; color: string }[];
  title: string;
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) return null;

  const filteredData = data.filter(d => d.value > 0);

  // Calculate percentages for labels
  const dataWithPercent = filteredData.map(d => ({
    ...d,
    percent: ((d.value / total) * 100).toFixed(1),
  }));

  return (
    <div className="flex flex-col items-center">
      <h3 className="text-sm font-medium text-text-secondary mb-4">{title}</h3>
      <div className="relative [&_svg]:outline-none [&_*:focus]:outline-none" style={{ width: 200, height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={dataWithPercent}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={85}
              paddingAngle={2}
              dataKey="value"
              stroke="none"
            >
              {dataWithPercent.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {/* Center label */}
        {centerLabel && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold text-text-primary">{centerValue}</span>
            <span className="text-xs text-text-tertiary">{centerLabel}</span>
          </div>
        )}
      </div>
      {/* Legend with percentages */}
      <div className="mt-4 space-y-2">
        {dataWithPercent.map((d) => (
          <div key={d.name} className="flex items-center justify-between gap-4 min-w-[180px]">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: d.color }} />
              <span className="text-sm text-text-secondary">{d.name}</span>
            </div>
            <span className="text-sm font-semibold text-text-primary tabular-nums">{d.percent}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Compact currency formatter for chart labels
const compactCurrency = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};

// Smart staggered label renderer - shows all months with alternating positions
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const StaggeredMonthLabel = (props: any) => {
  const { x = 0, y = 0, value = 0, index = 0, fill = "#22C55E" } = props;

  if (!value || value === 0) return null;

  // Stagger: even indices above, odd indices below - creates zigzag pattern
  const isAbove = index % 2 === 0;
  const yOffset = isAbove ? -16 : 24;

  return (
    <text
      x={x}
      y={y + yOffset}
      fill={fill}
      textAnchor="middle"
      fontSize={11}
      fontWeight={600}
      style={{ textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}
    >
      {compactCurrency(value)}
    </text>
  );
};

// Category breakdown line chart - shows Cast Iron, Carbon Steel, etc. over time
function CategoryTrendChart({
  data,
  year,
  throughMonth,
}: {
  data: { month: string; castIron: number; carbonSteel: number; accessories: number; services: number }[];
  year: number;
  throughMonth?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-text-secondary">
          Revenue by Category {throughMonth ? `(Jan-${throughMonth})` : ""}
        </h3>
        <div className="flex items-center gap-4 text-xs flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: colors.castIron }} />
            <span className="text-text-secondary">Cast Iron</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: colors.carbonSteel }} />
            <span className="text-text-secondary">Carbon Steel</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: colors.accessories }} />
            <span className="text-text-secondary">Accessories</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: colors.services }} />
            <span className="text-text-secondary">Services</span>
          </div>
        </div>
      </div>
      <div className="h-80 [&_svg]:outline-none [&_*:focus]:outline-none">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 20, right: 20, left: 5, bottom: 10 }}>
            <XAxis
              dataKey="month"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#6B7280", fontSize: 10 }}
              dy={8}
              interval={0}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#6B7280", fontSize: 10 }}
              tickFormatter={(v) => compactCurrency(v)}
              width={50}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1F2937",
                border: "1px solid #374151",
                borderRadius: "8px",
                padding: "12px 16px",
              }}
              labelStyle={{ color: "#9CA3AF", marginBottom: "8px", fontWeight: 600 }}
              formatter={(value: number, name: string) => {
                const labels: Record<string, string> = {
                  castIron: "Cast Iron",
                  carbonSteel: "Carbon Steel",
                  accessories: "Accessories",
                  services: "Services",
                };
                return [fmt.currencyFull(value), labels[name] || name];
              }}
            />
            <Line
              type="monotone"
              dataKey="castIron"
              stroke={colors.castIron}
              strokeWidth={2.5}
              dot={{ fill: colors.castIron, strokeWidth: 0, r: 3 }}
              activeDot={{ r: 5, fill: colors.castIron }}
            />
            <Line
              type="monotone"
              dataKey="carbonSteel"
              stroke={colors.carbonSteel}
              strokeWidth={2.5}
              dot={{ fill: colors.carbonSteel, strokeWidth: 0, r: 3 }}
              activeDot={{ r: 5, fill: colors.carbonSteel }}
            />
            <Line
              type="monotone"
              dataKey="accessories"
              stroke={colors.accessories}
              strokeWidth={2}
              dot={{ fill: colors.accessories, strokeWidth: 0, r: 2 }}
              activeDot={{ r: 4, fill: colors.accessories }}
            />
            <Line
              type="monotone"
              dataKey="services"
              stroke={colors.services}
              strokeWidth={2}
              dot={{ fill: colors.services, strokeWidth: 0, r: 2 }}
              activeDot={{ r: 4, fill: colors.services }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// Cumulative YTD line chart - shows both years with staggered labels
function CumulativeLineChart({
  data,
  currentYear,
  priorYear,
}: {
  data: { month: string; current: number; prior: number }[];
  currentYear: number;
  priorYear: number;
}) {
  const dataLength = data.length;

  // Cumulative chart label - only show on key months (quarterly + end)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CumulativeLabel = (props: any) => {
    const { x = 0, y = 0, value = 0, index = 0, fill = "#fff", position = "top" } = props;

    // Show labels on: Q1 end (Mar), Q2 end (Jun), Q3 end (Sep), Q4/Year end (Dec)
    // That's indices 2, 5, 8, 11 for a full year
    const quarterEnds = [2, 5, 8, 11];
    const isQuarterEnd = quarterEnds.includes(index);
    const isLast = index === dataLength - 1;

    if (!isQuarterEnd && !isLast) return null;
    if (!value || value === 0) return null;

    const yOffset = position === "top" ? -14 : 22;

    return (
      <text
        x={x}
        y={y + yOffset}
        fill={fill}
        textAnchor="middle"
        fontSize={11}
        fontWeight={600}
        style={{ textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}
      >
        {compactCurrency(value)}
      </text>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-text-secondary">Cumulative Revenue YTD</h3>
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-4 h-0.5 rounded" style={{ backgroundColor: colors.current }} />
            <span className="text-text-secondary">{currentYear}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-0.5 rounded border-t border-dashed" style={{ borderColor: colors.prior }} />
            <span className="text-text-secondary">{priorYear}</span>
          </div>
        </div>
      </div>
      <div className="h-80 [&_svg]:outline-none [&_*:focus]:outline-none">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 35, right: 20, left: 5, bottom: 10 }}>
            <XAxis
              dataKey="month"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#6B7280", fontSize: 10 }}
              dy={8}
              interval={0}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#6B7280", fontSize: 10 }}
              tickFormatter={(v) => compactCurrency(v)}
              width={50}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length < 2) return null;
                const current = payload.find((p) => p.dataKey === "current")?.value as number || 0;
                const prior = payload.find((p) => p.dataKey === "prior")?.value as number || 0;
                const yoyChange = prior > 0 ? ((current - prior) / prior) * 100 : 0;
                return (
                  <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 shadow-xl">
                    <div className="text-gray-400 font-semibold mb-3">{label}</div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-6">
                        <span className="text-emerald-400 font-medium">{currentYear} YTD:</span>
                        <span className="text-white font-bold">{fmt.currencyFull(current)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-6">
                        <span className="text-gray-400">{priorYear} YTD:</span>
                        <span className="text-gray-300">{fmt.currencyFull(prior)}</span>
                      </div>
                      <div className="pt-2 mt-2 border-t border-gray-700">
                        <div className={`text-sm font-bold ${yoyChange >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {yoyChange >= 0 ? "+" : ""}{yoyChange.toFixed(1)}% YoY
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }}
            />
            {/* Prior year - dashed gray line with quarterly labels */}
            <Line
              type="monotone"
              dataKey="prior"
              stroke={colors.prior}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={{ fill: colors.prior, strokeWidth: 0, r: 2 }}
              activeDot={{ r: 4, fill: colors.prior }}
            >
              <LabelList
                dataKey="prior"
                content={(props) => <CumulativeLabel {...props} fill="#9CA3AF" position="bottom" />}
              />
            </Line>
            {/* Current year - solid green line with quarterly labels */}
            <Line
              type="monotone"
              dataKey="current"
              stroke={colors.current}
              strokeWidth={2.5}
              dot={{ fill: colors.current, strokeWidth: 0, r: 3 }}
              activeDot={{ r: 5, fill: colors.current }}
            >
              <LabelList
                dataKey="current"
                content={(props) => <CumulativeLabel {...props} fill="#22C55E" position="top" />}
              />
            </Line>
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ============================================================================
// TABLE COMPONENTS (Fathom-style clean tables)
// ============================================================================

function RevenueTable({
  title,
  priorLabel,
  currentLabel,
  rows,
}: {
  title: string;
  priorLabel: string;
  currentLabel: string;
  rows: { label: string; prior: number; current: number; yoy: number; bold?: boolean; negative?: boolean }[];
}) {
  return (
    <div className="bg-bg-secondary rounded-xl border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="py-3 px-4 text-left font-medium text-text-secondary">{title}</th>
            <th className="py-3 px-4 text-right font-medium text-text-tertiary">{priorLabel}</th>
            <th className="py-3 px-4 text-right font-medium text-text-tertiary">{currentLabel}</th>
            <th className="py-3 px-4 text-right font-medium text-text-tertiary">YoY %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={row.label}
              className={`border-b border-border/50 ${row.bold ? "bg-bg-tertiary/20" : ""}`}
            >
              <td className={`py-2.5 px-4 ${row.bold ? "font-semibold text-text-primary" : "text-text-secondary"}`}>
                {row.label}
              </td>
              <td className="py-2.5 px-4 text-right tabular-nums text-text-tertiary">
                {row.negative ? fmt.currencyParens(row.prior) : fmt.currencyFull(row.prior)}
              </td>
              <td className={`py-2.5 px-4 text-right tabular-nums ${row.bold ? "font-semibold text-text-primary" : "text-text-secondary"}`}>
                {row.negative ? fmt.currencyParens(row.current) : fmt.currencyFull(row.current)}
              </td>
              <td className="py-2.5 px-4 text-right tabular-nums" style={{
                color: row.negative
                  ? (row.yoy > 0 ? colors.negative : row.yoy < 0 ? colors.positive : colors.neutral)
                  : (row.yoy > 0 ? colors.positive : row.yoy < 0 ? colors.negative : colors.neutral)
              }}>
                {fmt.percentChange(row.yoy)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function PLPage() {
  const { triggerRefresh } = useDashboard();
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<PLData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/pl?year=${year}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error("Failed to fetch P&L data:", err);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSync = async () => {
    setLoading(true);
    try {
      await fetch(`/api/cron/sync-netsuite-pl?year=${year}`, {
        headers: { Authorization: `Bearer ${process.env.NEXT_PUBLIC_CRON_SECRET}` },
      });
      await fetchData();
      triggerRefresh?.();
    } catch (err) {
      console.error("Sync failed:", err);
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="w-8 h-8 animate-spin text-accent-blue" />
          <span className="text-sm text-text-tertiary tracking-wide">Loading financial data...</span>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <span className="text-text-tertiary">No P&L data available</span>
        <button onClick={fetchData} className="px-4 py-2 text-sm bg-accent-blue rounded hover:bg-accent-blue/80">
          Refresh
        </button>
      </div>
    );
  }

  // ============================================================================
  // DATA PREPARATION
  // ============================================================================

  // Use CLOSED period for financial comparisons, not current month
  // If ytdClosed is null (January of current year or no data), use current month - 1
  const currentCalendarMonth = new Date().getMonth() + 1;
  const closedThroughMonth = data.ytdClosed?.throughMonth || Math.max(currentCalendarMonth - 1, 0);
  const closedMonthName = data.ytdClosed?.throughMonthName ||
    (closedThroughMonth > 0 ? ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][closedThroughMonth - 1] : "");

  // Monthly chart data - EXCLUDE current month, show only closed period
  const monthlyChartData = MONTHS_SHORT.slice(0, closedThroughMonth).map((m, i) => {
    const monthNum = i + 1;
    const currentMonth = data.monthly.find((d) => d.monthNum === monthNum);
    const priorMonth = data.priorMonthly.find((d) => d.monthNum === monthNum);
    return {
      month: `${m} ${String(year).slice(2)}`,
      current: currentMonth?.total || 0,
      prior: priorMonth?.total || 0,
    };
  }).filter((d) => d.current > 0 || d.prior > 0);

  // Cumulative chart data - EXCLUDE current month
  const cumulativeChartData = data.cumulativeYtd
    .filter((d) => d.monthNum <= closedThroughMonth)
    .map((d) => ({
      month: `${MONTHS_SHORT[d.monthNum - 1]} ${String(year).slice(2)}`,
      current: d.current,
      prior: d.prior,
    }));

  // YTD Revenue mix (CLOSED PERIOD - excludes current month)
  // Shows main product categories only - percentages shown, no dollar value in center
  const ytdRevenueMix = [
    { name: "Cast Iron", value: data.ytdClosed?.comparison.find(c => c.category === "Cast Iron")?.current || 0, color: colors.castIron },
    { name: "Carbon Steel", value: data.ytdClosed?.comparison.find(c => c.category === "Carbon Steel")?.current || 0, color: colors.carbonSteel },
    { name: "Accessories", value: data.ytdClosed?.comparison.find(c => c.category === "Accessories")?.current || 0, color: colors.accessories },
    { name: "Services", value: data.ytdClosed?.comparison.find(c => c.category === "Services")?.current || 0, color: colors.services },
  ].filter(d => d.value > 0);

  // Category trend data - for revenue by category over time chart
  // Exclude current month (show only closed period through prior month)
  const categoryTrendData = MONTHS_SHORT.slice(0, closedThroughMonth).map((m, i) => {
    const monthNum = i + 1;
    const currentMonth = data.monthly.find((d) => d.monthNum === monthNum);
    const byCategory = currentMonth?.byCategory || {};

    return {
      month: m,
      castIron: byCategory["Cast Iron"]?.total || 0,
      carbonSteel: byCategory["Carbon Steel"]?.total || 0,
      accessories: byCategory["Accessories"]?.total || 0,
      services: byCategory["Services"]?.total || 0,
    };
  }).filter((d) => d.castIron > 0 || d.carbonSteel > 0 || d.accessories > 0 || d.services > 0);

  // Discount Rate data - discount as % of gross revenue by month
  const discountRateData = MONTHS_SHORT.slice(0, closedThroughMonth).map((m, i) => {
    const monthNum = i + 1;
    const currentMonth = data.monthly.find((d) => d.monthNum === monthNum);
    const priorMonth = data.priorMonthly.find((d) => d.monthNum === monthNum);
    const currentByCategory = currentMonth?.byCategory || {};
    const priorByCategory = priorMonth?.byCategory || {};

    // Calculate gross revenue (total - discounts since discounts are negative)
    const currentGross = (currentMonth?.total || 0) - (currentByCategory["Discounts"]?.total || 0);
    const priorGross = (priorMonth?.total || 0) - (priorByCategory["Discounts"]?.total || 0);

    // Discount rate as positive % (discounts are stored as negative)
    const currentDiscountRate = currentGross > 0 ? (Math.abs(currentByCategory["Discounts"]?.total || 0) / currentGross) * 100 : 0;
    const priorDiscountRate = priorGross > 0 ? (Math.abs(priorByCategory["Discounts"]?.total || 0) / priorGross) * 100 : 0;

    return {
      month: m,
      current: currentDiscountRate,
      prior: priorDiscountRate,
      currentAbs: Math.abs(currentByCategory["Discounts"]?.total || 0),
      priorAbs: Math.abs(priorByCategory["Discounts"]?.total || 0),
    };
  }).filter((d) => d.current > 0 || d.prior > 0);

  // Shipping income data - stacked bar with web/wholesale breakdown + % of revenue by channel
  const shippingData = MONTHS_SHORT.slice(0, closedThroughMonth).map((m, i) => {
    const monthNum = i + 1;
    const currentMonth = data.monthly.find((d) => d.monthNum === monthNum);
    const priorMonth = data.priorMonthly.find((d) => d.monthNum === monthNum);
    const currentShipping = currentMonth?.byCategory["Shipping Income"] || { web: 0, wholesale: 0, total: 0 };
    const priorShipping = priorMonth?.byCategory["Shipping Income"] || { web: 0, wholesale: 0, total: 0 };

    // Calculate shipping % by channel (shipping revenue / channel gross revenue)
    const webGross = currentMonth?.web || 0;
    const wholesaleGross = currentMonth?.wholesale || 0;
    const webShippingPct = webGross > 0 ? (currentShipping.web / webGross) * 100 : 0;
    const wholesaleShippingPct = wholesaleGross > 0 ? (currentShipping.wholesale / wholesaleGross) * 100 : 0;

    // Prior year by channel
    const priorWebGross = priorMonth?.web || 0;
    const priorWholesaleGross = priorMonth?.wholesale || 0;
    const priorWebShippingPct = priorWebGross > 0 ? (priorShipping.web / priorWebGross) * 100 : 0;
    const priorWholesaleShippingPct = priorWholesaleGross > 0 ? (priorShipping.wholesale / priorWholesaleGross) * 100 : 0;

    return {
      month: m,
      web: currentShipping.web,
      wholesale: currentShipping.wholesale,
      total: currentShipping.total,
      priorTotal: priorShipping.total,
      webShippingPct,
      wholesaleShippingPct,
      priorWebShippingPct,
      priorWholesaleShippingPct,
    };
  }).filter((d) => d.total > 0 || d.priorTotal > 0);

  // Table rows for YTD (CLOSED PERIOD Jan-Nov - excludes current month)
  const closedData = data.ytdClosed;

  // Calculate YTD discount rate for summary
  const ytdDiscountRate = closedData ?
    (Math.abs(closedData.discounts.current) / closedData.grossRevenue.current) * 100 : 0;
  const priorYtdDiscountRate = closedData ?
    (Math.abs(closedData.discounts.prior) / closedData.grossRevenue.prior) * 100 : 0;
  const ytdTableRows = closedData ? [
    ...closedData.comparison.slice(0, 3).map(c => ({
      label: c.category,
      prior: c.prior,
      current: c.current,
      yoy: c.yoyPercent,
    })),
    {
      label: "Cookware",
      prior: typeof closedData.cookware.prior === "number" ? closedData.cookware.prior : (closedData.cookware.prior as CategoryData).total,
      current: typeof closedData.cookware.current === "number" ? closedData.cookware.current : (closedData.cookware.current as CategoryData).total,
      yoy: closedData.cookware.yoyPercent,
      bold: true,
    },
    ...closedData.comparison.slice(3).filter(c => c.current > 0 || c.prior > 0).map(c => ({
      label: c.category,
      prior: c.prior,
      current: c.current,
      yoy: c.yoyPercent,
    })),
    {
      label: "Gross Revenue",
      prior: closedData.grossRevenue.prior,
      current: closedData.grossRevenue.current,
      yoy: closedData.grossRevenue.yoyPercent,
      bold: true,
    },
    {
      label: "Discounts",
      prior: closedData.discounts.prior,
      current: closedData.discounts.current,
      yoy: closedData.discounts.yoyPercent,
      negative: true,
    },
    {
      label: "Revenue",
      prior: closedData.netRevenue.prior,
      current: closedData.netRevenue.current,
      yoy: closedData.netRevenue.yoyPercent,
      bold: true,
    },
  ] : [];

  // Helper to calculate YoY
  const calcYoy = (prior: number, current: number) => prior > 0 ? ((current - prior) / prior) * 100 : 0;

  return (
    <div className="space-y-12 pb-12">
      {/* ================================================================== */}
      {/* HEADER */}
      {/* ================================================================== */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">Sales: Monthly Report</h1>
          <p className="text-sm text-text-tertiary mt-1">Smithey Ironware Company • {year}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Year selector */}
          <div className="flex items-center gap-1 bg-bg-tertiary/50 rounded-lg p-1 border border-border/40">
            <button
              onClick={() => setYear(year - 1)}
              className="p-2 hover:bg-bg-tertiary rounded transition-colors disabled:opacity-30"
              disabled={year <= 2019}
            >
              <ChevronLeft className="w-4 h-4 text-text-tertiary" />
            </button>
            <span className="px-4 py-1.5 text-sm font-semibold text-text-primary tabular-nums">{year}</span>
            <button
              onClick={() => setYear(year + 1)}
              className="p-2 hover:bg-bg-tertiary rounded transition-colors disabled:opacity-30"
              disabled={year >= new Date().getFullYear()}
            >
              <ChevronRight className="w-4 h-4 text-text-tertiary" />
            </button>
          </div>
          <button
            onClick={handleSync}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-bg-secondary hover:bg-bg-tertiary rounded-lg border border-border transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Sync
          </button>
        </div>
      </div>

      {/* ================================================================== */}
      {/* HERO METRICS - Executive Summary */}
      {/* ================================================================== */}
      {(() => {
        // Calculate QTD (quarter to date) metrics
        const getQuarter = (month: number) => Math.ceil(month / 3);
        const currentQuarter = getQuarter(closedThroughMonth);
        const quarterStartMonth = (currentQuarter - 1) * 3 + 1;
        const quarterNames = ["Q1", "Q2", "Q3", "Q4"];
        const quarterName = quarterNames[currentQuarter - 1];

        let qtdCurrent = 0;
        let qtdPrior = 0;
        for (let m = quarterStartMonth; m <= closedThroughMonth; m++) {
          const currentMonth = data.monthly.find((d) => d.monthNum === m);
          const priorMonth = data.priorMonthly.find((d) => d.monthNum === m);
          qtdCurrent += currentMonth?.total || 0;
          qtdPrior += priorMonth?.total || 0;
        }
        const qtdYoY = qtdPrior > 0 ? ((qtdCurrent - qtdPrior) / qtdPrior) * 100 : 0;

        // Last month metrics
        const lastMonthData = data.monthly.find((d) => d.monthNum === closedThroughMonth);
        const priorLastMonthData = data.priorMonthly.find((d) => d.monthNum === closedThroughMonth);
        const lastMonthRevenue = lastMonthData?.total || 0;
        const priorLastMonthRevenue = priorLastMonthData?.total || 0;
        const lastMonthYoY = priorLastMonthRevenue > 0 ? ((lastMonthRevenue - priorLastMonthRevenue) / priorLastMonthRevenue) * 100 : 0;

        // Channel YoY by month - for the growth trend chart
        const channelGrowthData = MONTHS_SHORT.slice(0, closedThroughMonth).map((m, i) => {
          const monthNum = i + 1;
          const currentMonth = data.monthly.find((d) => d.monthNum === monthNum);
          const priorMonth = data.priorMonthly.find((d) => d.monthNum === monthNum);

          const webCurrent = currentMonth?.web || 0;
          const webPrior = priorMonth?.web || 0;
          const webYoY = webPrior > 0 ? ((webCurrent - webPrior) / webPrior) * 100 : 0;

          const wholesaleCurrent = currentMonth?.wholesale || 0;
          const wholesalePrior = priorMonth?.wholesale || 0;
          const wholesaleYoY = wholesalePrior > 0 ? ((wholesaleCurrent - wholesalePrior) / wholesalePrior) * 100 : 0;

          // Combined/Total YoY
          const totalCurrent = (currentMonth?.total || 0);
          const totalPrior = (priorMonth?.total || 0);
          const totalYoY = totalPrior > 0 ? ((totalCurrent - totalPrior) / totalPrior) * 100 : 0;

          return {
            month: m,
            combined: totalYoY,
            web: webYoY,
            wholesale: wholesaleYoY,
            totalCurrent,
            totalPrior,
            webCurrent,
            webPrior,
            wholesaleCurrent,
            wholesalePrior,
          };
        }).filter((d) => d.totalCurrent > 0 || d.totalPrior > 0);

        // YTD totals for the summary
        const totalYtdYoY = data.ytdClosed?.netRevenue.yoyPercent || 0;

        const webYtdCurrent = data.ytdClosed?.current?.web || 0;
        const webYtdPrior = data.ytdClosed?.prior?.web || 0;
        const webYtdYoY = webYtdPrior > 0 ? ((webYtdCurrent - webYtdPrior) / webYtdPrior) * 100 : 0;

        const wholesaleYtdCurrent = data.ytdClosed?.current?.wholesale || 0;
        const wholesaleYtdPrior = data.ytdClosed?.prior?.wholesale || 0;
        const wholesaleYtdYoY = wholesaleYtdPrior > 0 ? ((wholesaleYtdCurrent - wholesaleYtdPrior) / wholesaleYtdPrior) * 100 : 0;

        const quarterMonths = MONTHS_SHORT.slice(quarterStartMonth - 1, closedThroughMonth).join("-");

        return (
          <section className="space-y-6">
            {/* Row 1: Key Period Metrics */}
            <div className="grid grid-cols-3 gap-4">
              {/* YTD Revenue - Hero */}
              <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 rounded-2xl p-5 border border-emerald-500/20">
                <div className="text-xs font-medium text-emerald-400/80 uppercase tracking-wider mb-1">
                  Net Revenue YTD
                </div>
                <div className="text-3xl font-black text-white tracking-tight">
                  {fmt.currency(data.ytdClosed?.netRevenue.current || 0)}
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-emerald-400/60">Jan–{closedMonthName}</span>
                  <span className={`text-sm font-bold ${(data.ytdClosed?.netRevenue.yoyPercent || 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {(data.ytdClosed?.netRevenue.yoyPercent || 0) >= 0 ? "+" : ""}{(data.ytdClosed?.netRevenue.yoyPercent || 0).toFixed(1)}%
                  </span>
                </div>
              </div>

              {/* QTD */}
              <div className="bg-bg-secondary/80 rounded-2xl p-5 border border-border/50">
                <div className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1">
                  {quarterName} to Date
                </div>
                <div className="text-3xl font-bold text-white tracking-tight">
                  {fmt.currency(qtdCurrent)}
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-text-tertiary">{quarterMonths}</span>
                  <span className={`text-sm font-bold ${qtdYoY >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {qtdYoY >= 0 ? "+" : ""}{qtdYoY.toFixed(1)}%
                  </span>
                </div>
              </div>

              {/* Last Month */}
              <div className="bg-bg-secondary/80 rounded-2xl p-5 border border-border/50">
                <div className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1">
                  {closedMonthName} {year}
                </div>
                <div className="text-3xl font-bold text-white tracking-tight">
                  {fmt.currency(lastMonthRevenue)}
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-text-tertiary">vs {year - 1}</span>
                  <span className={`text-sm font-bold ${lastMonthYoY >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {lastMonthYoY >= 0 ? "+" : ""}{lastMonthYoY.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>

            {/* Row 2: Growth Story - Hero Chart + Channel Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Main Chart: Business Growth - The Hero */}
              <div className="lg:col-span-8 bg-bg-secondary rounded-2xl p-6 border border-border relative overflow-hidden">
                {/* Subtle gradient backdrop */}
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/[0.03] via-transparent to-transparent pointer-events-none" />

                <div className="relative">
                  <div className="flex items-baseline gap-3 mb-1">
                    <h3 className="text-sm font-medium text-text-tertiary uppercase tracking-wider">Growth Rate</h3>
                    <span className={`text-2xl font-black tracking-tight ${totalYtdYoY >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {totalYtdYoY >= 0 ? "+" : ""}{totalYtdYoY.toFixed(1)}%
                    </span>
                    <span className="text-xs text-text-tertiary">YTD vs {year - 1}</span>
                  </div>
                  <p className="text-xs text-text-tertiary/70 mb-4">Monthly YoY change — total business</p>

                  <div className="h-44 [&_svg]:outline-none [&_*:focus]:outline-none">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={channelGrowthData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                        <defs>
                          <linearGradient id="growthGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#22C55E" stopOpacity={0.25} />
                            <stop offset="50%" stopColor="#22C55E" stopOpacity={0.08} />
                            <stop offset="100%" stopColor="#22C55E" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis
                          dataKey="month"
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: "#6B7280", fontSize: 10 }}
                          dy={5}
                        />
                        <YAxis
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: "#4B5563", fontSize: 9 }}
                          tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v}%`}
                          width={42}
                          domain={[-20, 60]}
                          ticks={[-20, 0, 20, 40, 60]}
                        />
                        <ReferenceLine y={0} stroke="#374151" strokeWidth={1} />
                        <Tooltip
                          content={({ active, payload, label }) => {
                            if (!active || !payload || payload.length < 1) return null;
                            const val = payload[0]?.value as number;
                            const isNegative = val < 0;
                            return (
                              <div className={`bg-gray-900/95 backdrop-blur rounded-lg px-3 py-2 shadow-xl border ${isNegative ? "border-red-500/40" : "border-emerald-500/20"}`}>
                                <div className="flex items-center gap-1.5 mb-0.5">
                                  <div className={`w-1.5 h-1.5 rounded-full ${isNegative ? "bg-red-400" : "bg-emerald-400"}`} />
                                  <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label} {year}</span>
                                </div>
                                <div className={`text-lg font-bold ${isNegative ? "text-red-400" : "text-emerald-400"}`}>
                                  {val >= 0 ? "+" : ""}{val?.toFixed(1)}%
                                </div>
                              </div>
                            );
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="combined"
                          stroke="#22C55E"
                          strokeWidth={2.5}
                          fill="url(#growthGradient)"
                          dot={{ fill: "#22C55E", strokeWidth: 0, r: 3 }}
                          activeDot={{ r: 5, fill: "#22C55E", stroke: "#fff", strokeWidth: 2 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Channel Cards - Supporting Context */}
              <div className="lg:col-span-4 grid grid-cols-2 lg:grid-cols-1 gap-4">
                {/* Web Channel */}
                {(() => {
                  const firstWebYoY = channelGrowthData[0]?.web || 0;
                  const lastWebYoY = channelGrowthData[channelGrowthData.length - 1]?.web || 0;
                  const firstMonth = channelGrowthData[0]?.month || "";
                  const lastMonth = channelGrowthData[channelGrowthData.length - 1]?.month || "";
                  return (
                    <div className="bg-bg-secondary rounded-2xl p-5 border border-border relative overflow-hidden group">
                      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/[0.04] via-transparent to-transparent pointer-events-none" />
                      <div className="relative">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                            <span className="text-xs font-medium text-text-tertiary uppercase tracking-wider">Web</span>
                          </div>
                          <span className={`text-lg font-bold ${webYtdYoY >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {webYtdYoY >= 0 ? "+" : ""}{webYtdYoY.toFixed(0)}%
                          </span>
                        </div>
                        {/* Sparkline with month context */}
                        <div className="relative">
                          <div className="h-14 [&_svg]:outline-none [&_*:focus]:outline-none">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={channelGrowthData} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                                <defs>
                                  <linearGradient id="webSparkGradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.3} />
                                    <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
                                  </linearGradient>
                                </defs>
                                <XAxis dataKey="month" hide />
                                <Tooltip
                                  content={({ active, payload }) => {
                                    if (!active || !payload?.[0]) return null;
                                    const data = payload[0].payload;
                                    const yoy = data.web;
                                    const isNegative = yoy < 0;
                                    return (
                                      <div className={`bg-bg-primary/95 backdrop-blur rounded-lg px-2.5 py-1.5 shadow-lg border ${isNegative ? "border-red-500/40" : "border-border"}`}>
                                        <div className="flex items-center gap-1">
                                          <div className={`w-1.5 h-1.5 rounded-full ${isNegative ? "bg-red-400" : "bg-emerald-400"}`} />
                                          <span className="text-[10px] text-text-tertiary font-medium">{data.month}</span>
                                        </div>
                                        <div className={`text-sm font-bold ${isNegative ? "text-red-400" : "text-emerald-400"}`}>
                                          {yoy >= 0 ? "+" : ""}{yoy.toFixed(1)}%
                                        </div>
                                      </div>
                                    );
                                  }}
                                />
                                <ReferenceLine y={0} stroke="#374151" strokeWidth={0.5} />
                                <Area
                                  type="monotone"
                                  dataKey="web"
                                  stroke="#3B82F6"
                                  strokeWidth={1.5}
                                  fill="url(#webSparkGradient)"
                                  dot={false}
                                  activeDot={{ r: 3, fill: "#3B82F6", stroke: "#fff", strokeWidth: 1 }}
                                />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                          {/* Month labels with YoY % */}
                          <div className="flex items-center justify-between text-[9px] mt-1">
                            <div className="flex flex-col items-start">
                              <span className="text-text-tertiary">{firstMonth}</span>
                              <span className={`font-medium ${firstWebYoY >= 0 ? "text-emerald-400/70" : "text-red-400/70"}`}>
                                {firstWebYoY >= 0 ? "+" : ""}{firstWebYoY.toFixed(0)}%
                              </span>
                            </div>
                            <div className="flex flex-col items-end">
                              <span className="text-text-tertiary">{lastMonth}</span>
                              <span className={`font-medium ${lastWebYoY >= 0 ? "text-emerald-400/70" : "text-red-400/70"}`}>
                                {lastWebYoY >= 0 ? "+" : ""}{lastWebYoY.toFixed(0)}%
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
                          <span className="text-[10px] text-text-tertiary">YTD Revenue</span>
                          <span className="text-xs font-semibold text-blue-400">{fmt.currency(webYtdCurrent)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Wholesale Channel */}
                {(() => {
                  const firstWholesaleYoY = channelGrowthData[0]?.wholesale || 0;
                  const lastWholesaleYoY = channelGrowthData[channelGrowthData.length - 1]?.wholesale || 0;
                  const firstMonth = channelGrowthData[0]?.month || "";
                  const lastMonth = channelGrowthData[channelGrowthData.length - 1]?.month || "";
                  return (
                    <div className="bg-bg-secondary rounded-2xl p-5 border border-border relative overflow-hidden group">
                      <div className="absolute inset-0 bg-gradient-to-br from-orange-500/[0.04] via-transparent to-transparent pointer-events-none" />
                      <div className="relative">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                            <span className="text-xs font-medium text-text-tertiary uppercase tracking-wider">Wholesale</span>
                          </div>
                          <span className={`text-lg font-bold ${wholesaleYtdYoY >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {wholesaleYtdYoY >= 0 ? "+" : ""}{wholesaleYtdYoY.toFixed(0)}%
                          </span>
                        </div>
                        {/* Sparkline with month context */}
                        <div className="relative">
                          <div className="h-14 [&_svg]:outline-none [&_*:focus]:outline-none">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={channelGrowthData} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                                <defs>
                                  <linearGradient id="wholesaleSparkGradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#F97316" stopOpacity={0.3} />
                                    <stop offset="100%" stopColor="#F97316" stopOpacity={0} />
                                  </linearGradient>
                                </defs>
                                <XAxis dataKey="month" hide />
                                <Tooltip
                                  content={({ active, payload }) => {
                                    if (!active || !payload?.[0]) return null;
                                    const data = payload[0].payload;
                                    const yoy = data.wholesale;
                                    const isNegative = yoy < 0;
                                    return (
                                      <div className={`bg-bg-primary/95 backdrop-blur rounded-lg px-2.5 py-1.5 shadow-lg border ${isNegative ? "border-red-500/40" : "border-border"}`}>
                                        <div className="flex items-center gap-1">
                                          <div className={`w-1.5 h-1.5 rounded-full ${isNegative ? "bg-red-400" : "bg-emerald-400"}`} />
                                          <span className="text-[10px] text-text-tertiary font-medium">{data.month}</span>
                                        </div>
                                        <div className={`text-sm font-bold ${isNegative ? "text-red-400" : "text-emerald-400"}`}>
                                          {yoy >= 0 ? "+" : ""}{yoy.toFixed(1)}%
                                        </div>
                                      </div>
                                    );
                                  }}
                                />
                                <ReferenceLine y={0} stroke="#374151" strokeWidth={0.5} />
                                <Area
                                  type="monotone"
                                  dataKey="wholesale"
                                  stroke="#F97316"
                                  strokeWidth={1.5}
                                  fill="url(#wholesaleSparkGradient)"
                                  dot={false}
                                  activeDot={{ r: 3, fill: "#F97316", stroke: "#fff", strokeWidth: 1 }}
                                />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                          {/* Month labels with YoY % */}
                          <div className="flex items-center justify-between text-[9px] mt-1">
                            <div className="flex flex-col items-start">
                              <span className="text-text-tertiary">{firstMonth}</span>
                              <span className={`font-medium ${firstWholesaleYoY >= 0 ? "text-emerald-400/70" : "text-red-400/70"}`}>
                                {firstWholesaleYoY >= 0 ? "+" : ""}{firstWholesaleYoY.toFixed(0)}%
                              </span>
                            </div>
                            <div className="flex flex-col items-end">
                              <span className="text-text-tertiary">{lastMonth}</span>
                              <span className={`font-medium ${lastWholesaleYoY >= 0 ? "text-emerald-400/70" : "text-red-400/70"}`}>
                                {lastWholesaleYoY >= 0 ? "+" : ""}{lastWholesaleYoY.toFixed(0)}%
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
                          <span className="text-[10px] text-text-tertiary">YTD Revenue</span>
                          <span className="text-xs font-semibold text-orange-400">{fmt.currency(wholesaleYtdCurrent)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </section>
        );
      })()}

      {/* ================================================================== */}
      {/* MONTHLY PERFORMANCE - Area Chart (Closed Period Only) */}
      {/* ================================================================== */}
      <section>
        <h2 className="text-xl font-bold text-text-primary mb-6 pb-2 border-b border-border">
          Monthly Performance {year} (Jan-{closedMonthName})
        </h2>

        <div className="bg-bg-secondary rounded-2xl p-6 lg:p-8 border border-border">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold text-text-primary">Revenue by Month</h3>
              <p className="text-sm text-text-tertiary mt-1">Closed period comparison (excludes current month)</p>
            </div>
            <div className="flex items-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-emerald-500" />
                <span className="text-text-secondary font-medium">{year}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-gray-500/50 border border-gray-500" />
                <span className="text-text-tertiary">{year - 1}</span>
              </div>
            </div>
          </div>

          <div className="h-96 [&_svg]:outline-none [&_*:focus]:outline-none">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthlyChartData} margin={{ top: 30, right: 30, left: 0, bottom: 10 }}>
                <defs>
                  <linearGradient id="currentGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22C55E" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#22C55E" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="priorGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6B7280" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#6B7280" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#9CA3AF", fontSize: 12, fontWeight: 500 }}
                  dy={10}
                  interval={0}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#6B7280", fontSize: 11 }}
                  tickFormatter={(v) => compactCurrency(v)}
                  width={60}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload || payload.length < 2) return null;
                    const current = payload.find((p) => p.dataKey === "current")?.value as number || 0;
                    const prior = payload.find((p) => p.dataKey === "prior")?.value as number || 0;
                    const yoyChange = prior > 0 ? ((current - prior) / prior) * 100 : 0;
                    return (
                      <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 shadow-xl">
                        <div className="text-gray-400 font-semibold mb-3">{label}</div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-6">
                            <span className="text-emerald-400 font-medium">{year}:</span>
                            <span className="text-white font-bold">{fmt.currencyFull(current)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-6">
                            <span className="text-gray-400">{year - 1}:</span>
                            <span className="text-gray-300">{fmt.currencyFull(prior)}</span>
                          </div>
                          <div className="pt-2 mt-2 border-t border-gray-700">
                            <div className={`text-sm font-bold ${yoyChange >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                              {yoyChange >= 0 ? "+" : ""}{yoyChange.toFixed(1)}% YoY
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }}
                />
                {/* Prior year - subtle fill */}
                <Area
                  type="monotone"
                  dataKey="prior"
                  stroke="#6B7280"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  fill="url(#priorGradient)"
                  dot={false}
                />
                {/* Current year - prominent fill with labels */}
                <Area
                  type="monotone"
                  dataKey="current"
                  stroke="#22C55E"
                  strokeWidth={3}
                  fill="url(#currentGradient)"
                  dot={{ fill: "#22C55E", strokeWidth: 0, r: 4 }}
                  activeDot={{ r: 6, fill: "#22C55E", stroke: "#fff", strokeWidth: 2 }}
                >
                  <LabelList
                    dataKey="current"
                    content={(props) => <StaggeredMonthLabel {...props} fill="#22C55E" />}
                  />
                </Area>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* ================================================================== */}
      {/* REVENUE BY CATEGORY TREND (Closed Period) */}
      {/* ================================================================== */}
      <section>
        <h2 className="text-xl font-bold text-text-primary mb-6 pb-2 border-b border-border">
          Revenue by Category (Jan-{closedMonthName} {year})
        </h2>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left: Revenue Mix Pie (using closed period data) */}
          <div className="lg:col-span-3">
            <LargeDonutChart
              data={ytdRevenueMix}
              title="Product Mix"
              centerLabel={`Jan-${closedMonthName}`}
            />
          </div>

          {/* Right: Revenue by Category Trend (Closed Period) */}
          <div className="lg:col-span-9 bg-bg-secondary rounded-xl p-6 border border-border">
            <CategoryTrendChart
              data={categoryTrendData}
              year={year}
              throughMonth={closedMonthName}
            />
          </div>
        </div>
      </section>

      {/* ================================================================== */}
      {/* DISCOUNTS & SHIPPING HEALTH */}
      {/* ================================================================== */}
      <section>
        <h2 className="text-xl font-bold text-text-primary mb-6 pb-2 border-b border-border">
          Discounts & Shipping (Jan-{closedMonthName} {year})
        </h2>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-bg-secondary rounded-xl p-4 border border-border">
            <div className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1">Discount Rate YTD</div>
            <div className="text-2xl font-bold text-amber-400">{ytdDiscountRate.toFixed(1)}%</div>
            <div className={`text-xs font-medium ${ytdDiscountRate <= priorYtdDiscountRate ? "text-emerald-400" : "text-red-400"}`}>
              {ytdDiscountRate <= priorYtdDiscountRate ? "↓" : "↑"} vs {(priorYtdDiscountRate).toFixed(1)}% last year
            </div>
          </div>
          <div className="bg-bg-secondary rounded-xl p-4 border border-border">
            <div className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1">Total Discounts</div>
            <div className="text-2xl font-bold text-red-400">{fmt.currency(Math.abs(closedData?.discounts.current || 0))}</div>
            <div className={`text-xs font-medium ${(closedData?.discounts.yoyPercent || 0) <= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {(closedData?.discounts.yoyPercent || 0) > 0 ? "+" : ""}{(closedData?.discounts.yoyPercent || 0).toFixed(1)}% YoY
            </div>
          </div>
          <div className="bg-bg-secondary rounded-xl p-4 border border-border">
            <div className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1">Shipping Income YTD</div>
            <div className="text-2xl font-bold text-sky-400">
              {fmt.currency(closedData?.comparison.find(c => c.category === "Shipping Income")?.current || 0)}
            </div>
            <div className={`text-xs font-medium ${(closedData?.comparison.find(c => c.category === "Shipping Income")?.yoyPercent || 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {(closedData?.comparison.find(c => c.category === "Shipping Income")?.yoyPercent || 0) >= 0 ? "+" : ""}{(closedData?.comparison.find(c => c.category === "Shipping Income")?.yoyPercent || 0).toFixed(1)}% YoY
            </div>
          </div>
          <div className="bg-bg-secondary rounded-xl p-4 border border-border">
            <div className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1">Shipping % of Gross</div>
            <div className="text-2xl font-bold text-sky-400">
              {closedData ? ((closedData.comparison.find(c => c.category === "Shipping Income")?.current || 0) / closedData.grossRevenue.current * 100).toFixed(1) : 0}%
            </div>
            <div className="text-xs text-text-tertiary">
              vs {closedData ? ((closedData.comparison.find(c => c.category === "Shipping Income")?.prior || 0) / closedData.grossRevenue.prior * 100).toFixed(1) : 0}% last year
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left: Discount Rate Line Chart */}
          <div className="bg-bg-secondary rounded-xl p-6 border border-border">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-text-primary">Discount Rate by Month</h3>
                <p className="text-xs text-text-tertiary">Discounts as % of gross revenue</p>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-0.5 bg-amber-400 rounded"></div>
                  <span className="text-text-tertiary">{year}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-0.5 bg-gray-500 rounded" style={{ borderStyle: "dashed" }}></div>
                  <span className="text-text-tertiary">{year - 1}</span>
                </div>
              </div>
            </div>
            <div className="h-[250px] [&_svg]:outline-none [&_*:focus]:outline-none">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={discountRateData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: "#9CA3AF", fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: "#374151" }}
                  />
                  <YAxis
                    tick={{ fill: "#9CA3AF", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `${v.toFixed(0)}%`}
                    domain={[0, "auto"]}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload || payload.length < 2) return null;
                      const current = payload.find((p) => p.dataKey === "current")?.value as number || 0;
                      const prior = payload.find((p) => p.dataKey === "prior")?.value as number || 0;
                      const currentAbs = payload.find((p) => p.dataKey === "current")?.payload?.currentAbs || 0;
                      const priorAbs = payload.find((p) => p.dataKey === "current")?.payload?.priorAbs || 0;
                      return (
                        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 shadow-xl">
                          <div className="text-gray-400 font-semibold mb-3">{label}</div>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-6">
                              <span className="text-amber-400 font-medium">{year}:</span>
                              <span className="text-white font-bold">{current.toFixed(1)}%</span>
                            </div>
                            <div className="text-xs text-gray-400">{fmt.currencyFull(currentAbs)} in discounts</div>
                            <div className="flex items-center justify-between gap-6 pt-2 border-t border-gray-700">
                              <span className="text-gray-400">{year - 1}:</span>
                              <span className="text-gray-300">{prior.toFixed(1)}%</span>
                            </div>
                            <div className="text-xs text-gray-500">{fmt.currencyFull(priorAbs)} in discounts</div>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="prior"
                    stroke="#6B7280"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="current"
                    stroke="#F59E0B"
                    strokeWidth={2.5}
                    dot={{ fill: "#F59E0B", strokeWidth: 0, r: 3 }}
                    activeDot={{ r: 5, fill: "#F59E0B", stroke: "#fff", strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Right: Shipping % of Channel Revenue - Clean Line Chart */}
          <div className="bg-bg-secondary rounded-xl p-6 border border-border">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-text-primary">Shipping % of Revenue</h3>
                <p className="text-xs text-text-tertiary">By channel — what % of each channel is shipping income?</p>
              </div>
              <div className="flex items-center gap-5 text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-sky-400"></div>
                  <span className="text-text-secondary font-medium">Web</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-violet-400"></div>
                  <span className="text-text-secondary font-medium">Wholesale</span>
                </div>
              </div>
            </div>
            <div className="h-[250px] [&_svg]:outline-none [&_*:focus]:outline-none">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={shippingData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="webShipGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#38BDF8" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#38BDF8" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="wsShipGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8B5CF6" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: "#9CA3AF", fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: "#374151" }}
                  />
                  <YAxis
                    tick={{ fill: "#9CA3AF", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `${v}%`}
                    domain={[0, 8]}
                    ticks={[0, 2, 4, 6, 8]}
                  />
                  <Tooltip
                    cursor={{ stroke: '#4B5563', strokeWidth: 1 }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload || payload.length < 1) return null;
                      const webPct = payload[0]?.payload?.webShippingPct || 0;
                      const wsPct = payload[0]?.payload?.wholesaleShippingPct || 0;
                      const priorWebPct = payload[0]?.payload?.priorWebShippingPct || 0;
                      const priorWsPct = payload[0]?.payload?.priorWholesaleShippingPct || 0;
                      const webChange = webPct - priorWebPct;
                      const wsChange = wsPct - priorWsPct;
                      return (
                        <div className="bg-gray-900/95 backdrop-blur border border-gray-700 rounded-lg p-3 shadow-xl">
                          <div className="text-gray-400 text-xs font-medium mb-2">{label} {year}</div>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-4">
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-sky-400"></div>
                                <span className="text-sky-400 text-sm font-semibold">{webPct.toFixed(1)}%</span>
                              </div>
                              <span className={`text-xs ${webChange >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                {webChange >= 0 ? "+" : ""}{webChange.toFixed(1)}pp
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-violet-400"></div>
                                <span className="text-violet-400 text-sm font-semibold">{wsPct.toFixed(1)}%</span>
                              </div>
                              <span className={`text-xs ${wsChange >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                {wsChange >= 0 ? "+" : ""}{wsChange.toFixed(1)}pp
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="webShippingPct"
                    stroke="#38BDF8"
                    strokeWidth={2.5}
                    fill="url(#webShipGradient)"
                    dot={{ fill: "#38BDF8", strokeWidth: 0, r: 3 }}
                    activeDot={{ r: 5, fill: "#38BDF8", stroke: "#fff", strokeWidth: 2 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="wholesaleShippingPct"
                    stroke="#8B5CF6"
                    strokeWidth={2.5}
                    fill="url(#wsShipGradient)"
                    dot={{ fill: "#8B5CF6", strokeWidth: 0, r: 3 }}
                    activeDot={{ r: 5, fill: "#8B5CF6", stroke: "#fff", strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </section>

      {/* ================================================================== */}
      {/* SUMMARY YTD (Through Closed Period) */}
      {/* ================================================================== */}
      <section>
        <h2 className="text-xl font-bold text-text-primary mb-6 pb-2 border-b border-border">
          Summary Jan-{closedMonthName} {year} (Closed Period)
        </h2>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left: Revenue Mix Pie (Closed Period) */}
          <div className="lg:col-span-3">
            <LargeDonutChart
              data={ytdRevenueMix}
              title="Product Mix"
              centerLabel={`Jan-${closedMonthName}`}
            />
          </div>

          {/* Right: Cumulative Line Chart */}
          <div className="lg:col-span-9 bg-bg-secondary rounded-xl p-6 border border-border">
            <CumulativeLineChart
              data={cumulativeChartData}
              currentYear={year}
              priorYear={year - 1}
            />
          </div>
        </div>

        {/* YTD Revenue Table */}
        <div className="mt-8">
          <RevenueTable
            title="Total Revenue (YTD)"
            priorLabel={`YTD ${year - 1}`}
            currentLabel={`YTD ${year}`}
            rows={ytdTableRows}
          />
        </div>
      </section>

      {/* Footer */}
      <footer className="pt-6 border-t border-border/50">
        <p className="text-xs text-text-muted">
          Data synced from NetSuite • Last sync: {data.lastSync ? new Date(data.lastSync).toLocaleString() : "Never"}
        </p>
      </footer>
    </div>
  );
}
