"use client";

import { useState, useMemo, useEffect } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  RefreshCw,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Users,
  Target,
  AlertTriangle,
  CheckCircle,
  Image as ImageIcon,
  Sparkles,
  Activity,
  BarChart3,
  Zap,
  MousePointerClick,
  Eye,
  ShoppingCart,
  X,
  Calendar,
} from "lucide-react";
import {
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  Area,
} from "recharts";
import { formatCurrency, formatPct } from "@/lib/formatters";
import { StaleTimestamp } from "@/components/StaleTimestamp";

// ============================================================================
// TYPES
// ============================================================================

type AdsPeriod = "ttm" | "mtd" | "last_month" | "qtd" | "ytd" | "30d" | "90d";

interface ChannelStats {
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
  conversions: number;
  revenue: number;
  platform_roas: number | null;
  cpa: number | null;
}

interface MetaCreative {
  meta_ad_id: string;
  ad_name: string | null;
  campaign_name: string | null;
  thumbnail_url: string | null;
  creative_type: string | null;
  lifetime_spend: number;
  current_ctr: number | null;
  peak_ctr: number | null;
  ctr_vs_peak: number | null;
  fatigue_severity: string | null;
}

interface DailyStats {
  date: string;
  meta_spend: number;
  google_spend: number;
  total_spend: number;
  shopify_revenue: number | null;
  mer: number | null;
}

interface MonthlyStats {
  month_start: string;
  meta_spend: number;
  google_spend: number;
  total_spend: number;
  shopify_revenue: number | null;
  new_customer_count: number | null;
  mer: number | null;
  ncac: number | null;
  // YoY comparison (same month last year)
  mer_yoy: number | null;
  ncac_yoy: number | null;
  spend_yoy: number | null;
  revenue_yoy: number | null;
}

interface Alert {
  id: string;
  alert_type: string;
  severity: string;
  channel: string | null;
  title: string;
  description: string;
  metric_value: string | null;
  action_recommended: string | null;
  entity_name: string | null;
  created_at: string;
}

interface MetaCampaignSummary {
  meta_campaign_id: string;
  name: string;
  objective: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchase_value: number;
  ctr: number | null;
  platform_roas: number | null;
}

interface GoogleCampaignSummary {
  google_campaign_id: string;
  name: string;
  campaign_type: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value: number;
  ctr: number | null;
  platform_roas: number | null;
}

interface BudgetPacing {
  channel: string;
  budget: number;
  spent: number;
  pacing_pct: number;
  projected_spend: number;
  days_elapsed: number;
  days_in_month: number;
}

export interface AdsResponse {
  mer: {
    current: number | null;
    prior: number | null;
    delta: number | null;
    delta_pct: number | null;
    trend: "improving" | "declining" | "stable";
  };
  ncac: {
    current: number | null;
    prior: number | null;
    delta: number | null;
    delta_pct: number | null;
  };
  blended_cpa: number | null;
  spend: {
    total: number;
    meta: number;
    google: number;
    meta_pct: number;
    google_pct: number;
  };
  budgets: BudgetPacing[] | null;
  channels: {
    meta: ChannelStats;
    google: ChannelStats;
  };
  alerts: Alert[];
  top_creatives: MetaCreative[];
  fatigued_creatives: MetaCreative[];
  daily: DailyStats[];
  monthly: MonthlyStats[];
  meta_campaigns: MetaCampaignSummary[];
  google_campaigns: GoogleCampaignSummary[];
  last_synced: {
    meta: string | null;
    google: string | null;
  };
  period: string;
  date_range: {
    start: string;
    end: string;
  };
}

interface PaidMediaDashboardProps {
  data: AdsResponse | null;
  loading: boolean;
  error: string | null;
  period: AdsPeriod;
  onPeriodChange: (period: AdsPeriod) => void;
  onRefresh: () => void;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getPeriodLabel(period: AdsPeriod): string {
  switch (period) {
    case "ttm": return "Last 12 Months";
    case "mtd": return "Month to Date";
    case "last_month": return "Last Month";
    case "qtd": return "Quarter to Date";
    case "ytd": return "Year to Date";
    case "30d": return "Last 30 Days";
    case "90d": return "Last 90 Days";
  }
}

function formatMer(value: number | null): string {
  if (value === null) return "—";
  return `${value.toFixed(2)}x`;
}

function formatDelta(value: number | null, showSign = true): string {
  if (value === null) return "";
  const sign = showSign && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}`;
}

function formatDeltaPct(value: number | null): string {
  if (value === null) return "";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

// ============================================================================
// HERO METRIC CARD
// ============================================================================

function HeroMetric({
  label,
  value,
  delta,
  deltaPct,
  trend,
  benchmark,
  icon: Icon,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaPct?: string;
  trend?: "improving" | "declining" | "stable";
  benchmark?: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const trendColors = {
    improving: "text-status-good",
    declining: "text-status-bad",
    stable: "text-text-muted",
  };

  const TrendIcon = trend === "improving" ? TrendingUp : trend === "declining" ? TrendingDown : Activity;

  return (
    <div className="relative overflow-hidden bg-bg-secondary rounded-xl border border-border/30 p-6">
      <div className="flex items-start justify-between mb-3">
        <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
          {label}
        </div>
        <div className="p-2 rounded-lg bg-accent-blue/10">
          <Icon className="w-4 h-4 text-accent-blue" />
        </div>
      </div>

      <div className="text-3xl font-semibold tracking-tight text-text-primary tabular-nums mb-2">
        {value}
      </div>

      {(delta || deltaPct) && trend && (
        <div className={`flex items-center gap-1.5 text-sm ${trendColors[trend]}`}>
          <TrendIcon className="w-3.5 h-3.5" />
          <span>{deltaPct}</span>
          <span className="text-text-tertiary">vs prior</span>
        </div>
      )}

      {benchmark && (
        <div className="text-xs text-text-tertiary mt-2">
          Benchmark: {benchmark}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// CHANNEL COMPARISON CARD
// ============================================================================

function ChannelCard({
  channel,
  stats,
  spendPct,
  budget,
  onEditBudget,
}: {
  channel: "meta" | "google";
  stats: ChannelStats;
  spendPct: number;
  budget?: BudgetPacing | null;
  onEditBudget?: () => void;
}) {
  const channelConfig = {
    meta: {
      name: "Meta",
      color: "bg-blue-500",
      colorLight: "bg-blue-500/10",
      textColor: "text-blue-400",
      barColor: "bg-blue-500",
    },
    google: {
      name: "Google",
      color: "bg-emerald-500",
      colorLight: "bg-emerald-500/10",
      textColor: "text-emerald-400",
      barColor: "bg-emerald-500",
    },
  };

  const config = channelConfig[channel];

  // Calculate projection status (based on velocity, not linear pacing)
  const getProjectionStatus = () => {
    if (!budget || budget.budget === 0) return null;

    const variance = budget.projected_spend - budget.budget;
    const variancePct = (variance / budget.budget) * 100;

    // Significant over-projection (>10% over budget)
    if (variancePct > 10) {
      return {
        label: `+${formatCurrency(variance)} over`,
        color: "text-status-warning",
        isOver: true,
      };
    }
    // Significant under-projection (>15% under budget)
    if (variancePct < -15) {
      return {
        label: `${formatCurrency(Math.abs(variance))} under`,
        color: "text-amber-400",
        isOver: false,
      };
    }
    // Within tolerance
    return {
      label: "On pace",
      color: "text-status-success",
      isOver: false,
    };
  };

  const projectionStatus = getProjectionStatus();

  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${config.color}`} />
          <span className="text-sm font-medium text-text-primary">{config.name}</span>
        </div>
        <span className="text-xs text-text-muted">{spendPct.toFixed(0)}% of spend</span>
      </div>

      {/* Budget Projection (velocity-based, not linear) */}
      {budget && budget.budget > 0 && (
        <div className="mb-4 pb-4 border-b border-border/20">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] uppercase tracking-[0.15em] text-text-muted">
              Month Projection
            </div>
            {onEditBudget && (
              <button
                onClick={onEditBudget}
                className="text-xs text-text-muted hover:text-text-secondary transition-colors"
              >
                Edit
              </button>
            )}
          </div>

          {/* Projection vs Budget - the key insight */}
          <div className="flex items-baseline justify-between mb-2">
            <div>
              <span className="text-lg font-semibold text-text-primary tabular-nums">
                {formatCurrency(budget.projected_spend)}
              </span>
              <span className="text-xs text-text-muted ml-1">projected</span>
            </div>
            <div className="text-right">
              <span className="text-sm text-text-secondary tabular-nums">
                {formatCurrency(budget.budget)}
              </span>
              <span className="text-xs text-text-muted ml-1">budget</span>
            </div>
          </div>

          {/* Visual: spent portion of budget */}
          <div className="relative h-1.5 bg-bg-tertiary rounded-full overflow-hidden mb-2">
            <div
              className={`absolute top-0 left-0 h-full ${config.barColor} rounded-full transition-all duration-500`}
              style={{ width: `${Math.min(budget.pacing_pct, 100)}%` }}
            />
          </div>

          {/* Status and days remaining */}
          <div className="flex justify-between text-xs">
            <span className="text-text-muted tabular-nums">
              {formatCurrency(budget.spent)} spent · {budget.days_in_month - budget.days_elapsed}d left
            </span>
            {projectionStatus && (
              <span className={`font-medium ${projectionStatus.color}`}>
                {projectionStatus.label}
              </span>
            )}
          </div>
        </div>
      )}

      {/* No budget set message */}
      {(!budget || budget.budget === 0) && onEditBudget && (
        <div className="mb-4 pb-4 border-b border-border/20">
          <button
            onClick={onEditBudget}
            className="w-full py-2 px-3 text-xs text-text-muted bg-bg-tertiary/50 rounded-lg hover:bg-bg-tertiary transition-colors flex items-center justify-center gap-1"
          >
            <DollarSign className="w-3 h-3" />
            Set Monthly Budget
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.15em] text-text-muted mb-1">Spend</div>
          <div className="text-lg font-semibold text-text-primary tabular-nums">
            {formatCurrency(stats.spend)}
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-[0.15em] text-text-muted mb-1">Platform ROAS</div>
          <div className="text-lg font-semibold text-text-primary tabular-nums">
            {stats.platform_roas !== null ? `${stats.platform_roas.toFixed(2)}x` : "—"}
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-[0.15em] text-text-muted mb-1">CPA</div>
          <div className="text-lg font-semibold text-text-primary tabular-nums">
            {stats.cpa !== null ? formatCurrency(stats.cpa) : "—"}
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-[0.15em] text-text-muted mb-1">CPM</div>
          <div className="text-lg font-semibold text-text-primary tabular-nums">
            {formatCurrency(stats.cpm)}
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-[0.15em] text-text-muted mb-1">CTR</div>
          <div className="text-lg font-semibold text-text-primary tabular-nums">
            {stats.ctr.toFixed(2)}%
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-[0.15em] text-text-muted mb-1">Conversions</div>
          <div className="text-lg font-semibold text-text-primary tabular-nums">
            {stats.conversions.toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// ALERT BANNER
// ============================================================================

function AlertBanner({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) return null;

  const criticalAlerts = alerts.filter(a => a.severity === "critical");
  const warningAlerts = alerts.filter(a => a.severity === "warning");

  if (criticalAlerts.length === 0 && warningAlerts.length === 0) return null;

  return (
    <div className="bg-status-warning/10 border border-status-warning/30 rounded-xl p-4 mb-6">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-status-warning flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="text-sm font-medium text-status-warning mb-1">
            {criticalAlerts.length + warningAlerts.length} Alert{criticalAlerts.length + warningAlerts.length !== 1 ? "s" : ""}
          </div>
          <div className="space-y-1">
            {[...criticalAlerts, ...warningAlerts].slice(0, 3).map((alert) => (
              <div key={alert.id} className="text-sm text-text-secondary">
                {alert.title}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// BUDGET MODAL
// ============================================================================

interface BudgetModalProps {
  isOpen: boolean;
  onClose: () => void;
  channel: "meta" | "google";
  currentBudget?: number;
  onSave: (amount: number) => Promise<void>;
}

function BudgetModal({ isOpen, onClose, channel, currentBudget, onSave }: BudgetModalProps) {
  const [amount, setAmount] = useState<string>(currentBudget?.toString() || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setAmount(currentBudget?.toString() || "");
      setError(null);
    }
  }, [isOpen, currentBudget]);

  const handleSave = async () => {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount < 0) {
      setError("Please enter a valid budget amount");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await onSave(numAmount);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save budget");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const channelConfig = {
    meta: { name: "Meta", color: "bg-blue-500" },
    google: { name: "Google", color: "bg-emerald-500" },
  };

  const config = channelConfig[channel];

  // Get current month label
  const now = new Date();
  const monthLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const modalId = `budget-modal-${channel}`;
  const titleId = `budget-modal-title-${channel}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="relative bg-bg-primary border border-border/50 rounded-xl shadow-2xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border/30">
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${config.color}`} aria-hidden="true" />
            <h3 id={titleId} className="text-lg font-medium text-text-primary">
              {config.name} Budget
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close budget dialog"
            className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-accent-blue/50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <Calendar className="w-4 h-4" />
            <span>{monthLabel}</span>
          </div>

          <div>
            <label
              htmlFor={`budget-input-${channel}`}
              className="block text-[10px] uppercase tracking-[0.2em] text-text-muted mb-2"
            >
              Monthly Budget
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true">$</span>
              <input
                id={`budget-input-${channel}`}
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^0-9.]/g, "");
                  setAmount(val);
                }}
                placeholder="0.00"
                aria-describedby={`budget-help-${channel}`}
                className="w-full bg-bg-secondary border border-border/30 rounded-lg pl-8 pr-4 py-3 text-lg text-text-primary tabular-nums focus:outline-none focus:ring-2 focus:ring-accent-blue/50 focus:border-accent-blue/50"
                autoFocus
              />
            </div>
          </div>

          {error && (
            <div className="text-sm text-status-bad bg-status-bad/10 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <p id={`budget-help-${channel}`} className="text-xs text-text-muted">
            Set the planned ad spend for {config.name} this month. This enables pacing visualization to track if spending is on track.
          </p>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-5 border-t border-border/30">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-muted hover:text-text-primary transition-colors rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-blue/50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm bg-accent-blue hover:bg-accent-blue/90 text-white rounded-lg transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-accent-blue/50 focus:ring-offset-2 focus:ring-offset-bg-primary"
          >
            {saving ? "Saving..." : "Save Budget"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// CREATIVE THUMBNAIL GRID
// ============================================================================

function CreativeGrid({
  title,
  creatives,
  showFatigueIndicator,
}: {
  title: string;
  creatives: MetaCreative[];
  showFatigueIndicator?: boolean;
}) {
  if (creatives.length === 0) {
    return (
      <div className="bg-bg-secondary rounded-xl border border-border/30 p-5">
        <div className="text-sm font-medium text-text-primary mb-4">{title}</div>
        <div className="text-sm text-text-muted text-center py-8">
          No creatives to display
        </div>
      </div>
    );
  }

  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30 p-5">
      <div className="text-sm font-medium text-text-primary mb-4">{title}</div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {creatives.map((creative) => (
          <div
            key={creative.meta_ad_id}
            className="relative group"
          >
            {/* Thumbnail */}
            <div className="aspect-square bg-bg-tertiary rounded-lg overflow-hidden border border-border/30">
              {creative.thumbnail_url ? (
                <img
                  src={creative.thumbnail_url}
                  alt={creative.ad_name || "Ad creative"}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <ImageIcon className="w-8 h-8 text-text-muted" />
                </div>
              )}

              {/* Fatigue badge */}
              {showFatigueIndicator && creative.fatigue_severity && (
                <div className={`absolute top-2 right-2 px-2 py-0.5 rounded text-[10px] font-medium ${
                  creative.fatigue_severity === "high"
                    ? "bg-status-bad/90 text-white"
                    : creative.fatigue_severity === "medium"
                    ? "bg-status-warning/90 text-black"
                    : "bg-yellow-500/90 text-black"
                }`}>
                  {creative.fatigue_severity.toUpperCase()}
                </div>
              )}
            </div>

            {/* Stats overlay on hover */}
            <div className="absolute inset-0 bg-black/80 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
              <div className="text-[10px] text-white/80 truncate">
                {creative.ad_name || "Unnamed"}
              </div>
              <div className="text-xs text-white font-medium">
                {formatCurrency(creative.lifetime_spend)} spent
              </div>
              {creative.current_ctr !== null && (
                <div className="text-[10px] text-white/80">
                  CTR: {creative.current_ctr.toFixed(2)}%
                  {creative.ctr_vs_peak !== null && (
                    <span className={creative.ctr_vs_peak < 0.7 ? " text-status-bad" : ""}>
                      {" "}({(creative.ctr_vs_peak * 100).toFixed(0)}% of peak)
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// MONTHLY TREND CHART (HERO)
// ============================================================================

function MonthlyTrendChart({ monthly }: { monthly: MonthlyStats[] }) {
  const chartData = useMemo(() => {
    return [...monthly]
      .sort((a, b) => a.month_start.localeCompare(b.month_start))
      .map((m) => {
        // Parse YYYY-MM-DD as local time to avoid timezone rollover
        const [year, month] = m.month_start.split("-").map(Number);
        const date = new Date(year, month - 1, 1);
        return {
          month: date.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
          spend: m.total_spend,
          revenue: m.shopify_revenue || 0,
          mer: m.mer,
          ncac: m.ncac,
          newCustomers: m.new_customer_count || 0,
          // YoY fields
          merYoY: m.mer_yoy,
          ncacYoY: m.ncac_yoy,
          spendYoY: m.spend_yoy,
          revenueYoY: m.revenue_yoy,
        };
      });
  }, [monthly]);

  if (chartData.length === 0) {
    return (
      <div className="bg-bg-secondary rounded-xl border border-border/30 p-6">
        <div className="text-sm font-medium text-text-primary mb-4">Monthly Performance</div>
        <div className="h-48 flex items-center justify-center text-text-muted">
          No monthly data available
        </div>
      </div>
    );
  }

  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30 p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="text-sm font-medium text-text-primary">Monthly Performance</div>
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-blue-500" />
            <span className="text-text-muted">Spend</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-emerald-500" />
            <span className="text-text-muted">Revenue</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-amber-500" />
            <span className="text-text-muted">MER</span>
          </div>
        </div>
      </div>

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} barCategoryGap="20%">
            <XAxis
              dataKey="month"
              tick={{ fill: "#888", fontSize: 11 }}
              axisLine={{ stroke: "#333" }}
              tickLine={false}
            />
            <YAxis
              yAxisId="left"
              tick={{ fill: "#666", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `$${(v / 1000000).toFixed(1)}M`}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fill: "#666", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${v.toFixed(0)}x`}
              domain={[0, "auto"]}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1a1a1a",
                border: "1px solid #333",
                borderRadius: "8px",
                fontSize: "12px",
              }}
              formatter={(value: number, name: string) => {
                if (name === "mer") return [`${value?.toFixed(2) || "—"}x`, "MER"];
                if (name === "ncac") return [`$${value?.toFixed(2) || "—"}`, "nCAC"];
                if (name === "newCustomers") return [value?.toLocaleString() || "0", "New Customers"];
                return [formatCurrency(value), name === "spend" ? "Spend" : "Revenue"];
              }}
            />
            <Bar
              yAxisId="left"
              dataKey="spend"
              fill="#3b82f6"
              radius={[4, 4, 0, 0]}
              maxBarSize={50}
            />
            <Bar
              yAxisId="left"
              dataKey="revenue"
              fill="#10b981"
              radius={[4, 4, 0, 0]}
              maxBarSize={50}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="mer"
              stroke="#f59e0b"
              strokeWidth={3}
              dot={{ fill: "#f59e0b", strokeWidth: 0, r: 4 }}
              activeDot={{ r: 6 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Monthly Stats Table */}
      <div className="mt-6 border-t border-border/30 pt-4">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-text-muted">
                <th scope="col" className="text-left py-2 font-medium">Month</th>
                <th scope="col" className="text-right py-2 font-medium">Spend</th>
                <th scope="col" className="text-right py-2 font-medium hidden sm:table-cell">Spend YoY</th>
                <th scope="col" className="text-right py-2 font-medium">Revenue</th>
                <th scope="col" className="text-right py-2 font-medium hidden sm:table-cell">Rev YoY</th>
                <th scope="col" className="text-right py-2 font-medium">MER</th>
                <th scope="col" className="text-right py-2 font-medium">MER YoY</th>
                <th scope="col" className="text-right py-2 font-medium">nCAC</th>
                <th scope="col" className="text-right py-2 font-medium">nCAC YoY</th>
              </tr>
            </thead>
            <tbody>
              {chartData.slice().reverse().map((m) => {
                // Helper to format YoY with color
                const formatYoY = (val: number | null, invertColor = false) => {
                  if (val === null) return <span className="text-text-muted">—</span>;
                  const isPositive = val > 0;
                  // For nCAC, lower is better so invert the color logic
                  const isGood = invertColor ? !isPositive : isPositive;
                  return (
                    <span className={isGood ? "text-status-good" : "text-status-critical"}>
                      {isPositive ? "+" : ""}{val.toFixed(0)}%
                    </span>
                  );
                };

                return (
                  <tr key={m.month} className="border-t border-border/10">
                    <td className="py-2 text-text-primary font-medium">{m.month}</td>
                    <td className="py-2 text-right text-text-secondary tabular-nums">{formatCurrency(m.spend)}</td>
                    <td className="py-2 text-right tabular-nums hidden sm:table-cell">{formatYoY(m.spendYoY)}</td>
                    <td className="py-2 text-right text-text-secondary tabular-nums">{formatCurrency(m.revenue)}</td>
                    <td className="py-2 text-right tabular-nums hidden sm:table-cell">{formatYoY(m.revenueYoY)}</td>
                    <td className={`py-2 text-right tabular-nums ${m.mer && m.mer >= 2 ? "text-status-good" : "text-text-secondary"}`}>
                      {m.mer ? `${m.mer.toFixed(2)}x` : "—"}
                    </td>
                    <td className="py-2 text-right tabular-nums">{formatYoY(m.merYoY)}</td>
                    <td className={`py-2 text-right tabular-nums ${m.ncac && m.ncac <= 50 ? "text-status-good" : "text-text-secondary"}`}>
                      {m.ncac ? `$${m.ncac.toFixed(0)}` : "—"}
                    </td>
                    <td className="py-2 text-right tabular-nums">{formatYoY(m.ncacYoY, true)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// SPEND TREND CHART (DAILY - SECONDARY)
// ============================================================================

function SpendTrendChart({ daily, collapsed = false }: { daily: DailyStats[]; collapsed?: boolean }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const chartData = useMemo(() => {
    return daily.map((d) => {
      // Parse YYYY-MM-DD as local time to avoid timezone rollover
      const [year, month, day] = d.date.split("-").map(Number);
      const date = new Date(year, month - 1, day);
      return {
        date: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        meta: d.meta_spend,
        google: d.google_spend,
        revenue: d.shopify_revenue || 0,
        mer: d.mer,
      };
    });
  }, [daily]);

  if (chartData.length === 0) {
    return null;
  }

  if (collapsed && !isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="w-full bg-bg-secondary rounded-xl border border-border/30 p-4 text-left hover:bg-bg-tertiary/50 transition-colors"
      >
        <div className="flex items-center justify-between">
          <div className="text-sm text-text-muted">Daily Breakdown</div>
          <div className="text-xs text-accent-blue">Show {chartData.length} days →</div>
        </div>
      </button>
    );
  }

  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm font-medium text-text-primary">Daily Spend & MER</div>
        {collapsed && (
          <button
            onClick={() => setIsExpanded(false)}
            className="text-xs text-text-muted hover:text-text-primary"
          >
            Collapse
          </button>
        )}
      </div>

      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData}>
            <XAxis
              dataKey="date"
              tick={{ fill: "#666", fontSize: 9 }}
              axisLine={{ stroke: "#333" }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              yAxisId="left"
              tick={{ fill: "#666", fontSize: 9 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fill: "#666", fontSize: 9 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${v.toFixed(0)}x`}
              domain={[0, "auto"]}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1a1a1a",
                border: "1px solid #333",
                borderRadius: "8px",
                fontSize: "11px",
              }}
              formatter={(value: number, name: string) => {
                if (name === "mer") return [`${value?.toFixed(2) || "—"}x`, "MER"];
                return [formatCurrency(value), name === "meta" ? "Meta" : name === "google" ? "Google" : "Revenue"];
              }}
            />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="meta"
              fill="#3b82f6"
              fillOpacity={0.3}
              stroke="#3b82f6"
              strokeWidth={1}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="mer"
              stroke="#f59e0b"
              strokeWidth={2}
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center justify-center gap-6 mt-3 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-blue-500" />
          <span className="text-text-muted">Meta Spend</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-amber-500" />
          <span className="text-text-muted">MER</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// CAMPAIGN TABLE
// ============================================================================

function CampaignTable({ campaigns }: { campaigns: MetaCampaignSummary[] }) {
  const [showAll, setShowAll] = useState(false);
  const displayCampaigns = showAll ? campaigns : campaigns.slice(0, 5);

  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30 overflow-hidden">
      <div className="px-5 py-4 border-b border-border/30">
        <div className="text-sm font-medium text-text-primary">Meta Campaigns</div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/20">
              <th scope="col" className="text-left px-5 py-3 text-[10px] uppercase tracking-[0.15em] text-text-muted font-medium">
                Campaign
              </th>
              <th scope="col" className="text-right px-5 py-3 text-[10px] uppercase tracking-[0.15em] text-text-muted font-medium">
                Spend
              </th>
              <th scope="col" className="text-right px-5 py-3 text-[10px] uppercase tracking-[0.15em] text-text-muted font-medium">
                Revenue
              </th>
              <th scope="col" className="text-right px-5 py-3 text-[10px] uppercase tracking-[0.15em] text-text-muted font-medium">
                ROAS
              </th>
              <th scope="col" className="text-right px-5 py-3 text-[10px] uppercase tracking-[0.15em] text-text-muted font-medium">
                Conv.
              </th>
            </tr>
          </thead>
          <tbody>
            {displayCampaigns.map((campaign) => (
              <tr key={campaign.meta_campaign_id} className="border-b border-border/10 hover:bg-bg-tertiary/50">
                <td className="px-5 py-3">
                  <div className="text-text-primary font-medium truncate max-w-[200px]">
                    {campaign.name}
                  </div>
                  {campaign.objective && (
                    <div className="text-[10px] text-text-muted">{campaign.objective}</div>
                  )}
                </td>
                <td className="text-right px-5 py-3 text-text-primary tabular-nums">
                  {formatCurrency(campaign.spend)}
                </td>
                <td className="text-right px-5 py-3 text-text-primary tabular-nums">
                  {formatCurrency(campaign.purchase_value)}
                </td>
                <td className="text-right px-5 py-3 tabular-nums">
                  <span className={campaign.platform_roas !== null && campaign.platform_roas >= 2 ? "text-status-good" : "text-text-primary"}>
                    {campaign.platform_roas !== null ? `${campaign.platform_roas.toFixed(2)}x` : "—"}
                  </span>
                </td>
                <td className="text-right px-5 py-3 text-text-primary tabular-nums">
                  {campaign.purchases.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {campaigns.length > 5 && (
        <div className="px-5 py-3 border-t border-border/30">
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-xs text-accent-blue hover:underline"
          >
            {showAll ? "Show less" : `Show all ${campaigns.length} campaigns`}
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// GOOGLE CAMPAIGN TABLE
// ============================================================================

function GoogleCampaignTable({ campaigns }: { campaigns: GoogleCampaignSummary[] }) {
  const [showAll, setShowAll] = useState(false);
  const displayCampaigns = showAll ? campaigns : campaigns.slice(0, 5);

  // Campaign type badge colors
  const getTypeColor = (type: string | null): string => {
    switch (type) {
      case "PERFORMANCE_MAX":
        return "bg-purple-500/20 text-purple-400";
      case "SEARCH":
        return "bg-blue-500/20 text-blue-400";
      case "SHOPPING":
        return "bg-green-500/20 text-green-400";
      case "DISPLAY":
        return "bg-amber-500/20 text-amber-400";
      case "VIDEO":
        return "bg-red-500/20 text-red-400";
      case "DEMAND_GEN":
        return "bg-cyan-500/20 text-cyan-400";
      default:
        return "bg-gray-500/20 text-gray-400";
    }
  };

  // Format campaign type for display
  const formatType = (type: string | null): string => {
    if (!type) return "—";
    return type.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  };

  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30 overflow-hidden">
      <div className="px-5 py-4 border-b border-border/30">
        <div className="text-sm font-medium text-text-primary">Google Campaigns</div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/20">
              <th scope="col" className="text-left px-5 py-3 text-[10px] uppercase tracking-[0.15em] text-text-muted font-medium">
                Campaign
              </th>
              <th scope="col" className="text-right px-5 py-3 text-[10px] uppercase tracking-[0.15em] text-text-muted font-medium">
                Spend
              </th>
              <th scope="col" className="text-right px-5 py-3 text-[10px] uppercase tracking-[0.15em] text-text-muted font-medium">
                Revenue
              </th>
              <th scope="col" className="text-right px-5 py-3 text-[10px] uppercase tracking-[0.15em] text-text-muted font-medium">
                ROAS
              </th>
              <th scope="col" className="text-right px-5 py-3 text-[10px] uppercase tracking-[0.15em] text-text-muted font-medium">
                Conv.
              </th>
            </tr>
          </thead>
          <tbody>
            {displayCampaigns.map((campaign) => (
              <tr key={campaign.google_campaign_id} className="border-b border-border/10 hover:bg-bg-tertiary/50">
                <td className="px-5 py-3">
                  <div className="text-text-primary font-medium truncate max-w-[200px]">
                    {campaign.name}
                  </div>
                  {campaign.campaign_type && (
                    <span className={`inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-medium ${getTypeColor(campaign.campaign_type)}`}>
                      {formatType(campaign.campaign_type)}
                    </span>
                  )}
                </td>
                <td className="text-right px-5 py-3 text-text-primary tabular-nums">
                  {formatCurrency(campaign.spend)}
                </td>
                <td className="text-right px-5 py-3 text-text-primary tabular-nums">
                  {formatCurrency(campaign.conversion_value)}
                </td>
                <td className="text-right px-5 py-3 tabular-nums">
                  <span className={campaign.platform_roas !== null && campaign.platform_roas >= 2 ? "text-status-good" : "text-text-primary"}>
                    {campaign.platform_roas !== null ? `${campaign.platform_roas.toFixed(2)}x` : "—"}
                  </span>
                </td>
                <td className="text-right px-5 py-3 text-text-primary tabular-nums">
                  {campaign.conversions.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {campaigns.length > 5 && (
        <div className="px-5 py-3 border-t border-border/30">
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-xs text-accent-blue hover:underline"
          >
            {showAll ? "Show less" : `Show all ${campaigns.length} campaigns`}
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// LOADING STATE
// ============================================================================

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      {/* Hero metrics skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-bg-secondary rounded-xl p-6 h-32">
            <div className="h-3 w-16 bg-bg-tertiary rounded mb-4" />
            <div className="h-8 w-24 bg-bg-tertiary rounded" />
          </div>
        ))}
      </div>

      {/* Channel cards skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[1, 2].map((i) => (
          <div key={i} className="bg-bg-secondary rounded-xl p-5 h-48">
            <div className="h-4 w-20 bg-bg-tertiary rounded mb-6" />
            <div className="grid grid-cols-2 gap-4">
              {[1, 2, 3, 4].map((j) => (
                <div key={j}>
                  <div className="h-2 w-12 bg-bg-tertiary rounded mb-2" />
                  <div className="h-5 w-16 bg-bg-tertiary rounded" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Chart skeleton */}
      <div className="bg-bg-secondary rounded-xl p-5 h-80">
        <div className="h-4 w-32 bg-bg-tertiary rounded mb-4" />
        <div className="h-56 bg-bg-tertiary rounded" />
      </div>
    </div>
  );
}

// ============================================================================
// ERROR STATE
// ============================================================================

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="p-4 rounded-full bg-status-bad/10 mb-4">
        <AlertTriangle className="w-8 h-8 text-status-bad" />
      </div>
      <h3 className="text-lg font-medium text-text-primary mb-2">Failed to Load Data</h3>
      <p className="text-sm text-text-muted mb-2 text-center max-w-md">
        {error}
      </p>
      <p className="text-xs text-text-tertiary mb-6 text-center max-w-md">
        This could be a temporary issue. Try refreshing, or check that your ad platform connections are configured correctly.
      </p>
      <button
        onClick={onRetry}
        className="flex items-center gap-2 px-4 py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:bg-accent-blue/90 transition-colors"
      >
        <RefreshCw className="w-4 h-4" />
        Try Again
      </button>
    </div>
  );
}

// ============================================================================
// EMPTY STATE
// ============================================================================

function EmptyState({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="p-4 rounded-full bg-bg-secondary mb-4">
        <BarChart3 className="w-8 h-8 text-text-muted" />
      </div>
      <h3 className="text-lg font-medium text-text-primary mb-2">No Ad Data Yet</h3>
      <p className="text-sm text-text-muted mb-6 text-center max-w-md">
        Connect your Meta and Google Ads accounts to start tracking performance metrics.
        Once synced, you&apos;ll see MER, nCAC, and channel comparisons here.
      </p>
      <button
        onClick={onRefresh}
        className="px-4 py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:bg-accent-blue/90 transition-colors"
      >
        Refresh Data
      </button>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function PaidMediaDashboard({
  data,
  loading,
  error,
  period,
  onPeriodChange,
  onRefresh,
}: PaidMediaDashboardProps) {
  // Budget modal state
  const [editingChannel, setEditingChannel] = useState<"meta" | "google" | null>(null);

  // Determine last sync time
  const lastSyncTime = useMemo(() => {
    if (!data?.last_synced) return null;
    const metaSync = data.last_synced.meta ? new Date(data.last_synced.meta) : null;
    const googleSync = data.last_synced.google ? new Date(data.last_synced.google) : null;

    if (metaSync && googleSync) {
      return metaSync > googleSync ? metaSync : googleSync;
    }
    return metaSync || googleSync;
  }, [data?.last_synced]);

  // Get budget for a specific channel
  const getBudgetForChannel = (channel: "meta" | "google"): BudgetPacing | null => {
    if (!data?.budgets) return null;
    return data.budgets.find(b => b.channel === channel) || null;
  };

  // Handle saving budget
  const handleSaveBudget = async (amount: number) => {
    if (!editingChannel) return;

    // Get current month in YYYY-MM-DD format
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

    const response = await fetch("/api/ads/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        month,
        channel: editingChannel,
        budget_amount: amount,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to save budget");
    }

    // Refresh data to show updated budget
    onRefresh();
  };

  // Show loading state
  if (loading && !data) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <select
              value={period}
              onChange={(e) => onPeriodChange(e.target.value as AdsPeriod)}
              className="bg-bg-secondary border border-border/30 rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-blue/50"
            >
              <option value="ttm">Last 12 Months</option>
              <option value="mtd">Month to Date</option>
              <option value="last_month">Last Month</option>
              <option value="qtd">Quarter to Date</option>
              <option value="ytd">Year to Date</option>
              <option value="30d">Last 30 Days</option>
              <option value="90d">Last 90 Days</option>
            </select>
          </div>
        </div>

        <LoadingSkeleton />
      </div>
    );
  }

  // Show error state if fetch failed
  if (error && !data) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <select
              value={period}
              onChange={(e) => onPeriodChange(e.target.value as AdsPeriod)}
              className="bg-bg-secondary border border-border/30 rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-blue/50"
            >
              <option value="ttm">Last 12 Months</option>
              <option value="mtd">Month to Date</option>
              <option value="last_month">Last Month</option>
              <option value="qtd">Quarter to Date</option>
              <option value="ytd">Year to Date</option>
              <option value="30d">Last 30 Days</option>
              <option value="90d">Last 90 Days</option>
            </select>
          </div>
        </div>

        <ErrorState error={error} onRetry={onRefresh} />
      </div>
    );
  }

  // Show empty state if no data
  if (!data || (data.spend.total === 0 && data.daily.length === 0)) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <select
              value={period}
              onChange={(e) => onPeriodChange(e.target.value as AdsPeriod)}
              className="bg-bg-secondary border border-border/30 rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-blue/50"
            >
              <option value="ttm">Last 12 Months</option>
              <option value="mtd">Month to Date</option>
              <option value="last_month">Last Month</option>
              <option value="qtd">Quarter to Date</option>
              <option value="ytd">Year to Date</option>
              <option value="30d">Last 30 Days</option>
              <option value="90d">Last 90 Days</option>
            </select>
          </div>

          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 text-sm text-text-muted hover:text-text-primary transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        <EmptyState onRefresh={onRefresh} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <select
            value={period}
            onChange={(e) => onPeriodChange(e.target.value as AdsPeriod)}
            className="bg-bg-secondary border border-border/30 rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-blue/50"
          >
            <option value="ttm">Last 12 Months</option>
            <option value="mtd">Month to Date</option>
            <option value="last_month">Last Month</option>
            <option value="qtd">Quarter to Date</option>
            <option value="ytd">Year to Date</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
          </select>

          <span className="text-xs text-text-muted">
            {data.date_range.start} – {data.date_range.end}
          </span>
        </div>

        <div className="flex items-center gap-4">
          {lastSyncTime && (
            <StaleTimestamp
              date={lastSyncTime}
              staleThreshold={24}
              warningThreshold={4}
              prefix="Synced"
            />
          )}

          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 text-sm text-text-muted hover:text-text-primary transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Alerts */}
      <AlertBanner alerts={data.alerts} />

      {/* Hero Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <HeroMetric
          label="MER"
          value={formatMer(data.mer.current)}
          delta={formatDelta(data.mer.delta)}
          deltaPct={formatDeltaPct(data.mer.delta_pct)}
          trend={data.mer.trend}
          benchmark="2.0x is healthy"
          icon={Target}
        />

        <HeroMetric
          label="nCAC"
          value={data.ncac.current !== null ? formatCurrency(data.ncac.current) : "—"}
          delta={data.ncac.delta !== null ? formatCurrency(data.ncac.delta) : undefined}
          deltaPct={formatDeltaPct(data.ncac.delta_pct)}
          trend={data.ncac.delta_pct !== null ? (data.ncac.delta_pct < 0 ? "improving" : data.ncac.delta_pct > 0 ? "declining" : "stable") : "stable"}
          icon={Users}
        />

        <HeroMetric
          label="Total Spend"
          value={formatCurrency(data.spend.total)}
          icon={DollarSign}
        />
      </div>

      {/* Channel Comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ChannelCard
          channel="meta"
          stats={data.channels.meta}
          spendPct={data.spend.meta_pct}
          budget={getBudgetForChannel("meta")}
          onEditBudget={() => setEditingChannel("meta")}
        />
        <ChannelCard
          channel="google"
          stats={data.channels.google}
          spendPct={data.spend.google_pct}
          budget={getBudgetForChannel("google")}
          onEditBudget={() => setEditingChannel("google")}
        />
      </div>

      {/* Budget Modal */}
      <BudgetModal
        isOpen={editingChannel !== null}
        onClose={() => setEditingChannel(null)}
        channel={editingChannel || "meta"}
        currentBudget={editingChannel ? getBudgetForChannel(editingChannel)?.budget : undefined}
        onSave={handleSaveBudget}
      />

      {/* Monthly Performance (HERO) */}
      <MonthlyTrendChart monthly={data.monthly} />

      {/* Daily Breakdown (Collapsible) */}
      <SpendTrendChart daily={data.daily} collapsed />

      {/* Creative Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CreativeGrid
          title="Top Performing Creatives"
          creatives={data.top_creatives}
        />
        <CreativeGrid
          title="Fatigued Creatives (Needs Refresh)"
          creatives={data.fatigued_creatives}
          showFatigueIndicator
        />
      </div>

      {/* Campaign Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {data.meta_campaigns.length > 0 && (
          <CampaignTable campaigns={data.meta_campaigns} />
        )}
        {data.google_campaigns.length > 0 && (
          <GoogleCampaignTable campaigns={data.google_campaigns} />
        )}
      </div>
    </div>
  );
}
