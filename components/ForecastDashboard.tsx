"use client";

import { useState, useMemo } from "react";
import {
  Target,
  TrendingUp,
  TrendingDown,
  Users,
  DollarSign,
  Building2,
  History,
  ChevronDown,
  ChevronUp,
  Download,
  RefreshCw,
  Edit3,
  AlertCircle,
  CheckCircle,
  Clock,
  Layers,
} from "lucide-react";
import { format } from "date-fns";
import { SmitheyPageLoader } from "@/components/SmitheyLoader";
import { formatCurrency, formatCurrencyFull, formatPctChange } from "@/lib/formatters";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  ComposedChart,
  Line,
} from "recharts";
import type {
  ForecastResponse,
  ForecastQuarterActuals,
  ForecastDoorScenario,
  ForecastMonthlyUnits,
} from "@/lib/types";
import { B2B_SEASONALITY, CORP_SEASONALITY } from "@/lib/forecasting";
import { sortSkusByCanonicalOrder } from "@/lib/constants";

// =============================================================================
// TYPES
// =============================================================================

interface ForecastDashboardProps {
  data: ForecastResponse | null;
  loading: boolean;
  error?: string | null;
  onRefresh: () => void;
  onEdit: () => void;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function getPaceStatus(actual: number, target: number, quarterProgress: number): {
  label: string;
  color: string;
  icon: React.ReactNode;
} {
  if (target === 0) {
    return { label: "No Target", color: "text-text-muted", icon: <Clock className="w-4 h-4" /> };
  }

  const expectedActual = target * quarterProgress;
  const pace = actual / expectedActual;

  if (pace >= 1.1) {
    return { label: "Ahead", color: "text-status-good", icon: <TrendingUp className="w-4 h-4" /> };
  }
  if (pace >= 0.9) {
    return { label: "On Track", color: "text-status-good", icon: <CheckCircle className="w-4 h-4" /> };
  }
  if (pace >= 0.75) {
    return { label: "Slightly Behind", color: "text-status-warning", icon: <AlertCircle className="w-4 h-4" /> };
  }
  return { label: "Behind", color: "text-status-bad", icon: <TrendingDown className="w-4 h-4" /> };
}

function getQuarterProgress(): { quarter: string; progress: number } {
  const now = new Date();
  const month = now.getMonth();
  const day = now.getDate();

  const quarters = [
    { name: "Q1", startMonth: 0, daysInQuarter: 90 },
    { name: "Q2", startMonth: 3, daysInQuarter: 91 },
    { name: "Q3", startMonth: 6, daysInQuarter: 92 },
    { name: "Q4", startMonth: 9, daysInQuarter: 92 },
  ];

  const q = Math.floor(month / 3);
  const quarter = quarters[q];
  const monthInQuarter = month - quarter.startMonth;
  const daysElapsed = monthInQuarter * 30 + day; // Approximate
  const progress = Math.min(1, daysElapsed / quarter.daysInQuarter);

  return { quarter: quarter.name, progress };
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function MetricCard({
  label,
  value,
  subValue,
  icon,
  trend,
  trendLabel,
}: {
  label: string;
  value: string;
  subValue?: string;
  icon: React.ReactNode;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
}) {
  const trendColor =
    trend === "up" ? "text-status-good" :
    trend === "down" ? "text-status-bad" :
    "text-text-muted";

  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30 p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
          {label}
        </span>
        <div className="text-text-muted">{icon}</div>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold text-text-primary tracking-tight">
          {value}
        </span>
        {subValue && (
          <span className="text-sm text-text-tertiary">{subValue}</span>
        )}
      </div>
      {trendLabel && (
        <div className={`mt-2 text-xs ${trendColor}`}>
          {trendLabel}
        </div>
      )}
    </div>
  );
}

function QuarterlyBreakdownTable({
  b2bTargets,
  corpTargets,
  actuals,
}: {
  b2bTargets: { q1: number; q2: number; q3: number; q4: number };
  corpTargets: { q1: number; q2: number; q3: number; q4: number };
  actuals: ForecastQuarterActuals[];
}) {
  const { quarter: currentQuarter } = getQuarterProgress();

  const quarters = ["Q1", "Q2", "Q3", "Q4"] as const;

  // Helper to get the quarterly actuals object for a given quarter
  const getQuarterData = (quarterNum: 1 | 2 | 3 | 4) => {
    return actuals.find((a) => a.quarter === quarterNum);
  };

  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30 overflow-hidden">
      <div className="px-5 py-4 border-b border-border/30">
        <h3 className="text-sm font-medium text-text-primary">Quarterly Breakdown</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-bg-tertiary/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-text-tertiary uppercase tracking-wider">
                Channel
              </th>
              {quarters.map((q) => (
                <th
                  key={q}
                  className={`px-4 py-3 text-right text-xs font-medium uppercase tracking-wider ${
                    q === currentQuarter ? "text-accent-blue" : "text-text-tertiary"
                  }`}
                >
                  {q}
                </th>
              ))}
              <th className="px-4 py-3 text-right text-xs font-medium text-text-tertiary uppercase tracking-wider">
                Annual
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/20">
            {/* B2B Row */}
            <tr>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-accent-blue" />
                  <span className="font-medium text-text-primary">B2B</span>
                </div>
              </td>
              {quarters.map((q, i) => {
                const quarterNum = (i + 1) as 1 | 2 | 3 | 4;
                const target = [b2bTargets.q1, b2bTargets.q2, b2bTargets.q3, b2bTargets.q4][i];
                const quarterData = getQuarterData(quarterNum);
                const actual = quarterData?.b2b_actual || 0;
                const isCurrentQ = q === currentQuarter;
                const pct = target > 0 ? (actual / target) * 100 : 0;

                return (
                  <td key={q} className="px-4 py-3 text-right">
                    <div className="space-y-1">
                      <div className="text-text-primary font-medium">
                        {formatCompact(target)}
                      </div>
                      {actual > 0 && (
                        <div className={`text-xs ${pct >= 100 ? "text-status-good" : isCurrentQ ? "text-accent-blue" : "text-text-muted"}`}>
                          {formatCompact(actual)} ({pct.toFixed(0)}%)
                        </div>
                      )}
                    </div>
                  </td>
                );
              })}
              <td className="px-4 py-3 text-right">
                <div className="text-text-primary font-semibold">
                  {formatCompact(b2bTargets.q1 + b2bTargets.q2 + b2bTargets.q3 + b2bTargets.q4)}
                </div>
              </td>
            </tr>

            {/* Corporate Row */}
            <tr>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-amber-400" />
                  <span className="font-medium text-text-primary">Corporate</span>
                </div>
              </td>
              {quarters.map((q, i) => {
                const quarterNum = (i + 1) as 1 | 2 | 3 | 4;
                const target = [corpTargets.q1, corpTargets.q2, corpTargets.q3, corpTargets.q4][i];
                const quarterData = getQuarterData(quarterNum);
                const actual = quarterData?.corp_actual || 0;
                const isCurrentQ = q === currentQuarter;
                const pct = target > 0 ? (actual / target) * 100 : 0;

                return (
                  <td key={q} className="px-4 py-3 text-right">
                    <div className="space-y-1">
                      <div className="text-text-primary font-medium">
                        {formatCompact(target)}
                      </div>
                      {actual > 0 && (
                        <div className={`text-xs ${pct >= 100 ? "text-status-good" : isCurrentQ ? "text-accent-blue" : "text-text-muted"}`}>
                          {formatCompact(actual)} ({pct.toFixed(0)}%)
                        </div>
                      )}
                    </div>
                  </td>
                );
              })}
              <td className="px-4 py-3 text-right">
                <div className="text-text-primary font-semibold">
                  {formatCompact(corpTargets.q1 + corpTargets.q2 + corpTargets.q3 + corpTargets.q4)}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DoorDriversCard({
  forecast,
  scenarios,
  currentDoorCount,
}: {
  forecast: ForecastResponse["forecast"];
  scenarios: ForecastDoorScenario[];
  currentDoorCount: number;
}) {
  const [showScenarios, setShowScenarios] = useState(false);

  if (!forecast) return null;

  const startingDoors = forecast.existing_doors_start || currentDoorCount;
  const churn = forecast.expected_churn_doors || 0;
  const newDoors = forecast.new_doors_target || 0;
  const endingDoors = startingDoors - churn + newDoors;
  const organicGrowth = forecast.organic_growth_pct || 0.11;
  const newDoorYield = forecast.new_door_first_year_yield || 6000;

  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30">
      <div className="px-5 py-4 border-b border-border/30 flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary">Door Drivers</h3>
        <button
          onClick={() => setShowScenarios(!showScenarios)}
          className="text-xs text-accent-blue hover:text-accent-blue/80 flex items-center gap-1"
        >
          {showScenarios ? "Hide" : "Show"} Scenarios
          {showScenarios ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>
      <div className="p-5 space-y-4">
        {/* Door Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-xs text-text-tertiary mb-1">Starting Doors</div>
            <div className="text-xl font-semibold text-text-primary">{startingDoors}</div>
          </div>
          <div>
            <div className="text-xs text-text-tertiary mb-1">Expected Churn</div>
            <div className="text-xl font-semibold text-status-bad">-{churn}</div>
          </div>
          <div>
            <div className="text-xs text-text-tertiary mb-1">New Doors Target</div>
            <div className="text-xl font-semibold text-status-good">+{newDoors}</div>
          </div>
          <div>
            <div className="text-xs text-text-tertiary mb-1">Ending Doors</div>
            <div className="text-xl font-semibold text-text-primary">{endingDoors}</div>
          </div>
        </div>

        {/* Assumption Pills */}
        <div className="flex flex-wrap gap-2">
          <span className="px-2 py-1 bg-bg-tertiary rounded text-xs text-text-secondary">
            {(organicGrowth * 100).toFixed(0)}% organic growth
          </span>
          <span className="px-2 py-1 bg-bg-tertiary rounded text-xs text-text-secondary">
            ${newDoorYield.toLocaleString()} new door yield
          </span>
        </div>

        {/* Scenarios */}
        {showScenarios && scenarios.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border/30">
            <h4 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-3">
              Scenario Analysis
            </h4>
            <div className="space-y-2">
              {scenarios.map((s, i) => {
                const isOnTrack = s.gap_to_target <= 0 || s.gap_to_target < s.total_implied_revenue * 0.05;
                return (
                  <div
                    key={i}
                    className={`flex items-center justify-between p-3 rounded-lg ${
                      isOnTrack ? "bg-status-good/10" : "bg-bg-tertiary"
                    }`}
                  >
                    <div>
                      <div className="text-sm font-medium text-text-primary">{s.scenario_name}</div>
                      <div className="text-xs text-text-tertiary">
                        {s.new_doors} new doors, {(s.organic_growth_pct * 100).toFixed(0)}% organic
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium text-text-primary">
                        {formatCompact(s.total_implied_revenue)}
                      </div>
                      <div className={`text-xs ${isOnTrack ? "text-status-good" : "text-status-warning"}`}>
                        {isOnTrack ? "✓ On target" : `${formatCompact(s.gap_to_target)} gap`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SkuUnitForecastTable({
  monthlyUnits,
  onExport,
}: {
  monthlyUnits: ForecastMonthlyUnits[];
  onExport: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (monthlyUnits.length === 0) {
    return null;
  }

  // Group by SKU
  const skuMap = new Map<string, { name: string; months: Map<string, number>; total: number }>();
  for (const mu of monthlyUnits) {
    if (!skuMap.has(mu.sku)) {
      skuMap.set(mu.sku, { name: mu.sku_name || mu.sku, months: new Map(), total: 0 });
    }
    const entry = skuMap.get(mu.sku)!;
    entry.months.set(mu.month, mu.units);
    entry.total += mu.units;
  }

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // Use canonical SKU order from budget spreadsheet (lib/constants.ts)
  const skus = Array.from(skuMap.entries()).sort((a, b) => sortSkusByCanonicalOrder(a[0], b[0]));
  const displaySkus = expanded ? skus : skus.slice(0, 5);

  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30 overflow-hidden">
      <div className="px-5 py-4 border-b border-border/30 flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary">SKU Unit Forecast</h3>
        <button
          onClick={onExport}
          className="text-xs text-accent-blue hover:text-accent-blue/80 flex items-center gap-1"
        >
          <Download className="w-3 h-3" />
          Export CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-bg-tertiary/50">
              <th className="px-3 py-2 text-left font-medium text-text-tertiary sticky left-0 bg-bg-tertiary/50">
                SKU
              </th>
              {months.map((m) => (
                <th key={m} className="px-2 py-2 text-right font-medium text-text-tertiary">
                  {m}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium text-text-tertiary">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/20">
            {displaySkus.map(([sku, data]) => (
              <tr key={sku} className="hover:bg-bg-tertiary/30">
                <td className="px-3 py-2 sticky left-0 bg-bg-secondary">
                  <div className="font-medium text-text-primary truncate max-w-[140px]" title={data.name}>
                    {data.name}
                  </div>
                </td>
                {months.map((m) => (
                  <td key={m} className="px-2 py-2 text-right text-text-secondary">
                    {data.months.get(m)?.toLocaleString() || "-"}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-medium text-text-primary">
                  {data.total.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {skus.length > 5 && (
        <div className="px-5 py-3 border-t border-border/30">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-accent-blue hover:text-accent-blue/80 flex items-center gap-1"
          >
            {expanded ? "Show Less" : `Show All ${skus.length} SKUs`}
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function ForecastDashboard({
  data,
  loading,
  error,
  onRefresh,
  onEdit,
}: ForecastDashboardProps) {
  // Design system colors
  const colors = {
    emerald: "#10B981",
    amber: "#F59E0B",
    rose: "#DC2626",
    blue: "#0EA5E9",
    slate: "#64748B",
  };

  const { quarter: currentQuarter, progress: quarterProgress } = getQuarterProgress();

  // Export to CSV
  const exportUnitForecast = () => {
    if (!data?.monthlyUnits) return;

    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    // Group by SKU
    const skuMap = new Map<string, { name: string; months: Map<string, number> }>();
    for (const mu of data.monthlyUnits) {
      if (!skuMap.has(mu.sku)) {
        skuMap.set(mu.sku, { name: mu.sku_name || mu.sku, months: new Map() });
      }
      skuMap.get(mu.sku)!.months.set(mu.month, mu.units);
    }

    const rows: string[] = [];
    rows.push(`SKU,SKU Name,${months.join(",")},Total`);

    // Use canonical SKU order from budget spreadsheet (lib/constants.ts)
    const sortedSkus = Array.from(skuMap.entries()).sort((a, b) =>
      sortSkusByCanonicalOrder(a[0], b[0])
    );

    for (const [sku, entry] of sortedSkus) {
      const monthValues = months.map((m) => entry.months.get(m) || 0);
      const total = monthValues.reduce((sum, v) => sum + v, 0);
      rows.push(`"${sku}","${entry.name}",${monthValues.join(",")},${total}`);
    }

    const csvContent = rows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const year = data.forecast?.fiscal_year || new Date().getFullYear();
    a.download = `sku-unit-forecast-FY${year}-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // Loading state
  if (loading) {
    return <SmitheyPageLoader />;
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-status-bad mx-auto mb-4" />
          <h3 className="text-lg font-medium text-text-primary mb-2">Error Loading Forecast</h3>
          <p className="text-sm text-text-secondary mb-4">{error}</p>
          <button
            onClick={onRefresh}
            className="px-4 py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:bg-accent-blue/80"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // No forecast state
  if (!data?.forecast) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Target className="w-12 h-12 text-text-muted mx-auto mb-4" />
          <h3 className="text-lg font-medium text-text-primary mb-2">No Forecast Found</h3>
          <p className="text-sm text-text-secondary mb-4">
            Create a forecast to start tracking budget vs actuals
          </p>
          <button
            onClick={onEdit}
            className="px-4 py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:bg-accent-blue/80"
          >
            Create Forecast
          </button>
        </div>
      </div>
    );
  }

  const { forecast, skuMix, quarterlyActuals, scenarios, monthlyUnits, stats } = data;

  const b2bTargets = {
    q1: forecast.b2b_q1_target || 0,
    q2: forecast.b2b_q2_target || 0,
    q3: forecast.b2b_q3_target || 0,
    q4: forecast.b2b_q4_target || 0,
  };

  const corpTargets = {
    q1: forecast.corp_q1_target || 0,
    q2: forecast.corp_q2_target || 0,
    q3: forecast.corp_q3_target || 0,
    q4: forecast.corp_q4_target || 0,
  };

  const b2bTotal = b2bTargets.q1 + b2bTargets.q2 + b2bTargets.q3 + b2bTargets.q4;
  const corpTotal = corpTargets.q1 + corpTargets.q2 + corpTargets.q3 + corpTargets.q4;
  const totalTarget = b2bTotal + corpTotal;

  const b2bActualYtd = stats?.b2b_ytd_actual || 0;
  const corpActualYtd = stats?.corp_ytd_actual || 0;
  const totalActualYtd = b2bActualYtd + corpActualYtd;

  // Get current quarter targets
  const currentQIndex = ["Q1", "Q2", "Q3", "Q4"].indexOf(currentQuarter);
  const currentQuarterNum = (currentQIndex + 1) as 1 | 2 | 3 | 4;
  const currentB2bTarget = [b2bTargets.q1, b2bTargets.q2, b2bTargets.q3, b2bTargets.q4][currentQIndex];
  const currentCorpTarget = [corpTargets.q1, corpTargets.q2, corpTargets.q3, corpTargets.q4][currentQIndex];

  // Get current quarter actuals
  const currentQuarterData = quarterlyActuals.find((a) => a.quarter === currentQuarterNum);
  const currentB2bActual = currentQuarterData?.b2b_actual || 0;
  const currentCorpActual = currentQuarterData?.corp_actual || 0;

  const b2bPace = getPaceStatus(currentB2bActual, currentB2bTarget, quarterProgress);
  const corpPace = getPaceStatus(currentCorpActual, currentCorpTarget, quarterProgress);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">
            FY{forecast.fiscal_year} Wholesale Forecast
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <span className={`text-xs px-2 py-0.5 rounded ${
              forecast.status === "active"
                ? "bg-status-good/20 text-status-good"
                : forecast.status === "draft"
                ? "bg-status-warning/20 text-status-warning"
                : "bg-text-muted/20 text-text-muted"
            }`}>
              {forecast.status.toUpperCase()}
            </span>
            <span className="text-xs text-text-tertiary">
              v{forecast.version} • Last updated {format(new Date(forecast.created_at), "MMM d, yyyy")}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            className="p-2 text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={onEdit}
            className="px-4 py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:bg-accent-blue/80 flex items-center gap-2"
          >
            <Edit3 className="w-4 h-4" />
            Edit Forecast
          </button>
        </div>
      </div>

      {/* Top-Level Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="B2B Annual Target"
          value={formatCompact(b2bTotal)}
          subValue={`${((b2bActualYtd / b2bTotal) * 100).toFixed(0)}% YTD`}
          icon={<Users className="w-5 h-5" />}
          trend={b2bActualYtd > 0 ? "up" : "neutral"}
          trendLabel={`${formatCompact(b2bActualYtd)} actual`}
        />
        <MetricCard
          label="Corporate Annual Target"
          value={formatCompact(corpTotal)}
          subValue={`${corpTotal > 0 ? ((corpActualYtd / corpTotal) * 100).toFixed(0) : 0}% YTD`}
          icon={<Building2 className="w-5 h-5" />}
          trend={corpActualYtd > 0 ? "up" : "neutral"}
          trendLabel={`${formatCompact(corpActualYtd)} actual`}
        />
        <MetricCard
          label={`${currentQuarter} B2B Pace`}
          value={b2bPace.label}
          subValue={`${(quarterProgress * 100).toFixed(0)}% through`}
          icon={b2bPace.icon}
          trend={b2bPace.label === "Ahead" || b2bPace.label === "On Track" ? "up" : b2bPace.label === "Behind" ? "down" : "neutral"}
          trendLabel={`${formatCompact(currentB2bActual)} of ${formatCompact(currentB2bTarget)}`}
        />
        <MetricCard
          label="Active Doors"
          value={(stats?.current_doors || 0).toLocaleString()}
          icon={<Layers className="w-5 h-5" />}
          trend="neutral"
          trendLabel={forecast.new_doors_target ? `+${forecast.new_doors_target} target` : undefined}
        />
      </div>

      {/* Quarterly Breakdown */}
      <QuarterlyBreakdownTable
        b2bTargets={b2bTargets}
        corpTargets={corpTargets}
        actuals={quarterlyActuals}
      />

      {/* Door Drivers */}
      <DoorDriversCard
        forecast={forecast}
        scenarios={scenarios}
        currentDoorCount={stats?.current_doors || 0}
      />

      {/* SKU Unit Forecast */}
      <SkuUnitForecastTable monthlyUnits={monthlyUnits} onExport={exportUnitForecast} />

      {/* Revision History */}
      {data.revisions && data.revisions.length > 1 && (
        <div className="bg-bg-secondary rounded-xl border border-border/30 overflow-hidden">
          <div className="px-5 py-4 border-b border-border/30 flex items-center gap-2">
            <History className="w-4 h-4 text-text-muted" />
            <h3 className="text-sm font-medium text-text-primary">Revision History</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-bg-tertiary/50">
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-tertiary">Version</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-tertiary">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-tertiary">Created</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-tertiary">B2B Total</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-tertiary">Corp Total</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-tertiary">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {data.revisions.map((rev) => (
                  <tr
                    key={rev.id}
                    className={rev.id === forecast.id ? "bg-accent-blue/5" : "hover:bg-bg-tertiary/30"}
                  >
                    <td className="px-4 py-3 font-medium text-text-primary">
                      v{rev.version}
                      {rev.id === forecast.id && (
                        <span className="ml-2 text-xs text-accent-blue">(current)</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        rev.status === "active"
                          ? "bg-status-good/20 text-status-good"
                          : rev.status === "draft"
                          ? "bg-status-warning/20 text-status-warning"
                          : "bg-text-muted/20 text-text-muted"
                      }`}>
                        {rev.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {format(new Date(rev.created_at), "MMM d, yyyy")}
                    </td>
                    <td className="px-4 py-3 text-text-primary">
                      {formatCompact(rev.b2b_total)}
                    </td>
                    <td className="px-4 py-3 text-text-primary">
                      {formatCompact(rev.corp_total)}
                    </td>
                    <td className="px-4 py-3 text-text-secondary text-xs max-w-[200px] truncate">
                      {rev.revision_note || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
