"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Clock,
  Package,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  ShoppingCart,
  Building2,
  UserX,
  X,
  AlertCircle,
  Flame,
  Calendar,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { getAuthHeaders } from "@/lib/auth";
import type {
  CustomerDetailResponse,
  CustomerSegment,
  CustomerHealthStatus,
} from "@/lib/types";

// ============================================================================
// DESIGN TOKENS - Industrial Craftsman Theme
// ============================================================================

const FORGE_COLORS = {
  cool: "#64748B",      // Iron - cold
  warm: "#D97706",      // Copper - warming
  hot: "#EA580C",       // Ember - hot
  glow: "#FCD34D",      // Glow - urgent
};

// ============================================================================
// BADGE COMPONENTS
// ============================================================================

// Accept string to handle legacy DB values during migration transition
function SegmentBadge({ segment, isCorporate }: { segment: string; isCorporate?: boolean }) {
  if (isCorporate) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-wider px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">
        <Building2 className="w-3 h-3" />
        CORPORATE
      </span>
    );
  }

  // Updated 2026-01-15: Simplified to 3-tier system (Major/Mid/Small)
  // Fallback: map legacy segments from DB until migration completes
  const rawSegment = segment as string;
  const normalizedSegment: CustomerSegment =
    rawSegment === "large" ? "major" :
    rawSegment === "starter" || rawSegment === "minimal" ? "small" :
    (segment as CustomerSegment);

  const config: Record<CustomerSegment, { label: string; bg: string; text: string; border: string }> = {
    major: { label: "MAJOR", bg: "bg-status-good/10", text: "text-status-good", border: "border-status-good/20" },
    mid: { label: "MID", bg: "bg-accent-blue/10", text: "text-accent-blue", border: "border-accent-blue/20" },
    small: { label: "SMALL", bg: "bg-text-muted/10", text: "text-text-secondary", border: "border-text-muted/20" },
  };
  const { label, bg, text, border } = config[normalizedSegment] || config.small;
  return (
    <span className={`text-[10px] font-bold tracking-wider px-2.5 py-1 rounded-full ${bg} ${text} border ${border}`}>
      {label}
    </span>
  );
}

function HealthBadge({ status }: { status: CustomerHealthStatus }) {
  const config: Record<CustomerHealthStatus, { label: string; bg: string; text: string; border: string; pulse?: boolean }> = {
    thriving: { label: "THRIVING", bg: "bg-status-good/10", text: "text-status-good", border: "border-status-good/20" },
    stable: { label: "STABLE", bg: "bg-accent-blue/10", text: "text-accent-blue", border: "border-accent-blue/20" },
    declining: { label: "DECLINING", bg: "bg-status-warning/10", text: "text-status-warning", border: "border-status-warning/20" },
    at_risk: { label: "AT RISK", bg: "bg-status-bad/10", text: "text-status-bad", border: "border-status-bad/20", pulse: true },
    churning: { label: "CHURNING", bg: "bg-status-bad/10", text: "text-status-bad", border: "border-status-bad/20", pulse: true },
    churned: { label: "CHURNED", bg: "bg-text-muted/10", text: "text-text-muted", border: "border-text-muted/20" },
    new: { label: "NEW", bg: "bg-status-good/10", text: "text-status-good", border: "border-status-good/20" },
    one_time: { label: "ONE-TIME", bg: "bg-purple-400/10", text: "text-purple-400", border: "border-purple-400/20" },
  };
  const { label, bg, text, border, pulse } = config[status] || { label: status, bg: "bg-text-muted/10", text: "text-text-muted", border: "border-text-muted/20" };
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold tracking-wider px-2.5 py-1 rounded-full ${bg} ${text} border ${border} ${pulse ? "animate-pulse" : ""}`}>
      {pulse && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
      {label}
    </span>
  );
}

// ============================================================================
// CONFIRMATION DIALOG - Refined
// ============================================================================

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel: string;
  confirmColor: "red" | "amber";
  isLoading?: boolean;
}

function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  confirmColor,
  isLoading,
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop with blur */}
      <div
        className="absolute inset-0 bg-bg-primary/80 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative bg-bg-secondary border border-border/40 rounded-2xl p-8 max-w-md w-full shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          className="absolute top-6 right-6 text-text-muted hover:text-text-primary transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-start gap-5">
          <div className={`p-3 rounded-xl ${confirmColor === "red" ? "bg-status-bad/10" : "bg-amber-500/10"}`}>
            <AlertCircle className={`w-6 h-6 ${confirmColor === "red" ? "text-status-bad" : "text-amber-500"}`} />
          </div>
          <div className="flex-1">
            <h3 className="text-xl font-semibold text-text-primary mb-2 tracking-tight">{title}</h3>
            <p className="text-sm text-text-secondary leading-relaxed">{message}</p>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-8">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded-lg transition-all"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className={`px-5 py-2.5 text-sm font-semibold text-white rounded-lg transition-all disabled:opacity-50 ${
              confirmColor === "red"
                ? "bg-status-bad hover:bg-status-bad/90"
                : "bg-amber-500 hover:bg-amber-500/90"
            }`}
          >
            {isLoading ? "Updating..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(dateString: string | null): string {
  if (!dateString) return "—";
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ============================================================================
// FORGE HEAT METER - Order Cadence Visualization
// ============================================================================

interface ForgeHeatMeterProps {
  avgInterval: number | null;     // EWMA - user-facing "Typical" (adapts to recent)
  medianInterval: number | null;  // Historical median - all-time baseline
  intervalRangeHigh: number | null; // P75 - conservative overdue threshold
  daysSinceLast: number | null;
  expectedDate: string | null;
}

function ForgeHeatMeter({ avgInterval, medianInterval, intervalRangeHigh, daysSinceLast, expectedDate }: ForgeHeatMeterProps) {
  if (!avgInterval || daysSinceLast === null) {
    return (
      <div className="flex items-center gap-3 text-sm text-text-muted">
        <Clock className="w-4 h-4" />
        <span>Not enough order history</span>
      </div>
    );
  }

  // Calculate heat level (0-100+)
  const heatRatio = daysSinceLast / avgInterval;
  const heatLevel = Math.min(heatRatio * 100, 150);
  const isOverdue = heatRatio > 1;
  const isUrgent = heatRatio > 1.5;

  // Determine gradient color based on heat
  const getHeatColor = () => {
    if (heatRatio < 0.5) return FORGE_COLORS.cool;
    if (heatRatio < 0.8) return FORGE_COLORS.warm;
    if (heatRatio < 1.2) return FORGE_COLORS.hot;
    return FORGE_COLORS.glow;
  };

  const getStatusText = () => {
    if (heatRatio < 0.5) return "Cool";
    if (heatRatio < 0.8) return "Warming";
    if (heatRatio < 1) return "Due Soon";
    if (heatRatio < 1.5) return "Overdue";
    return "Critical";
  };

  return (
    <div className="space-y-4">
      {/* Heat bar container */}
      <div className="relative">
        {/* Background track */}
        <div className="h-3 bg-bg-tertiary rounded-full overflow-hidden">
          {/* Heat fill with gradient */}
          <div
            className="h-full rounded-full transition-all duration-700 ease-out relative overflow-hidden"
            style={{
              width: `${Math.min(heatLevel, 100)}%`,
              background: `linear-gradient(90deg, ${FORGE_COLORS.cool} 0%, ${getHeatColor()} 100%)`,
            }}
          >
            {/* Animated glow for urgent states */}
            {isUrgent && (
              <div
                className="absolute inset-0 animate-pulse"
                style={{
                  background: `linear-gradient(90deg, transparent 60%, ${FORGE_COLORS.glow}40 100%)`,
                }}
              />
            )}
          </div>
        </div>

        {/* Expected marker at 100% */}
        <div className="absolute top-0 right-0 flex flex-col items-center" style={{ right: 0 }}>
          <div className="w-0.5 h-5 bg-text-muted/30" />
        </div>

        {/* Tick marks */}
        <div className="absolute top-0 left-0 right-0 flex justify-between px-0 pointer-events-none">
          {[0, 25, 50, 75, 100].map((tick) => (
            <div key={tick} className="flex flex-col items-center">
              <div className="w-px h-1.5 bg-text-muted/20" />
            </div>
          ))}
        </div>
      </div>

      {/* Status row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame
            className="w-4 h-4 transition-colors"
            style={{ color: getHeatColor() }}
          />
          <span className="text-sm font-medium" style={{ color: getHeatColor() }}>
            {getStatusText()}
          </span>
        </div>
        <div className="text-right">
          <div className={`text-sm font-semibold tabular-nums ${isOverdue ? "text-status-bad" : "text-text-primary"}`}>
            {daysSinceLast} days since last order
          </div>
          <div className="text-xs text-text-muted">
            Typical: {avgInterval} days
          </div>
        </div>
      </div>

      {/* Expected date */}
      {expectedDate && (
        <div className="flex items-center gap-2 text-xs text-text-muted pt-2 border-t border-border/10">
          <Calendar className="w-3.5 h-3.5" />
          <span>Expected by {formatDate(expectedDate)}</span>
        </div>
      )}

      {/* Interval Comparison - All Three Measurements */}
      {(medianInterval || intervalRangeHigh) && (
        <div className="mt-5 pt-4 border-t border-border/10">
          <div className="text-[9px] uppercase tracking-[0.15em] text-text-muted font-medium mb-3">
            Interval Analysis
          </div>
          <div className="grid grid-cols-3 gap-3">
            {/* Historical Median */}
            <div className="bg-bg-tertiary/50 rounded-lg px-3 py-2.5">
              <div className="text-[9px] uppercase tracking-wider text-text-muted mb-1">
                Historical
              </div>
              <div className="text-lg font-bold tabular-nums text-text-secondary">
                {medianInterval ?? "—"}
                <span className="text-xs font-normal text-text-muted ml-0.5">d</span>
              </div>
            </div>
            {/* EWMA - Hero */}
            <div className="bg-forge-copper/10 rounded-lg px-3 py-2.5 ring-1 ring-forge-copper/20">
              <div className="text-[9px] uppercase tracking-wider text-forge-copper mb-1">
                Typical
              </div>
              <div className="text-lg font-bold tabular-nums text-text-primary">
                {avgInterval}
                <span className="text-xs font-normal text-text-muted ml-0.5">d</span>
              </div>
            </div>
            {/* P75 - Conservative */}
            <div className="bg-bg-tertiary/50 rounded-lg px-3 py-2.5">
              <div className="text-[9px] uppercase tracking-wider text-text-muted mb-1">
                Conservative
              </div>
              <div className="text-lg font-bold tabular-nums text-text-secondary">
                {intervalRangeHigh ?? "—"}
                <span className="text-xs font-normal text-text-muted ml-0.5">d</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SPARKLINE CHART - Minimal Revenue Trend
// ============================================================================

interface SparklineChartProps {
  orderHistory: Array<{
    tran_date: string;
    foreign_total: number;
  }>;
}

function SparklineChart({ orderHistory }: SparklineChartProps) {
  const chartData = useMemo(() => {
    // Generate actual last 24 months from today (covers both T12 and Prior T12 periods)
    const months: { month: string; revenue: number }[] = [];
    const now = new Date();

    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      months.push({ month: key, revenue: 0 });
    }

    // Fill in actual revenue for months that have orders
    orderHistory.forEach((order) => {
      const date = new Date(order.tran_date);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const monthEntry = months.find((m) => m.month === key);
      if (monthEntry) {
        monthEntry.revenue += Math.round(order.foreign_total);
      }
    });

    return months;
  }, [orderHistory]);

  // Calculate max for Y domain (ensure minimum of 100 so flat $0 line shows properly)
  const maxRevenue = Math.max(...chartData.map((d) => d.revenue), 100);

  return (
    <div className="h-24">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <AreaChart data={chartData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="sparklineGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#D97706" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#D97706" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="month" hide />
          <YAxis hide domain={[0, maxRevenue]} />
          <Tooltip
            contentStyle={{
              backgroundColor: "#12151F",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "8px",
              fontSize: "11px",
              padding: "8px 12px",
            }}
            formatter={(value: number) => [formatCurrency(value), "Revenue"]}
            labelFormatter={(label) => {
              const [year, month] = String(label).split("-");
              const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
              return `${months[parseInt(month) - 1]} ${year}`;
            }}
          />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="#D97706"
            strokeWidth={2}
            fill="url(#sparklineGrad)"
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ============================================================================
// PRODUCT MIX BARS - Horizontal with Forge Gradient
// ============================================================================

interface ProductMixBarsProps {
  productMix: Array<{
    sku: string;
    total_units: number;
    total_revenue: number;
    last_purchased: string | null;
  }>;
}

function ProductMixBars({ productMix }: ProductMixBarsProps) {
  const maxRevenue = Math.max(...productMix.map((p) => p.total_revenue));
  const topProducts = productMix.slice(0, 7);

  return (
    <div className="space-y-3">
      {topProducts.map((product, idx) => {
        const percentage = (product.total_revenue / maxRevenue) * 100;
        const opacity = 1 - (idx * 0.1);

        return (
          <div key={product.sku} className="group">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] font-bold text-text-muted tabular-nums w-4">
                  {idx + 1}
                </span>
                <span className="text-sm text-text-primary font-medium truncate">
                  {product.sku}
                </span>
              </div>
              <div className="flex items-center gap-4 flex-shrink-0">
                <span className="text-xs text-text-muted tabular-nums">
                  {product.total_units.toLocaleString()} units
                </span>
                <span className="text-sm font-semibold text-text-primary tabular-nums w-20 text-right">
                  {formatCurrency(product.total_revenue)}
                </span>
              </div>
            </div>
            <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500 group-hover:brightness-110"
                style={{
                  width: `${percentage}%`,
                  background: `linear-gradient(90deg, ${FORGE_COLORS.warm} 0%, ${FORGE_COLORS.hot} 100%)`,
                  opacity,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// STAT CARD - Large Metric Display
// ============================================================================

interface StatCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  trend?: number | null;
  large?: boolean;
}

function StatCard({ label, value, subValue, trend, large }: StatCardProps) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-[0.15em] text-text-muted font-medium">
        {label}
      </div>
      <div className={`font-bold text-text-primary tabular-nums tracking-tight ${large ? "text-3xl" : "text-xl"}`}>
        {value}
      </div>
      {subValue && (
        <div className="text-xs text-text-muted">{subValue}</div>
      )}
      {trend !== undefined && trend !== null && (
        <div className={`flex items-center gap-1 text-xs font-medium ${trend >= 0 ? "text-status-good" : "text-status-bad"}`}>
          {trend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {trend >= 0 ? "+" : ""}{trend}%
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN PAGE COMPONENT
// ============================================================================

export default function CustomerDetailPage() {
  const params = useParams();
  const customerId = params.id as string;

  const [data, setData] = useState<CustomerDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    type: "churned" | "corporate";
    currentValue: boolean;
  }>({ isOpen: false, type: "churned", currentValue: false });

  // Fetch customer data
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/wholesale/customer/${customerId}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        throw new Error(res.status === 404 ? "Customer not found" : "Failed to load customer");
      }
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load customer");
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Update customer status
  const updateStatus = async (field: "is_manually_churned" | "is_corporate_gifting", value: boolean) => {
    if (!data) return;
    try {
      setUpdating(true);
      const res = await fetch(`/api/wholesale/customer/${customerId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error("Failed to update");
      await fetchData();
      setConfirmDialog({ isOpen: false, type: "churned", currentValue: false });
    } catch {
      setError("Failed to update customer");
    } finally {
      setUpdating(false);
    }
  };

  const handleChurnedClick = () => {
    if (!data) return;
    setConfirmDialog({
      isOpen: true,
      type: "churned",
      currentValue: data.customer.is_manually_churned || false,
    });
  };

  const handleCorporateClick = () => {
    if (!data) return;
    setConfirmDialog({
      isOpen: true,
      type: "corporate",
      currentValue: data.customer.is_corporate_gifting,
    });
  };

  const handleConfirm = () => {
    if (confirmDialog.type === "churned") {
      updateStatus("is_manually_churned", !confirmDialog.currentValue);
    } else {
      updateStatus("is_corporate_gifting", !confirmDialog.currentValue);
    }
  };

  const getDialogContent = () => {
    if (confirmDialog.type === "churned") {
      if (confirmDialog.currentValue) {
        return {
          title: "Remove Churned Status",
          message: "This will restore the customer to active status. They will appear in ordering anomaly alerts again.",
          confirmLabel: "Remove Churned Status",
        };
      }
      return {
        title: "Mark as Churned",
        message: "This customer will be removed from ordering anomaly alerts. Use this for customers who have permanently stopped ordering.",
        confirmLabel: "Mark as Churned",
      };
    }
    if (confirmDialog.currentValue) {
      return {
        title: "Remove Corporate Status",
        message: "This will reclassify the customer as standard B2B wholesale. They will be included in regular metrics.",
        confirmLabel: "Remove Corporate Status",
      };
    }
    return {
      title: "Mark as Corporate",
      message: "Corporate gifting customers have different buying patterns. They will be excluded from B2B metrics like AOV and order frequency.",
      confirmLabel: "Mark as Corporate",
    };
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-forge-copper/30 border-t-forge-copper rounded-full animate-spin" />
          <div className="text-sm text-text-muted">Loading customer...</div>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
        <div className="p-4 rounded-xl bg-status-bad/10">
          <AlertTriangle className="w-8 h-8 text-status-bad" />
        </div>
        <div className="text-center">
          <div className="text-lg font-semibold text-text-primary mb-1">{error || "Customer not found"}</div>
          <div className="text-sm text-text-muted">The customer you&apos;re looking for doesn&apos;t exist or has been removed.</div>
        </div>
        <Link
          href="/sales"
          className="flex items-center gap-2 text-sm font-medium text-accent-blue hover:text-accent-blue/80 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Sales
        </Link>
      </div>
    );
  }

  const { customer, orderingPattern, revenueTrend, productMix, orderHistory } = data;

  const overdueRatio = orderingPattern.overdue_ratio;
  const isOverdue = overdueRatio !== null && overdueRatio > 1;

  const dialogContent = getDialogContent();

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog({ isOpen: false, type: "churned", currentValue: false })}
        onConfirm={handleConfirm}
        title={dialogContent.title}
        message={dialogContent.message}
        confirmLabel={dialogContent.confirmLabel}
        confirmColor={confirmDialog.type === "churned" ? "red" : "amber"}
        isLoading={updating}
      />

      {/* Navigation Bar */}
      <div className="flex items-center justify-between py-2">
        <Link
          href="/sales"
          className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          Back to Sales
        </Link>

        <div className="flex items-center gap-2">
          <button
            onClick={handleChurnedClick}
            disabled={updating}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              customer.is_manually_churned
                ? "bg-text-muted/10 text-text-muted border border-text-muted/20"
                : "bg-status-bad/10 text-status-bad border border-status-bad/20 hover:bg-status-bad/20"
            }`}
          >
            <UserX className="w-4 h-4" />
            {customer.is_manually_churned ? "Marked Churned" : "Mark as Churned"}
          </button>

          <button
            onClick={handleCorporateClick}
            disabled={updating}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              customer.is_corporate_gifting
                ? "bg-amber-500/15 text-amber-400 border border-amber-500/20"
                : "bg-amber-500/10 text-amber-500 border border-amber-500/20 hover:bg-amber-500/20"
            }`}
          >
            <Building2 className="w-4 h-4" />
            {customer.is_corporate_gifting ? "Corporate Customer" : "Mark as Corporate"}
          </button>
        </div>
      </div>

      {/* Hero Section */}
      <div className="bg-bg-secondary rounded-2xl border border-border/30 overflow-hidden">
        <div className="p-8">
          {/* Company Name + Badges */}
          <div className="flex items-start justify-between gap-6 mb-8">
            <div>
              <h1 className="text-3xl font-bold text-text-primary tracking-tight mb-3">
                {customer.company_name}
              </h1>
              <div className="flex items-center gap-2 flex-wrap">
                <SegmentBadge segment={customer.segment} isCorporate={customer.is_corporate_gifting} />
                <HealthBadge status={customer.health_status} />
                {customer.is_manually_churned && (
                  <span className="text-[10px] font-bold tracking-wider px-2.5 py-1 rounded-full bg-text-muted/10 text-text-muted border border-text-muted/20">
                    MANUALLY CHURNED
                  </span>
                )}
              </div>
            </div>

            {/* Overdue Hero Metric */}
            {overdueRatio !== null && (
              <div className="text-right">
                <div className={`text-4xl font-black tabular-nums tracking-tight ${isOverdue ? "text-status-bad" : "text-status-good"}`}>
                  {overdueRatio.toFixed(1)}x
                </div>
                <div className={`text-sm font-semibold uppercase tracking-wide ${isOverdue ? "text-status-bad/80" : "text-status-good/80"}`}>
                  {isOverdue ? "LATE" : "ON PACE"}
                </div>
                {orderingPattern.expected_order_date && (
                  <div className="text-xs text-text-muted mt-1">
                    Expected {formatDate(orderingPattern.expected_order_date)}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 pt-6 border-t border-border/20">
            <StatCard
              label="Lifetime Revenue"
              value={formatCurrency(revenueTrend.total_revenue)}
              large
            />
            <StatCard
              label="Total Orders"
              value={revenueTrend.order_count}
              subValue={`${revenueTrend.avg_order_value ? formatCurrency(revenueTrend.avg_order_value) : "—"} avg`}
            />
            <StatCard
              label="Customer Since"
              value={orderingPattern.first_order_date
                ? new Date(orderingPattern.first_order_date).getFullYear().toString()
                : "—"
              }
              subValue={orderingPattern.customer_tenure_years
                ? `${orderingPattern.customer_tenure_years} years`
                : undefined
              }
            />
            <StatCard
              label="T12 Revenue"
              value={formatCurrency(revenueTrend.t12_revenue)}
              trend={revenueTrend.yoy_change_pct}
            />
          </div>
        </div>
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Order Cadence - Forge Heat Meter */}
        <div className="bg-bg-secondary rounded-2xl border border-border/30 p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 rounded-lg bg-forge-copper/10">
              <Flame className="w-4 h-4 text-forge-copper" />
            </div>
            <h2 className="text-xs uppercase tracking-[0.2em] text-text-muted font-semibold">
              Order Cadence
            </h2>
          </div>

          <ForgeHeatMeter
            avgInterval={orderingPattern.avg_order_interval_days}
            medianInterval={orderingPattern.median_interval_days}
            intervalRangeHigh={orderingPattern.interval_range_high}
            daysSinceLast={orderingPattern.days_since_last_order}
            expectedDate={orderingPattern.expected_order_date}
          />

          {/* Pattern Details */}
          <div className="grid grid-cols-2 gap-4 mt-6 pt-6 border-t border-border/10">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Last Order</div>
              <div className="text-sm font-medium text-text-primary">{formatDate(orderingPattern.last_order_date)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">First Order</div>
              <div className="text-sm font-medium text-text-primary">{formatDate(orderingPattern.first_order_date)}</div>
            </div>
          </div>
        </div>

        {/* Revenue Trend with Sparkline */}
        <div className="bg-bg-secondary rounded-2xl border border-border/30 p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 rounded-lg bg-accent-blue/10">
              <TrendingUp className="w-4 h-4 text-accent-blue" />
            </div>
            <h2 className="text-xs uppercase tracking-[0.2em] text-text-muted font-semibold">
              Revenue Trend
            </h2>
          </div>

          {/* T12 Comparison */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
                Last 12 Mo
              </div>
              <div className="text-2xl font-bold text-text-primary tabular-nums">
                {formatCurrency(revenueTrend.t12_revenue)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
                Prior 12 Mo
              </div>
              <div className="text-2xl font-bold text-text-secondary tabular-nums">
                {formatCurrency(revenueTrend.prior_t12_revenue)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
                YoY Change
              </div>
              {revenueTrend.yoy_change_pct !== null ? (
                <div className={`text-2xl font-bold tabular-nums flex items-center gap-1 ${
                  revenueTrend.yoy_change_pct >= 0 ? "text-status-good" : "text-status-bad"
                }`}>
                  {revenueTrend.yoy_change_pct >= 0 ? "+" : ""}{revenueTrend.yoy_change_pct}%
                </div>
              ) : (
                <div className="text-2xl font-bold text-text-muted">—</div>
              )}
            </div>
          </div>

          {/* Sparkline */}
          <div className="pt-4 border-t border-border/10">
            <div className="text-[10px] uppercase tracking-wider text-text-muted mb-3">
              Trailing 24 Months
            </div>
            <SparklineChart orderHistory={orderHistory} />
          </div>
        </div>
      </div>

      {/* Product Mix */}
      {productMix.length > 0 && (
        <div className="bg-bg-secondary rounded-2xl border border-border/30 p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 rounded-lg bg-forge-ember/10">
              <Package className="w-4 h-4 text-forge-ember" />
            </div>
            <h2 className="text-xs uppercase tracking-[0.2em] text-text-muted font-semibold">
              Top Products
            </h2>
            <span className="text-xs text-text-muted ml-auto">
              {productMix.length} products purchased
            </span>
          </div>

          <ProductMixBars productMix={productMix} />
        </div>
      )}

      {/* Order History */}
      {orderHistory.length > 0 && (
        <div className="bg-bg-secondary rounded-2xl border border-border/30 overflow-hidden">
          <div className="px-6 py-4 border-b border-border/20 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent-cyan/10">
              <ShoppingCart className="w-4 h-4 text-accent-cyan" />
            </div>
            <h2 className="text-xs uppercase tracking-[0.2em] text-text-muted font-semibold">
              Recent Orders
            </h2>
            <span className="text-xs text-text-muted ml-auto">
              Last {Math.min(orderHistory.length, 20)} orders
            </span>
          </div>

          <div className="divide-y divide-border/10 max-h-[400px] overflow-y-auto scrollbar-thin">
            {orderHistory.map((order, idx) => (
              <div
                key={order.ns_transaction_id}
                className="flex items-center justify-between px-6 py-4 hover:bg-white/[0.02] transition-colors"
                style={{ animationDelay: `${idx * 30}ms` }}
              >
                <div className="flex items-center gap-6">
                  <div className="text-sm font-medium text-text-primary tabular-nums">
                    {formatDate(order.tran_date)}
                  </div>
                  <div className="text-sm text-text-muted font-mono">
                    {order.tran_id}
                  </div>
                </div>
                <div className="text-sm font-semibold text-text-primary tabular-nums">
                  {formatCurrency(order.foreign_total)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {productMix.length === 0 && orderHistory.length === 0 && (
        <div className="bg-bg-secondary rounded-2xl border border-border/30 p-12 text-center">
          <div className="p-4 rounded-xl bg-text-muted/10 w-fit mx-auto mb-4">
            <AlertTriangle className="w-8 h-8 text-text-muted" />
          </div>
          <div className="text-lg font-semibold text-text-primary mb-1">No Purchase History</div>
          <div className="text-sm text-text-muted">This customer doesn&apos;t have any recorded transactions yet.</div>
        </div>
      )}
    </div>
  );
}
