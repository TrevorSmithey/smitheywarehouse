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
  BookOpen,
  Info,
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
import {
  B2B_SEASONALITY,
  CORP_SEASONALITY,
  DOOR_BENCHMARKS,
  CORPORATE_ENGRAVING,
  MONTHLY_WITHIN_QUARTER,
  BLENDED_AUP,
} from "@/lib/forecasting";
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
// METHODOLOGY ACCORDION SECTION
// =============================================================================

function MethodologySection({
  title,
  icon,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-border/20 last:border-b-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-bg-tertiary/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-text-muted">{icon}</span>
          <span className="text-sm font-medium text-text-primary">{title}</span>
        </div>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-text-muted" />
        ) : (
          <ChevronDown className="w-4 h-4 text-text-muted" />
        )}
      </button>
      {isOpen && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function ForecastMethodology() {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-5 py-4 flex items-center justify-between hover:bg-bg-tertiary/20 transition-colors"
      >
        <div className="flex items-center gap-3">
          <BookOpen className="w-5 h-5 text-accent-blue" />
          <div className="text-left">
            <h3 className="text-sm font-medium text-text-primary">
              Methodology & Assumptions
            </h3>
            <p className="text-xs text-text-tertiary mt-0.5">
              Data sources, calculations, and business logic reference
            </p>
          </div>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-5 h-5 text-text-muted" />
        ) : (
          <ChevronDown className="w-5 h-5 text-text-muted" />
        )}
      </button>

      {/* Collapsible Content */}
      {isExpanded && (
        <div className="border-t border-border/30">
          {/* Overview */}
          <MethodologySection
            title="Overview"
            icon={<Info className="w-4 h-4" />}
            defaultOpen={true}
          >
            <div className="space-y-3 text-sm text-text-secondary">
              <p>
                This forecast models B2B wholesale revenue across two distinct channels:{" "}
                <span className="text-text-primary font-medium">Traditional B2B</span>{" "}
                (retail partners, door-based) and{" "}
                <span className="text-text-primary font-medium">Corporate</span>{" "}
                (gifting programs, event-based).
              </p>
              <div className="bg-bg-tertiary/50 rounded-lg p-3">
                <p className="text-xs text-text-tertiary mb-2 font-medium uppercase tracking-wider">
                  Key Insight
                </p>
                <p className="text-sm">
                  These channels have fundamentally different economics. B2B is predictable
                  (door-driven, ~2.6% quarterly variance). Corporate is volatile (event-driven,
                  ~12% quarterly variance in Q4).
                </p>
              </div>
            </div>
          </MethodologySection>

          {/* Seasonality */}
          <MethodologySection
            title="Quarterly Seasonality"
            icon={<TrendingUp className="w-4 h-4" />}
          >
            <div className="space-y-4">
              <p className="text-sm text-text-secondary">
                Seasonality patterns based on 3-year historical averages (2023-2025).
              </p>

              {/* B2B Seasonality Table */}
              <div>
                <h4 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2 flex items-center gap-2">
                  <Users className="w-3 h-3" /> B2B Seasonality
                </h4>
                <div className="grid grid-cols-4 gap-2">
                  {(["q1", "q2", "q3", "q4"] as const).map((q) => (
                    <div
                      key={q}
                      className="bg-bg-tertiary/50 rounded-lg p-3 text-center"
                    >
                      <div className="text-xs text-text-tertiary uppercase mb-1">
                        {q.toUpperCase()}
                      </div>
                      <div className="text-lg font-semibold text-text-primary">
                        {(B2B_SEASONALITY[q] * 100).toFixed(0)}%
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-text-tertiary mt-2">
                  Low variance (σ 1.3-3.4%) — highly predictable
                </p>
              </div>

              {/* Corporate Seasonality Table */}
              <div>
                <h4 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2 flex items-center gap-2">
                  <Building2 className="w-3 h-3" /> Corporate Seasonality
                </h4>
                <div className="grid grid-cols-4 gap-2">
                  {(["q1", "q2", "q3", "q4"] as const).map((q) => (
                    <div
                      key={q}
                      className={`bg-bg-tertiary/50 rounded-lg p-3 text-center ${
                        q === "q4" ? "ring-1 ring-amber-400/30" : ""
                      }`}
                    >
                      <div className="text-xs text-text-tertiary uppercase mb-1">
                        {q.toUpperCase()}
                      </div>
                      <div className="text-lg font-semibold text-text-primary">
                        {(CORP_SEASONALITY[q] * 100).toFixed(0)}%
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-text-tertiary mt-2">
                  High Q4 variance (σ 12%) — corporate gifting is event-driven
                </p>
              </div>

              {/* Monthly Distribution */}
              <div className="bg-bg-tertiary/30 rounded-lg p-3">
                <h4 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">
                  Monthly Within-Quarter Distribution
                </h4>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-text-tertiary">Q1-Q3:</span>{" "}
                    <span className="text-text-primary">
                      {MONTHLY_WITHIN_QUARTER.default.map((p) => `${(p * 100).toFixed(0)}%`).join(" → ")}
                    </span>
                  </div>
                  <div>
                    <span className="text-text-tertiary">Q4:</span>{" "}
                    <span className="text-text-primary">
                      {MONTHLY_WITHIN_QUARTER.q4.map((p) => `${(p * 100).toFixed(0)}%`).join(" → ")}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-text-tertiary mt-2">
                  Back-weighted within quarters (later months heavier)
                </p>
              </div>
            </div>
          </MethodologySection>

          {/* Door Economics */}
          <MethodologySection
            title="Door Economics (B2B)"
            icon={<Layers className="w-4 h-4" />}
          >
            <div className="space-y-4">
              <p className="text-sm text-text-secondary">
                B2B revenue is modeled bottom-up from door (retail partner) economics.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-bg-tertiary/50 rounded-lg p-3">
                  <div className="text-xs text-text-tertiary mb-1">Retention Rate</div>
                  <div className="text-xl font-semibold text-status-good">
                    {(DOOR_BENCHMARKS.avgRetentionRate * 100).toFixed(0)}%
                  </div>
                  <div className="text-xs text-text-muted">doors return YoY</div>
                </div>
                <div className="bg-bg-tertiary/50 rounded-lg p-3">
                  <div className="text-xs text-text-tertiary mb-1">Churn Rate</div>
                  <div className="text-xl font-semibold text-status-bad">
                    {(DOOR_BENCHMARKS.avgChurnRate * 100).toFixed(0)}%
                  </div>
                  <div className="text-xs text-text-muted">annual churn</div>
                </div>
                <div className="bg-bg-tertiary/50 rounded-lg p-3">
                  <div className="text-xs text-text-tertiary mb-1">Organic Growth</div>
                  <div className="text-xl font-semibold text-text-primary">
                    {(DOOR_BENCHMARKS.sameStoreGrowth * 100).toFixed(0)}%
                  </div>
                  <div className="text-xs text-text-muted">from retained doors</div>
                </div>
                <div className="bg-bg-tertiary/50 rounded-lg p-3">
                  <div className="text-xs text-text-tertiary mb-1">New Door Yield</div>
                  <div className="text-xl font-semibold text-text-primary">
                    ${DOOR_BENCHMARKS.newDoorFirstYearYield.toLocaleString()}
                  </div>
                  <div className="text-xs text-text-muted">first year avg</div>
                </div>
              </div>

              <div className="bg-bg-tertiary/30 rounded-lg p-3">
                <h4 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">
                  B2B Revenue Formula
                </h4>
                <div className="text-xs font-mono bg-bg-tertiary/50 rounded p-2 text-text-secondary">
                  <div>Existing Book = (Doors − Churn) × ${DOOR_BENCHMARKS.returningDoorAvgYield.toLocaleString()} × (1 + {(DOOR_BENCHMARKS.sameStoreGrowth * 100).toFixed(0)}%)</div>
                  <div className="mt-1">New Revenue = New Doors × ${DOOR_BENCHMARKS.newDoorFirstYearYield.toLocaleString()} × 50%*</div>
                  <div className="mt-2 text-text-tertiary">*50% seasonality factor (acquired evenly through year)</div>
                </div>
              </div>
            </div>
          </MethodologySection>

          {/* Corporate Engraving */}
          <MethodologySection
            title="Corporate Engraving Economics"
            icon={<Building2 className="w-4 h-4" />}
          >
            <div className="space-y-4">
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                <h4 className="text-xs font-medium text-amber-400 uppercase tracking-wider mb-1">
                  Critical for Unit Projections
                </h4>
                <p className="text-sm text-text-secondary">
                  Corporate engraving (SMITH-ENG) is a <strong>service</strong>, not a physical product.
                  Unit projections must separate engraving revenue from physical product revenue.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-bg-tertiary/50 rounded-lg p-3">
                  <div className="text-xs text-text-tertiary mb-1">Physical Revenue</div>
                  <div className="text-xl font-semibold text-text-primary">
                    {(CORPORATE_ENGRAVING.physicalRevenueShare * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-text-muted">of corporate total</div>
                </div>
                <div className="bg-bg-tertiary/50 rounded-lg p-3">
                  <div className="text-xs text-text-tertiary mb-1">Engraving Revenue</div>
                  <div className="text-xl font-semibold text-amber-400">
                    {(CORPORATE_ENGRAVING.revenueShare * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-text-muted">service revenue</div>
                </div>
                <div className="bg-bg-tertiary/50 rounded-lg p-3">
                  <div className="text-xs text-text-tertiary mb-1">Attach Rate</div>
                  <div className="text-xl font-semibold text-text-primary">
                    {(CORPORATE_ENGRAVING.attachRate * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-text-muted">units engraved</div>
                </div>
                <div className="bg-bg-tertiary/50 rounded-lg p-3">
                  <div className="text-xs text-text-tertiary mb-1">Engraving Price</div>
                  <div className="text-xl font-semibold text-text-primary">
                    ${CORPORATE_ENGRAVING.averagePrice.toFixed(2)}
                  </div>
                  <div className="text-xs text-text-muted">avg per item</div>
                </div>
              </div>

              <div className="bg-bg-tertiary/30 rounded-lg p-3">
                <h4 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">
                  Physical AUP Comparison
                </h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-text-tertiary">Blended AUP:</span>{" "}
                    <span className="text-status-bad line-through">${BLENDED_AUP}</span>
                    <span className="text-xs text-text-muted ml-1">(wrong for planning)</span>
                  </div>
                  <div>
                    <span className="text-text-tertiary">Physical AUP:</span>{" "}
                    <span className="text-status-good font-medium">${CORPORATE_ENGRAVING.physicalAUP.toFixed(2)}</span>
                    <span className="text-xs text-text-muted ml-1">(use this)</span>
                  </div>
                </div>
              </div>

              <div className="bg-bg-tertiary/30 rounded-lg p-3">
                <h4 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">
                  Example: $1M Corporate Target
                </h4>
                <div className="text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-text-tertiary">Physical Revenue:</span>
                    <span className="text-text-primary">$846,000 (84.6%)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-tertiary">Engraving Revenue:</span>
                    <span className="text-text-primary">$154,000 (15.4%)</span>
                  </div>
                  <div className="flex justify-between border-t border-border/30 pt-1 mt-1">
                    <span className="text-text-tertiary">Physical Units:</span>
                    <span className="text-text-primary font-medium">58,587</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-tertiary">Engraving Operations:</span>
                    <span className="text-text-primary">8,437 (14.4% attach)</span>
                  </div>
                </div>
              </div>
            </div>
          </MethodologySection>

          {/* SKU Mix */}
          <MethodologySection
            title="SKU Mix & Unit Projections"
            icon={<Layers className="w-4 h-4" />}
          >
            <div className="space-y-4">
              <p className="text-sm text-text-secondary">
                Unit projections use historical SKU mix to distribute revenue across products.
                Top 10 SKUs account for ~60% of B2B revenue.
              </p>

              <div className="bg-bg-tertiary/30 rounded-lg p-3">
                <h4 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">
                  Unit Calculation
                </h4>
                <div className="text-xs font-mono bg-bg-tertiary/50 rounded p-2 text-text-secondary">
                  <div>SKU Revenue = Monthly Revenue × SKU Revenue Share %</div>
                  <div className="mt-1">SKU Units = SKU Revenue ÷ SKU Avg Unit Price</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-bg-tertiary/50 rounded-lg p-3">
                  <div className="text-xs text-text-tertiary mb-1">B2B Blended AUP</div>
                  <div className="text-xl font-semibold text-text-primary">
                    ${BLENDED_AUP}
                  </div>
                  <div className="text-xs text-text-muted">fallback price</div>
                </div>
                <div className="bg-bg-tertiary/50 rounded-lg p-3">
                  <div className="text-xs text-text-tertiary mb-1">Corp Physical AUP</div>
                  <div className="text-xl font-semibold text-text-primary">
                    ${CORPORATE_ENGRAVING.physicalAUP.toFixed(2)}
                  </div>
                  <div className="text-xs text-text-muted">excl. engraving</div>
                </div>
              </div>

              <div className="bg-bg-tertiary/30 rounded-lg p-3">
                <h4 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">
                  Confidence Ranges
                </h4>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-16 text-text-tertiary">&gt;5% share:</span>
                    <span className="px-2 py-0.5 bg-status-good/20 text-status-good rounded">±10%</span>
                    <span className="text-text-muted">High volume, more data</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-16 text-text-tertiary">2-5%:</span>
                    <span className="px-2 py-0.5 bg-status-warning/20 text-status-warning rounded">±15%</span>
                    <span className="text-text-muted">Moderate volume</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-16 text-text-tertiary">&lt;2%:</span>
                    <span className="px-2 py-0.5 bg-status-bad/20 text-status-bad rounded">±20%</span>
                    <span className="text-text-muted">Lower volume, more variance</span>
                  </div>
                </div>
              </div>
            </div>
          </MethodologySection>

          {/* Data Sources */}
          <MethodologySection
            title="Data Sources"
            icon={<History className="w-4 h-4" />}
          >
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-2 text-xs">
                <div className="flex items-start gap-3 p-2 bg-bg-tertiary/30 rounded">
                  <span className="text-accent-blue font-medium w-24">Actuals</span>
                  <span className="text-text-secondary">
                    ns_wholesale_transactions → real-time NetSuite sync
                  </span>
                </div>
                <div className="flex items-start gap-3 p-2 bg-bg-tertiary/30 rounded">
                  <span className="text-accent-blue font-medium w-24">Door Count</span>
                  <span className="text-text-secondary">
                    ns_wholesale_customers.is_inactive = false → active B2B doors
                  </span>
                </div>
                <div className="flex items-start gap-3 p-2 bg-bg-tertiary/30 rounded">
                  <span className="text-accent-blue font-medium w-24">Seasonality</span>
                  <span className="text-text-secondary">
                    3-year average (2023-2025) from ns_wholesale_transactions
                  </span>
                </div>
                <div className="flex items-start gap-3 p-2 bg-bg-tertiary/30 rounded">
                  <span className="text-accent-blue font-medium w-24">SKU Mix</span>
                  <span className="text-text-secondary">
                    ns_wholesale_line_items aggregated by revenue share
                  </span>
                </div>
                <div className="flex items-start gap-3 p-2 bg-bg-tertiary/30 rounded">
                  <span className="text-accent-blue font-medium w-24">Corp Filter</span>
                  <span className="text-text-secondary">
                    ns_wholesale_customers.is_corporate = true (NOT category)
                  </span>
                </div>
              </div>

              <div className="text-xs text-text-tertiary">
                Last methodology update: January 2026. See{" "}
                <code className="px-1 py-0.5 bg-bg-tertiary rounded">BUSINESS_LOGIC.md</code>{" "}
                for full documentation.
              </div>
            </div>
          </MethodologySection>

          {/* Validation Checklist */}
          <MethodologySection
            title="Validation Checklist"
            icon={<CheckCircle className="w-4 h-4" />}
          >
            <div className="space-y-2">
              <div className="text-xs text-text-secondary mb-3">
                Before trusting any projection, verify these sanity checks:
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex items-start gap-2">
                  <span className="text-status-good">✓</span>
                  <span className="text-text-secondary">
                    Q4 should be 35-40% of B2B annual, 55-60% of Corporate annual
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-status-good">✓</span>
                  <span className="text-text-secondary">
                    Corporate engraving should be ~15% of corporate revenue
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-status-good">✓</span>
                  <span className="text-text-secondary">
                    Physical AUP for Corporate should be ~$14-15, not $120+ (blended)
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-status-good">✓</span>
                  <span className="text-text-secondary">
                    Door retention should be 80-85% (if lower, investigate data)
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-status-good">✓</span>
                  <span className="text-text-secondary">
                    YTD actuals should roughly match seasonality expectations
                  </span>
                </div>
              </div>
            </div>
          </MethodologySection>
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

      {/* Methodology & Assumptions */}
      <ForecastMethodology />

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
