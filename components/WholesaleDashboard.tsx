"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";
import {
  Building2,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronUp,
  Users,
  DollarSign,
  ShoppingCart,
  AlertTriangle,
  BarChart3,
  Sparkles,
  Target,
  Activity,
  AlertCircle,
  CheckCircle,
  Clock,
  Layers,
  RefreshCw,
  UserPlus,
  UserMinus,
  Package,
  Receipt,
} from "lucide-react";
import {
  AreaChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ComposedChart,
  Line,
  Cell,
  PieChart,
  Pie,
} from "recharts";
import type {
  WholesaleResponse,
  WholesaleCustomer,
  WholesaleAtRiskCustomer,
  WholesaleNeverOrderedCustomer,
  WholesaleOrderingAnomaly,
  OrderingAnomalySeverity,
  WholesaleMonthlyStats,
  WholesalePeriod,
  CustomerHealthStatus,
  CustomerSegment,
  WholesaleTransaction,
  WholesaleSkuStats,
  WholesaleSegmentDistribution,
  WholesaleNewCustomerAcquisition,
} from "@/lib/types";
import type { ChurnPrediction, PatternInsightsResponse } from "@/lib/types";

type SortField = "revenue" | "orders" | "last_order" | "company";
type SortDirection = "asc" | "desc";

interface WholesaleDashboardProps {
  data: WholesaleResponse | null;
  loading: boolean;
  period: WholesalePeriod;
  onPeriodChange: (period: WholesalePeriod) => void;
  onRefresh: () => void;
}

// ============================================================================
// FORMATTING UTILITIES
// ============================================================================

function formatCurrency(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(2)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatCurrencyFull(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatPct(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

// ============================================================================
// PERIOD LABELS
// ============================================================================

function getPeriodLabel(period: WholesalePeriod): string {
  switch (period) {
    case "mtd": return "Month to Date";
    case "last_month": return "Last Month";
    case "qtd": return "Quarter to Date";
    case "ytd": return "Year to Date";
    case "30d": return "Last 30 Days";
    case "90d": return "Last 90 Days";
    case "12m": return "Last 12 Months";
  }
}

// ============================================================================
// TOOLTIP COMPONENT
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
      {/* Tooltip container */}
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
        {/* Tooltip body */}
        <div className="relative">
          {/* Main pill */}
          <div
            className="px-3.5 py-1.5 rounded-full"
            style={{
              background: '#151515',
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 2px 12px rgba(0,0,0,0.4)'
            }}
          >
            <span className="text-[11px] font-medium text-white/95 whitespace-nowrap">
              {content}
            </span>
          </div>

          {/* Arrow - SVG for crisp edges */}
          <svg
            className="absolute left-1/2 -translate-x-1/2"
            width="10"
            height="5"
            viewBox="0 0 10 5"
            style={isTop ? { top: '100%', marginTop: '-0.5px' } : { bottom: '100%', marginBottom: '-0.5px', transform: 'translateX(-50%) rotate(180deg)' }}
          >
            <path
              d="M0 0 L5 5 L10 0"
              fill="#151515"
              stroke="rgba(255,255,255,0.1)"
              strokeWidth="1"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// SEGMENT / HEALTH BADGES
// ============================================================================

function SegmentBadge({ segment, isCorporate }: { segment: CustomerSegment; isCorporate?: boolean }) {
  // Corporate customers get CORP badge instead of segment badge
  if (isCorporate) {
    return (
      <InfoTooltip content="Corporate Gifting Customer">
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded cursor-help bg-amber-500/20 text-amber-400">
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
      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded cursor-help ${color}`}>
        {label}
      </span>
    </InfoTooltip>
  );
}

function HealthBadge({ status, isCorporate }: { status: CustomerHealthStatus; isCorporate?: boolean }) {
  // Corporate customers get CORP badge instead of health status - it overrides all other types
  if (isCorporate) {
    return (
      <div className="flex items-center gap-1 text-amber-400">
        <Building2 className="w-3 h-3" />
        <span className="text-[10px] font-medium">Corporate</span>
      </div>
    );
  }

  const config: Record<CustomerHealthStatus, { label: string; color: string; icon: React.ReactNode }> = {
    thriving: { label: "Thriving", color: "text-status-good", icon: <TrendingUp className="w-3 h-3" /> },
    stable: { label: "Stable", color: "text-accent-blue", icon: <CheckCircle className="w-3 h-3" /> },
    declining: { label: "Declining", color: "text-status-warning", icon: <TrendingDown className="w-3 h-3" /> },
    at_risk: { label: "At Risk", color: "text-status-warning", icon: <AlertTriangle className="w-3 h-3" /> },
    churning: { label: "Churning", color: "text-status-bad", icon: <AlertCircle className="w-3 h-3" /> },
    churned: { label: "Churned", color: "text-text-muted", icon: <Clock className="w-3 h-3" /> },
    new: { label: "New", color: "text-purple-400", icon: <Sparkles className="w-3 h-3" /> },
    one_time: { label: "One-Time", color: "text-text-tertiary", icon: <Target className="w-3 h-3" /> },
  };
  const { label, color, icon } = config[status];
  return (
    <div className={`flex items-center gap-1 ${color}`}>
      {icon}
      <span className="text-[10px] font-medium">{label}</span>
    </div>
  );
}

// ============================================================================
// BREAKDOWN CARD
// ============================================================================

function BreakdownCard({
  label,
  value,
  subValue,
  delta,
  description,
  icon: Icon,
  color = "blue",
}: {
  label: string;
  value: string;
  subValue?: string;
  delta?: number | null;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  color?: "blue" | "green" | "amber" | "purple";
}) {
  const colorMap = {
    blue: { text: "text-accent-blue", bgFaint: "bg-accent-blue/10" },
    green: { text: "text-status-good", bgFaint: "bg-status-good/10" },
    amber: { text: "text-status-warning", bgFaint: "bg-status-warning/10" },
    purple: { text: "text-purple-400", bgFaint: "bg-purple-400/10" },
  };
  const colors = colorMap[color];

  return (
    <div className="relative overflow-hidden bg-bg-secondary rounded-xl border border-border/30 p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted mb-2">
            {label}
          </div>
          <div className="text-2xl font-semibold tracking-tight text-text-primary tabular-nums">
            {value}
          </div>
          <div className="flex items-center gap-2 mt-1">
            {subValue && (
              <span className="text-xs text-text-tertiary">{subValue}</span>
            )}
            {delta !== undefined && delta !== null && (
              <span className={`text-xs font-medium tabular-nums ${
                delta >= 0 ? "text-status-good" : "text-status-bad"
              }`}>
                {delta >= 0 ? "+" : ""}{delta.toFixed(1)}%
              </span>
            )}
          </div>
          {description && (
            <div className="text-[10px] text-text-muted mt-1.5">
              {description}
            </div>
          )}
        </div>
        <div className={`p-2.5 rounded-lg ${colors.bgFaint}`}>
          <Icon className={`w-4 h-4 ${colors.text}`} />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// CUSTOMER ROW
// ============================================================================

function CustomerRow({ customer, rank }: { customer: WholesaleCustomer; rank: number }) {
  const isTopPerformer = rank <= 3;
  const rankColors = {
    1: "bg-status-good text-bg-primary",
    2: "bg-status-good/60 text-bg-primary",
    3: "bg-status-good/30 text-status-good",
  };

  return (
    <tr className="group border-b border-border/10 hover:bg-white/[0.02] transition-colors cursor-pointer" onClick={() => window.location.href = `/sales/customer/${customer.ns_customer_id}`}>
      <td className="py-3.5 pl-4 pr-2 w-10">
        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold tabular-nums ${
          isTopPerformer
            ? rankColors[rank as 1 | 2 | 3]
            : "text-text-muted"
        }`}>
          {rank}
        </span>
      </td>

      <td className="py-3.5 px-3">
        <div className="max-w-[250px]">
          <Link href={`/sales/customer/${customer.ns_customer_id}`} className="text-sm text-text-primary truncate group-hover:text-accent-blue transition-colors font-medium block">
            {customer.company_name}
          </Link>
          <div className="flex items-center gap-2 mt-1">
            <SegmentBadge segment={customer.segment} isCorporate={customer.is_corporate_gifting} />
            <HealthBadge status={customer.health_status} isCorporate={customer.is_corporate_gifting} />
          </div>
        </div>
      </td>

      <td className="py-3.5 px-3 text-right">
        <div className="text-sm font-semibold text-status-good tabular-nums">
          {formatCurrencyFull(customer.total_revenue)}
        </div>
        <div className="text-[10px] text-text-muted tabular-nums">
          {formatCurrencyFull(customer.avg_order_value)} avg
        </div>
      </td>

      <td className="py-3.5 px-3 text-right">
        <div className="text-sm text-text-primary tabular-nums">
          {customer.order_count.toLocaleString()}
        </div>
      </td>

      <td className="py-3.5 px-3 text-right">
        <div className="text-sm text-text-primary">
          {customer.last_sale_date
            ? format(new Date(customer.last_sale_date), "MMM d, yyyy")
            : "—"
          }
        </div>
        {customer.days_since_last_order !== null && (
          <div className={`text-[10px] tabular-nums ${
            customer.days_since_last_order > 120 ? "text-status-warning" : "text-text-muted"
          }`}>
            {customer.days_since_last_order}d ago
          </div>
        )}
      </td>

      <td className="py-3.5 pl-3 pr-4 text-right">
        <div className={`text-sm font-medium tabular-nums ${
          customer.revenue_trend > 0.1 ? "text-status-good" :
          customer.revenue_trend < -0.1 ? "text-status-bad" :
          "text-text-secondary"
        }`}>
          {customer.revenue_trend >= 0 ? "+" : ""}
          {(customer.revenue_trend * 100).toFixed(0)}%
        </div>
      </td>
    </tr>
  );
}

// ============================================================================
// AT-RISK CUSTOMER CARD
// ============================================================================

function AtRiskCustomerCard({ customer }: { customer: WholesaleAtRiskCustomer }) {
  const daysColor =
    customer.days_since_last_order >= 180 ? "border-status-bad/50 bg-status-bad/5" :
    customer.days_since_last_order >= 120 ? "border-status-warning/50 bg-status-warning/5" :
    "border-border/30 bg-bg-secondary";

  return (
    <Link
      href={`/sales/customer/${customer.ns_customer_id}`}
      className={`block rounded-lg border p-4 ${daysColor} cursor-pointer transition-all hover:scale-[1.02] hover:shadow-lg`}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-sm font-medium text-text-primary truncate max-w-[200px] hover:text-accent-blue transition-colors">
            {customer.company_name}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <SegmentBadge segment={customer.segment} isCorporate={customer.is_corporate_gifting} />
            <span className="text-[10px] text-text-muted">
              {customer.days_since_last_order}d since last order
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-text-muted">Lifetime Value</span>
        <span className="font-semibold text-text-primary tabular-nums">
          {formatCurrencyFull(customer.total_revenue)}
        </span>
      </div>
    </Link>
  );
}

// ============================================================================
// MONTHLY REVENUE TREND CHART
// ============================================================================

// Chart data item type for revenue trend tooltip
interface RevenueChartDataItem {
  month: string;
  displayMonth: string;
  revenue: number;
  regularRevenue: number;
  corporateRevenue: number;
  customers: number;
  orders: number;
  avgOrderValue: number;
  yoyChange: number | null;
}

// Revenue trend tooltip - extracted to module level to avoid re-creation on render
function RevenueChartTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload: RevenueChartDataItem }>
}) {
  if (!active || !payload || !payload.length) return null;
  const item = payload[0].payload;
  const [year, month] = item.month.split("-").map(Number);
  const tooltipDate = new Date(year, month - 1, 1);

  return (
    <div className="bg-bg-primary/95 backdrop-blur border border-border rounded-xl p-4 shadow-xl min-w-[200px]">
      <div className="flex items-center justify-between gap-4 mb-3 pb-2 border-b border-border/30">
        <span className="text-sm font-semibold text-text-primary">
          {format(tooltipDate, "MMMM yyyy")}
        </span>
        {item.yoyChange !== null && (
          <span className={`text-sm font-bold tabular-nums px-2 py-0.5 rounded ${
            item.yoyChange >= 0
              ? "bg-status-good/20 text-status-good"
              : "bg-status-bad/20 text-status-bad"
          }`}>
            {item.yoyChange >= 0 ? "+" : ""}{item.yoyChange.toFixed(0)}% YoY
          </span>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-6">
          <span className="text-xs text-text-secondary">Total Revenue</span>
          <span className="text-sm font-semibold text-text-primary tabular-nums">
            {formatCurrency(item.revenue)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-6 pl-2">
          <span className="text-xs text-text-muted flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-sm bg-status-good" />
            Regular B2B
          </span>
          <span className="text-sm font-medium text-status-good tabular-nums">
            {formatCurrency(item.regularRevenue)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-6 pl-2">
          <span className="text-xs text-text-muted flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-sm bg-amber-400" />
            Corporate
          </span>
          <span className="text-sm font-medium text-amber-400 tabular-nums">
            {formatCurrency(item.corporateRevenue)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-6 pt-2 border-t border-border/20">
          <span className="text-xs text-text-secondary">Orders</span>
          <span className="text-sm font-semibold text-text-primary tabular-nums">
            {item.orders}
          </span>
        </div>
        <div className="flex items-center justify-between gap-6">
          <span className="text-xs text-text-secondary">Customers</span>
          <span className="text-sm font-semibold text-text-primary tabular-nums">
            {item.customers}
          </span>
        </div>
        <div className="flex items-center justify-between gap-6 pt-2 border-t border-border/20">
          <span className="text-xs text-text-muted">AOV</span>
          <span className="text-sm font-medium text-text-secondary tabular-nums">
            {formatCurrency(item.avgOrderValue)}
          </span>
        </div>
      </div>
    </div>
  );
}

function MonthlyRevenueTrend({ monthly, period }: { monthly: WholesaleMonthlyStats[]; period: WholesalePeriod }) {
  const chartData = useMemo(() => {
    if (!monthly || monthly.length === 0) return [];

    const sorted = [...monthly].sort((a, b) => a.month.localeCompare(b.month));
    const currentYear = new Date().getFullYear();

    let filtered = sorted;
    switch (period) {
      case "mtd":
      case "last_month":
      case "30d":
        filtered = sorted.slice(-6);
        break;
      case "qtd":
      case "90d":
        filtered = sorted.slice(-6);
        break;
      case "ytd":
        filtered = sorted.filter(m => {
          const year = parseInt(m.month.split("-")[0], 10);
          return year >= currentYear;
        });
        break;
      case "12m":
        filtered = sorted.slice(-12);
        break;
    }

    return filtered.map(m => {
      const [year, month] = m.month.split("-").map(Number);
      const date = new Date(year, month - 1, 1);
      // Use nullish coalescing to handle 0 as a valid value (not fallback)
      const corpRevenue = m.corporate_revenue ?? 0;
      const regRevenue = m.regular_revenue ?? 0;
      return {
        month: m.month,
        displayMonth: format(date, "MMM"),
        revenue: m.total_revenue,
        regularRevenue: regRevenue,
        corporateRevenue: corpRevenue,
        customers: m.unique_customers,
        orders: m.transaction_count,
        avgOrderValue: m.avg_order_value,
        yoyChange: m.yoy_revenue_change,
      };
    });
  }, [monthly, period]);

  if (chartData.length < 2) return null;

  const avgRevenue = chartData.reduce((sum, d) => sum + d.revenue, 0) / chartData.length;

  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-text-tertiary" />
          <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
            MONTHLY WHOLESALE REVENUE
          </h3>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-muted">Avg/Month:</span>
          <span className="text-sm font-semibold text-text-primary tabular-nums">
            {formatCurrency(avgRevenue)}
          </span>
        </div>
      </div>

      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 5, left: 0 }}>
            <defs>
              <linearGradient id="regularRevenueGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10B981" stopOpacity={0.8} />
                <stop offset="100%" stopColor="#10B981" stopOpacity={0.4} />
              </linearGradient>
              <linearGradient id="corporateRevenueGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#F59E0B" stopOpacity={0.9} />
                <stop offset="100%" stopColor="#F59E0B" stopOpacity={0.5} />
              </linearGradient>
            </defs>

            <XAxis
              dataKey="displayMonth"
              tick={{ fill: "#64748B", fontSize: 10, fontWeight: 500 }}
              axisLine={{ stroke: "#1E293B" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "#64748B", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={55}
              tickFormatter={(value) => `$${(value / 1000).toFixed(0)}K`}
            />
            <Tooltip content={<RevenueChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
            <ReferenceLine
              y={avgRevenue}
              stroke="#64748B"
              strokeDasharray="4 4"
              strokeOpacity={0.4}
            />

            <Bar dataKey="regularRevenue" stackId="revenue" fill="url(#regularRevenueGradient)" radius={[0, 0, 0, 0]} />
            <Bar dataKey="corporateRevenue" stackId="revenue" fill="url(#corporateRevenueGradient)" radius={[3, 3, 0, 0]} />
            <Line
              type="monotone"
              dataKey="customers"
              stroke="#0EA5E9"
              strokeWidth={2}
              dot={{ r: 3, fill: "#0EA5E9", strokeWidth: 0 }}
              yAxisId={1}
              hide
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-6 mt-4 pt-4 border-t border-border/20">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm bg-status-good" />
          <span className="text-[10px] text-text-tertiary font-medium">Regular B2B</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm bg-amber-500" />
          <span className="text-[10px] text-text-tertiary font-medium">Corporate</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-0 border-t border-dashed border-text-tertiary opacity-50" />
          <span className="text-[10px] text-text-tertiary font-medium">Average</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// HEALTH DISTRIBUTION
// ============================================================================

function HealthDistributionCard({ distribution }: { distribution: Record<CustomerHealthStatus, number> }) {
  const data = [
    { name: "Thriving", value: distribution.thriving, color: "#10B981" },
    { name: "Stable", value: distribution.stable, color: "#0EA5E9" },
    { name: "Declining", value: distribution.declining, color: "#F59E0B" },
    { name: "At Risk", value: distribution.at_risk, color: "#EF4444" },
    { name: "New", value: distribution.new, color: "#A855F7" },
  ].filter(d => d.value > 0);

  const total = data.reduce((sum, d) => sum + d.value, 0);
  const healthyPct = total > 0
    ? ((distribution.thriving + distribution.stable) / total) * 100
    : 0;

  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-text-tertiary" />
          <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
            CUSTOMER HEALTH
          </h3>
        </div>
        <div className={`text-lg font-bold tabular-nums ${
          healthyPct >= 60 ? "text-status-good" :
          healthyPct >= 40 ? "text-status-warning" :
          "text-status-bad"
        }`}>
          {healthyPct.toFixed(0)}%
        </div>
      </div>

      <div className="flex items-center gap-4 mb-4">
        <div className="w-20 h-20">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                innerRadius={25}
                outerRadius={38}
                paddingAngle={2}
                dataKey="value"
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="flex-1 space-y-1.5">
          {data.slice(0, 4).map((item) => (
            <div key={item.name} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="text-[10px] text-text-secondary">{item.name}</span>
              </div>
              <span className="text-xs font-semibold text-text-primary tabular-nums">{item.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="text-[10px] text-text-muted pt-3 border-t border-border/20">
        {distribution.thriving + distribution.stable} healthy • {distribution.at_risk + distribution.churning} at risk
      </div>
    </div>
  );
}

// ============================================================================
// NEVER ORDERED CUSTOMERS SECTION
// ============================================================================

function NeverOrderedCustomersCard({ customers }: { customers: WholesaleNeverOrderedCustomer[] }) {
  if (!customers || customers.length === 0) return null;

  return (
    <div className="bg-bg-secondary rounded-xl border border-amber-500/30 overflow-hidden">
      <div className="px-5 py-4 border-b border-border/20 flex items-center justify-between bg-amber-500/5">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-amber-400" />
          <h3 className="text-[10px] uppercase tracking-[0.2em] text-amber-400 font-semibold">
            NEVER ORDERED - SALES OPPORTUNITIES
          </h3>
        </div>
        <span className="text-[10px] text-amber-400 font-medium">
          {customers.length} accounts
        </span>
      </div>

      <div className="max-h-[400px] overflow-y-auto">
        {customers.map((customer) => (
          <Link
            key={customer.ns_customer_id}
            href={`/sales/customer/${customer.ns_customer_id}`}
            className="flex items-center justify-between px-5 py-3 border-b border-border/10 hover:bg-white/[0.02] transition-colors cursor-pointer"
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm text-text-primary truncate font-medium hover:text-accent-blue transition-colors">
                {customer.company_name}
              </div>
              <div className="flex items-center gap-2 text-[10px] text-text-muted">
                {customer.email && <span>{customer.email}</span>}
                {customer.phone && <span>• {customer.phone}</span>}
              </div>
            </div>
            <div className="text-right">
              {customer.days_since_created !== null && (
                <div className={`text-xs font-medium tabular-nums ${
                  customer.days_since_created < 30 ? "text-status-good" :
                  customer.days_since_created < 90 ? "text-amber-400" :
                  "text-text-muted"
                }`}>
                  Created {customer.days_since_created}d ago
                </div>
              )}
              {customer.category && (
                <div className="text-[10px] text-text-muted">
                  {customer.category}
                </div>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// NEW CUSTOMERS - First-time buyers in last 90 days + YoY Comparison
// ============================================================================

function NewCustomersSection({
  customers,
  acquisition,
}: {
  customers: WholesaleCustomer[];
  acquisition: WholesaleNewCustomerAcquisition | null;
}) {
  const [showOutliers, setShowOutliers] = useState(false);

  if (!customers || customers.length === 0) return null;

  // Determine if we should show adjusted comparison
  const hasOutliers = acquisition?.outliers && acquisition.outliers.length > 0;
  const showAdjusted = hasOutliers && acquisition;

  return (
    <div className="bg-bg-secondary rounded-xl border border-status-good/30 overflow-hidden h-full flex flex-col">
      <div className="px-5 py-4 border-b border-border/20 flex items-center justify-between bg-status-good/5">
        <div className="flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-status-good" />
          <h3 className="text-[10px] uppercase tracking-[0.2em] text-status-good font-semibold">
            NEW CUSTOMERS
          </h3>
        </div>
        <span className="text-[10px] text-status-good font-medium">
          {acquisition?.currentPeriod.newCustomerCount ?? customers.length} in {new Date().getFullYear()}
        </span>
      </div>

      {/* YoY Comparison Header */}
      {acquisition && (
        <div className="px-5 py-4 border-b border-border/10 bg-bg-tertiary/30">
          <div className="grid grid-cols-3 gap-4">
            {/* Current YTD - show adjusted if outliers exist */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
                {new Date().getFullYear()} YTD
              </div>
              <div className="text-lg font-bold text-text-primary tabular-nums">
                {acquisition.currentPeriod.newCustomerCount.toLocaleString()}
              </div>
              <div className="text-xs text-status-good tabular-nums">
                {formatCurrencyFull(hasOutliers ? acquisition.adjustedComparison.currentRevenue : acquisition.currentPeriod.totalRevenue)}
              </div>
            </div>

            {/* Prior YTD - show adjusted if outliers exist */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
                {new Date().getFullYear() - 1} YTD
              </div>
              <div className="text-lg font-bold text-text-secondary tabular-nums">
                {acquisition.priorPeriod.newCustomerCount.toLocaleString()}
              </div>
              <div className="text-xs text-text-tertiary tabular-nums">
                {formatCurrencyFull(hasOutliers ? acquisition.adjustedComparison.priorRevenue : acquisition.priorPeriod.totalRevenue)}
              </div>
            </div>

            {/* YoY Change - show adjusted if outliers exist */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
                YoY Change
              </div>
              <div className={`text-lg font-bold tabular-nums ${
                (hasOutliers ? acquisition.adjustedComparison.revenueDeltaPct : acquisition.yoyComparison.revenueDeltaPct) >= 0 ? "text-status-good" : "text-status-bad"
              }`}>
                {(hasOutliers ? acquisition.adjustedComparison.revenueDeltaPct : acquisition.yoyComparison.revenueDeltaPct) >= 0 ? "+" : ""}
                {(hasOutliers ? acquisition.adjustedComparison.revenueDeltaPct : acquisition.yoyComparison.revenueDeltaPct).toFixed(1)}%
              </div>
              <div className={`text-xs tabular-nums ${
                acquisition.yoyComparison.customerCountDeltaPct >= 0 ? "text-status-good" : "text-status-bad"
              }`}>
                {acquisition.yoyComparison.customerCountDeltaPct >= 0 ? "+" : ""}
                {acquisition.yoyComparison.customerCountDelta} customers
              </div>
            </div>
          </div>

          {/* Outlier detail - show raw totals when expanded */}
          {showAdjusted && (
            <div className="mt-3 pt-3 border-t border-border/10">
              <button
                onClick={() => setShowOutliers(!showOutliers)}
                className="flex items-center gap-2 text-[10px] text-status-warning hover:text-status-warning/80 transition-colors"
              >
                <AlertTriangle className="w-3 h-3" />
                <span>
                  {acquisition.outliers.length} outlier{acquisition.outliers.length !== 1 ? "s" : ""} detected
                </span>
                {showOutliers ? (
                  <ChevronUp className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
              </button>

              {showOutliers && (
                <div className="mt-2 space-y-1">
                  {acquisition.outliers.map((outlier, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-[10px] text-text-tertiary px-2 py-1 bg-status-warning/5 rounded"
                    >
                      <span className="truncate flex-1">
                        {outlier.company_name}
                        <span className="text-text-muted ml-1">
                          ({outlier.period === "current" ? new Date().getFullYear() : new Date().getFullYear() - 1})
                        </span>
                      </span>
                      <span className="text-status-warning font-medium tabular-nums ml-2">
                        {formatCurrencyFull(outlier.revenue)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-2 flex items-center justify-between text-[10px]">
                <span className="text-text-muted">Raw (incl. outliers):</span>
                <span className={`font-semibold tabular-nums ${
                  acquisition.yoyComparison.revenueDeltaPct >= 0 ? "text-status-good" : "text-status-bad"
                }`}>
                  {acquisition.yoyComparison.revenueDeltaPct >= 0 ? "+" : ""}
                  {acquisition.yoyComparison.revenueDeltaPct.toFixed(1)}% YoY
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="max-h-[350px] overflow-y-auto flex-1">
        {customers.map((customer, idx) => {
          // Highlight new customers with revenue < $4k (need nurturing)
          // All customers in this section are already 2025 first-time buyers by definition
          const needsAttention = customer.total_revenue < 4000;

          return (
          <Link
            key={customer.ns_customer_id}
            href={`/sales/customer/${customer.ns_customer_id}`}
            className={`flex items-center justify-between px-5 py-3 border-b border-border/10 hover:bg-white/[0.02] cursor-pointer ${needsAttention ? "ss-violation" : "transition-colors"}`}
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span className="text-[10px] text-text-muted tabular-nums w-5">{idx + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-text-primary truncate font-medium hover:text-accent-blue transition-colors">
                  {customer.company_name}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <SegmentBadge segment={customer.segment} isCorporate={customer.is_corporate_gifting} />
                  <span className="text-[10px] text-text-muted">
                    {customer.order_count.toLocaleString()} order{customer.order_count !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold text-status-good tabular-nums">
                {formatCurrencyFull(customer.total_revenue)}
              </div>
              {customer.first_sale_date && (
                <div className="text-[10px] text-text-muted">
                  {format(new Date(customer.first_sale_date), "MMM d")}
                </div>
              )}
            </div>
          </Link>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// CHURNED CUSTOMERS - 365+ days since last order (excludes corporate)
// ============================================================================

function ChurnedCustomersSection({ customers }: { customers: WholesaleCustomer[] }) {
  // Filter out corporate customers - they have different ordering patterns
  const nonCorporateCustomers = customers.filter(c => !c.is_corporate_gifting);

  if (!nonCorporateCustomers || nonCorporateCustomers.length === 0) return null;

  // Determine current year for "churned this year" highlighting
  const currentYear = new Date().getFullYear();

  // Check if customer churned this year (last sale was in current year, meaning they crossed 365 days recently)
  const isChurnedThisYear = (customer: WholesaleCustomer) => {
    if (!customer.last_sale_date) return false;
    const lastSaleYear = new Date(customer.last_sale_date).getFullYear();
    // Churned this year = their last sale was in the previous year (so they crossed 365d threshold in current year)
    // OR their days_since_last_order is between 365-730 (churned within the last year)
    return lastSaleYear === currentYear - 1 ||
      (customer.days_since_last_order !== null && customer.days_since_last_order >= 365 && customer.days_since_last_order < 730);
  };

  const churnedThisYearCount = nonCorporateCustomers.filter(isChurnedThisYear).length;

  return (
    <div className="bg-bg-secondary rounded-xl border border-text-muted/30 overflow-hidden">
      <div className="px-5 py-4 border-b border-border/20 flex items-center justify-between bg-text-muted/5">
        <div className="flex items-center gap-2">
          <UserMinus className="w-4 h-4 text-text-muted" />
          <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted font-semibold">
            CHURNED CUSTOMERS
          </h3>
        </div>
        <div className="flex items-center gap-3">
          {churnedThisYearCount > 0 && (
            <span className="text-[10px] text-status-bad font-semibold bg-status-bad/10 px-2 py-0.5 rounded">
              {churnedThisYearCount} this year
            </span>
          )}
          <span className="text-[10px] text-text-muted font-medium">
            {nonCorporateCustomers.length} total • 365+ days inactive
          </span>
        </div>
      </div>

      <p className="px-5 py-3 text-xs text-text-tertiary border-b border-border/10">
        Former customers who haven&apos;t ordered in over a year. Excludes corporate accounts.
      </p>

      <div className="max-h-[500px] overflow-y-auto">
        {nonCorporateCustomers.map((customer) => {
          const churnedRecently = isChurnedThisYear(customer);
          return (
            <Link
              key={customer.ns_customer_id}
              href={`/sales/customer/${customer.ns_customer_id}`}
              className={`flex items-center justify-between px-5 py-3 border-b border-border/10 transition-colors cursor-pointer ${
                churnedRecently
                  ? "bg-status-bad/5 hover:bg-status-bad/10 border-l-2 border-l-status-bad"
                  : "hover:bg-white/[0.02]"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm truncate font-medium ${churnedRecently ? "text-text-primary" : "text-text-secondary"}`}>
                    {customer.company_name}
                  </span>
                  {churnedRecently && (
                    <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-status-bad/20 text-status-bad uppercase tracking-wider">
                      Recent
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <SegmentBadge segment={customer.segment} isCorporate={customer.is_corporate_gifting} />
                  <span className="text-[10px] text-text-muted">
                    {customer.order_count.toLocaleString()} lifetime orders
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className={`text-sm font-medium tabular-nums ${churnedRecently ? "text-text-primary" : "text-text-secondary"}`}>
                  {formatCurrencyFull(customer.total_revenue)}
                </div>
                {customer.days_since_last_order !== null && (
                  <div className={`text-[10px] tabular-nums ${churnedRecently ? "text-status-bad" : "text-text-muted"}`}>
                    {customer.days_since_last_order}d ago
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// ORDERING ANOMALIES - Customers late based on their own pattern
// This is the INTELLIGENT way to detect at-risk customers
// ============================================================================

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

      {/* Pattern Analysis */}
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
  // Filter out corporate customers - they have different ordering patterns
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
            Customers who are overdue based on their own historical ordering pattern.
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

        <div className="max-h-[500px] overflow-y-auto pr-1">
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
// TOP SKUS - What's selling in wholesale
// ============================================================================

function TopSkusSection({ skus }: { skus: WholesaleSkuStats[] }) {
  if (!skus || skus.length === 0) return null;

  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30 overflow-hidden">
      <div className="px-5 py-4 border-b border-border/20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-text-tertiary" />
          <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted font-semibold">
            TOP WHOLESALE SKUS
          </h3>
        </div>
        <span className="text-[10px] text-text-muted">
          {skus.length} SKUs
        </span>
      </div>

      <div className="max-h-[350px] overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-border/20 bg-bg-tertiary/95 backdrop-blur-sm">
              <th className="py-2 px-4 text-left text-[10px] font-semibold uppercase tracking-wider text-text-muted">SKU</th>
              <th className="py-2 px-3 text-right text-[10px] font-semibold uppercase tracking-wider text-text-muted">Units</th>
              <th className="py-2 px-3 text-right text-[10px] font-semibold uppercase tracking-wider text-text-muted">Revenue</th>
              <th className="py-2 px-4 text-right text-[10px] font-semibold uppercase tracking-wider text-text-muted">Orders</th>
            </tr>
          </thead>
          <tbody>
            {skus.slice(0, 10).map((sku, idx) => (
              <tr key={sku.sku} className="border-b border-border/10 hover:bg-white/[0.02] transition-colors">
                <td className="py-2.5 px-4">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold tabular-nums ${idx < 3 ? "text-status-good" : "text-text-muted"}`}>
                      {idx + 1}
                    </span>
                    <span className="text-sm text-text-primary font-medium truncate max-w-[200px]">
                      {sku.sku}
                    </span>
                  </div>
                </td>
                <td className="py-2.5 px-3 text-right">
                  <span className="text-sm text-text-primary tabular-nums">{sku.total_units.toLocaleString()}</span>
                </td>
                <td className="py-2.5 px-3 text-right">
                  <span className="text-sm font-semibold text-status-good tabular-nums">{formatCurrency(sku.total_revenue)}</span>
                </td>
                <td className="py-2.5 px-4 text-right">
                  <span className="text-sm text-text-secondary tabular-nums">{sku.order_count.toLocaleString()}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// RECENT TRANSACTIONS - Live pulse of activity
// ============================================================================

function RecentTransactionsSection({ transactions }: { transactions: WholesaleTransaction[] }) {
  if (!transactions || transactions.length === 0) return null;

  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30 overflow-hidden">
      <div className="px-5 py-4 border-b border-border/20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Receipt className="w-4 h-4 text-text-tertiary" />
          <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted font-semibold">
            RECENT TRANSACTIONS
          </h3>
        </div>
        <span className="text-[10px] text-text-muted">
          Last {transactions.length} orders
        </span>
      </div>

      <div className="max-h-[350px] overflow-y-auto">
        {transactions.slice(0, 15).map((txn) => (
          <div
            key={txn.ns_transaction_id}
            className="flex items-center justify-between px-5 py-2.5 border-b border-border/10 hover:bg-white/[0.02] transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm text-text-primary truncate font-medium">
                {txn.company_name}
              </div>
              <div className="text-[10px] text-text-muted">
                {txn.tran_id} • {format(new Date(txn.tran_date), "MMM d")}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold text-status-good tabular-nums">
                {formatCurrencyFull(txn.foreign_total)}
              </div>
              <div className="text-[10px] text-text-muted">
                {txn.transaction_type === "CashSale" ? "Cash Sale" : "Invoice"}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// CORPORATE CUSTOMERS - All corporate gifting accounts
// ============================================================================

function CorporateCustomersSection({ customers }: { customers: WholesaleCustomer[] }) {
  // Calculate lifetime totals for corporate customers
  const lifetimeRevenue = customers.reduce((sum, c) => sum + c.total_revenue, 0);
  const totalOrders = customers.reduce((sum, c) => sum + c.order_count, 0);

  return (
    <div className="bg-bg-secondary rounded-xl border border-accent-blue/30 overflow-hidden h-full flex flex-col">
      <div className="px-5 py-4 border-b border-border/20 flex items-center justify-between bg-accent-blue/5">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-accent-blue" />
          <h3 className="text-[10px] uppercase tracking-[0.2em] text-accent-blue font-semibold">
            CORPORATE GIFTING
          </h3>
        </div>
        <span className="text-[10px] text-accent-blue font-medium">
          {customers.length} accounts
        </span>
      </div>

      {/* Summary Stats */}
      <div className="px-5 py-3 border-b border-border/10 bg-bg-tertiary/30 grid grid-cols-2 gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted">Lifetime Revenue</div>
          <div className="text-sm font-semibold text-text-primary tabular-nums">
            {formatCurrencyFull(lifetimeRevenue)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted">Total Orders</div>
          <div className="text-sm font-semibold text-text-primary tabular-nums">
            {totalOrders.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Customer List - No slicing, show all */}
      <div className="max-h-[280px] overflow-y-auto flex-1">
        {customers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-text-muted">
            <Building2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <span className="text-xs">No corporate customers</span>
          </div>
        ) : (
          customers.map((customer) => (
            <Link
              key={customer.ns_customer_id}
              href={`/sales/customer/${customer.ns_customer_id}`}
              className="flex items-center justify-between px-5 py-2.5 border-b border-border/10 hover:bg-white/[0.02] transition-colors cursor-pointer"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm text-text-primary truncate font-medium hover:text-accent-blue transition-colors">
                  {customer.company_name}
                </div>
                <div className="text-[10px] text-text-muted">
                  {customer.order_count === 0
                    ? "No orders yet"
                    : `${customer.order_count} order${customer.order_count !== 1 ? "s" : ""}`}
                </div>
              </div>
              <div className="text-right">
                <div className={`text-sm font-semibold tabular-nums ${
                  customer.total_revenue > 0 ? "text-status-good" : "text-text-tertiary"
                }`}>
                  {formatCurrencyFull(customer.total_revenue)}
                </div>
                {customer.last_sale_date && (
                  <div className="text-[10px] text-text-muted">
                    Last: {format(new Date(customer.last_sale_date), "MMM d")}
                  </div>
                )}
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

// ============================================================================
// SEGMENT INTELLIGENCE - Actionable Business Intelligence
// ============================================================================

interface SegmentIntelligenceProps {
  distribution: WholesaleSegmentDistribution;
  healthDistribution: Record<CustomerHealthStatus, number>;
  topCustomers: WholesaleCustomer[];
  aiInsights: PatternInsightsResponse | null;
  aiLoading: boolean;
}

function SegmentIntelligenceCard({ distribution, healthDistribution, topCustomers, aiInsights, aiLoading }: SegmentIntelligenceProps) {
  // State for expanded AI insight
  const [expandedPrediction, setExpandedPrediction] = useState<number | null>(null);

  // Calculate total accounts
  const total = distribution.major + distribution.large + distribution.mid +
                distribution.small + distribution.starter + distribution.minimal;

  // Segment revenue estimates (based on tier midpoints)
  // Major: $25K+, Large: $10-25K, Mid: $5-10K, Small: $1-5K, Starter: $500-1K, Minimal: <$500
  const segmentRevenue = {
    major: distribution.major * 35000,  // ~$35K avg for major
    large: distribution.large * 17500,   // ~$17.5K avg for large
    mid: distribution.mid * 7500,        // ~$7.5K avg for mid
    small: distribution.small * 3000,    // ~$3K avg for small
    starter: distribution.starter * 750, // ~$750 avg for starter
    minimal: distribution.minimal * 250, // ~$250 avg for minimal
  };
  const totalEstRevenue = Object.values(segmentRevenue).reduce((a, b) => a + b, 0);

  // Revenue concentration - what % comes from top tiers
  const topTierRevenue = segmentRevenue.major + segmentRevenue.large;
  const revenueConcentration = totalEstRevenue > 0 ? (topTierRevenue / totalEstRevenue) * 100 : 0;

  // Customers in top tiers
  const topTierCount = distribution.major + distribution.large;
  const topTierPct = total > 0 ? (topTierCount / total) * 100 : 0;

  // Segment upgrade potential - Mid customers that could become Large
  const midUpgradePotential = distribution.mid;
  const midUpgradeRevenue = midUpgradePotential * 10000; // $10K additional if upgraded

  // Small to Mid upgrade potential
  const smallUpgradePotential = distribution.small;
  const smallUpgradeRevenue = smallUpgradePotential * 4500; // $4.5K additional if upgraded

  // At-risk revenue calculation (at_risk + declining customers in valuable segments)
  // Count how many top customers are at risk or declining
  const atRiskTopCustomers = topCustomers.filter(c =>
    (c.segment === "major" || c.segment === "large" || c.segment === "mid") &&
    (c.health_status === "at_risk" || c.health_status === "declining" || c.health_status === "churning")
  );
  const atRiskRevenue = atRiskTopCustomers.reduce((sum, c) => sum + c.total_revenue, 0);

  // Find customers close to tier upgrade (within 20% of next tier)
  const nearUpgrade = topCustomers.filter(c => {
    if (c.segment === "mid" && c.total_revenue >= 8000) return true; // Near Large
    if (c.segment === "small" && c.total_revenue >= 4000) return true; // Near Mid
    if (c.segment === "starter" && c.total_revenue >= 800) return true; // Near Small
    return false;
  });

  // Healthy percentage
  const healthyCount = healthDistribution.thriving + healthDistribution.stable;
  const totalHealth = Object.values(healthDistribution).reduce((a, b) => a + b, 0);
  const healthyPct = totalHealth > 0 ? (healthyCount / totalHealth) * 100 : 0;

  // Risk score (0-100, lower is better)
  const riskScore = Math.min(100, Math.round(
    (100 - healthyPct) * 0.4 + // Health factor
    (100 - revenueConcentration) * 0.3 + // Concentration factor (lower concentration = more risk)
    (atRiskTopCustomers.length / Math.max(1, topTierCount)) * 100 * 0.3 // At-risk top customers
  ));

  // Segment data for visualization
  const segments = [
    { name: "Major", value: distribution.major, color: "#10B981", revenue: segmentRevenue.major, threshold: "$25K+" },
    { name: "Large", value: distribution.large, color: "#0EA5E9", revenue: segmentRevenue.large, threshold: "$10-25K" },
    { name: "Mid", value: distribution.mid, color: "#A855F7", revenue: segmentRevenue.mid, threshold: "$5-10K" },
    { name: "Small", value: distribution.small, color: "#F59E0B", revenue: segmentRevenue.small, threshold: "$1-5K" },
    { name: "Starter", value: distribution.starter, color: "#64748B", revenue: segmentRevenue.starter, threshold: "$500-1K" },
    { name: "Minimal", value: distribution.minimal, color: "#475569", revenue: segmentRevenue.minimal, threshold: "<$500" },
  ].filter(d => d.value > 0);

  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border/20 bg-gradient-to-r from-purple-500/5 to-accent-blue/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/10">
              <BarChart3 className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-text-primary">SEGMENT INTELLIGENCE</h3>
              <p className="text-[10px] text-text-muted mt-0.5">Portfolio composition & growth opportunities</p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            {/* Portfolio Health Score */}
            <div className="text-right">
              <div className={`text-2xl font-bold tabular-nums ${
                riskScore < 30 ? "text-status-good" :
                riskScore < 50 ? "text-status-warning" :
                "text-status-bad"
              }`}>
                {100 - riskScore}
              </div>
              <div className="text-[9px] text-text-muted">Portfolio Score</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Column 1: Segment Breakdown */}
          <div className="space-y-4">
            <div className="text-[10px] uppercase tracking-[0.15em] text-text-muted font-semibold mb-3">
              Account Distribution
            </div>

            {/* Visual bar chart */}
            <div className="space-y-2">
              {segments.map((seg) => {
                const pct = total > 0 ? (seg.value / total) * 100 : 0;
                const revPct = totalEstRevenue > 0 ? (seg.revenue / totalEstRevenue) * 100 : 0;
                return (
                  <div key={seg.name} className="group">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: seg.color }} />
                        <span className="text-xs font-medium text-text-secondary">{seg.name}</span>
                        <span className="text-[9px] text-text-muted">({seg.threshold})</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-bold text-text-primary tabular-nums">{seg.value}</span>
                        <span className="text-[10px] text-text-muted tabular-nums w-8 text-right">
                          {pct.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                    {/* Progress bar showing both account % and revenue % */}
                    <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: seg.color }}
                      />
                    </div>
                    {/* Revenue contribution on hover */}
                    <div className="text-[9px] text-text-muted mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      ~{formatCurrency(seg.revenue)} est. revenue ({revPct.toFixed(0)}% of total)
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pt-3 border-t border-border/20 text-[10px] text-text-muted">
              {total} total accounts
            </div>
          </div>

          {/* Column 2: Key Insights */}
          <div className="space-y-3">
            <div className="text-[10px] uppercase tracking-[0.15em] text-text-muted font-semibold mb-3">
              Key Insights
            </div>

            {/* Revenue Concentration */}
            <div className={`p-3 rounded-lg border ${
              revenueConcentration >= 70 ? "border-status-good/30 bg-status-good/5" :
              revenueConcentration >= 50 ? "border-accent-blue/30 bg-accent-blue/5" :
              "border-status-warning/30 bg-status-warning/5"
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-text-secondary">Revenue Concentration</span>
                <span className={`text-sm font-bold tabular-nums ${
                  revenueConcentration >= 70 ? "text-status-good" :
                  revenueConcentration >= 50 ? "text-accent-blue" :
                  "text-status-warning"
                }`}>
                  {revenueConcentration.toFixed(0)}%
                </span>
              </div>
              <p className="text-[10px] text-text-muted mt-1">
                {topTierPct.toFixed(0)}% of accounts (Major+Large) drive {revenueConcentration.toFixed(0)}% of revenue
              </p>
            </div>

            {/* At-Risk Revenue */}
            {atRiskRevenue > 0 && (
              <div className="p-3 rounded-lg border border-status-bad/30 bg-status-bad/5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-secondary">At-Risk Revenue</span>
                  <span className="text-sm font-bold text-status-bad tabular-nums">
                    {formatCurrency(atRiskRevenue)}
                  </span>
                </div>
                <p className="text-[10px] text-text-muted mt-1">
                  {atRiskTopCustomers.length} valuable accounts showing warning signs
                </p>
              </div>
            )}

            {/* Portfolio Health */}
            <div className="p-3 rounded-lg border border-border/30 bg-bg-tertiary/30">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-text-secondary">Portfolio Health</span>
                <span className={`text-sm font-bold tabular-nums ${
                  healthyPct >= 60 ? "text-status-good" :
                  healthyPct >= 40 ? "text-status-warning" :
                  "text-status-bad"
                }`}>
                  {healthyPct.toFixed(0)}%
                </span>
              </div>
              <p className="text-[10px] text-text-muted mt-1">
                {healthyCount} accounts thriving or stable
              </p>
            </div>

            {/* Near Upgrade */}
            {nearUpgrade.length > 0 && (
              <div className="p-3 rounded-lg border border-purple-500/30 bg-purple-500/5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-secondary">Near Tier Upgrade</span>
                  <span className="text-sm font-bold text-purple-400 tabular-nums">
                    {nearUpgrade.length}
                  </span>
                </div>
                <p className="text-[10px] text-text-muted mt-1">
                  Accounts within 20% of next tier threshold
                </p>
              </div>
            )}
          </div>

          {/* Column 3: AI Pattern Insights */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-3">
              <div className="text-[10px] uppercase tracking-[0.15em] text-text-muted font-semibold">
                Pattern Detection
              </div>
              {aiInsights && (
                <span className="text-[9px] text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded">
                  {aiInsights.summary.criticalRisk + aiInsights.summary.highRisk} alerts
                </span>
              )}
            </div>

            {aiLoading && (
              <div className="p-4 rounded-lg border border-border/30 bg-bg-tertiary/30 text-center">
                <div className="text-[10px] text-text-muted animate-pulse">Analyzing patterns...</div>
              </div>
            )}

            {!aiLoading && aiInsights && aiInsights.predictions.length > 0 && (
              <>
                {/* Summary */}
                <div className="p-3 rounded-lg border border-purple-500/30 bg-purple-500/5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] text-text-secondary">Revenue at Risk</span>
                    <span className="text-sm font-bold text-status-bad tabular-nums">
                      {formatCurrency(aiInsights.summary.totalRevenueAtRisk)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px]">
                    <span className="text-status-bad">{aiInsights.summary.criticalRisk} critical</span>
                    <span className="text-status-warning">{aiInsights.summary.highRisk} high</span>
                    <span className="text-text-muted">{aiInsights.summary.mediumRisk} medium</span>
                  </div>
                </div>

                {/* Clickable at-risk accounts */}
                <div className="max-h-[280px] overflow-y-auto space-y-2 pr-1">
                  {aiInsights.predictions.slice(0, 5).map((prediction) => {
                    const isExpanded = expandedPrediction === prediction.ns_customer_id;
                    const borderColor = prediction.riskLevel === "critical"
                      ? "border-status-bad/40"
                      : prediction.riskLevel === "high"
                      ? "border-status-warning/40"
                      : "border-border/30";
                    const bgColor = prediction.riskLevel === "critical"
                      ? "bg-status-bad/5"
                      : prediction.riskLevel === "high"
                      ? "bg-status-warning/5"
                      : "bg-bg-tertiary/30";
                    const glowColor = prediction.riskLevel === "critical"
                      ? "hover:shadow-[0_0_20px_-5px_rgba(220,38,38,0.3)]"
                      : prediction.riskLevel === "high"
                      ? "hover:shadow-[0_0_20px_-5px_rgba(245,158,11,0.2)]"
                      : "";

                    return (
                      <div
                        key={prediction.ns_customer_id}
                        onClick={() => setExpandedPrediction(isExpanded ? null : prediction.ns_customer_id)}
                        className={`
                          p-2.5 rounded-lg border ${borderColor} ${bgColor}
                          cursor-pointer select-none
                          transition-all duration-200 ease-out
                          hover:border-opacity-80 hover:translate-y-[-1px]
                          ${glowColor}
                          ${isExpanded ? "ring-1 ring-purple-500/30" : ""}
                        `}
                      >
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <ChevronDown className={`w-3 h-3 text-text-tertiary flex-shrink-0 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
                            <div className="text-xs font-medium text-text-primary truncate">
                              {prediction.company_name}
                            </div>
                          </div>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${
                            prediction.riskLevel === "critical" ? "bg-status-bad/20 text-status-bad" :
                            prediction.riskLevel === "high" ? "bg-status-warning/20 text-status-warning" :
                            "bg-text-muted/20 text-text-secondary"
                          }`}>
                            {prediction.churnRiskScore}
                          </span>
                        </div>
                        <p className="text-[10px] text-text-muted leading-relaxed line-clamp-2 pl-5">
                          {prediction.signals[0]?.description || prediction.narrative.slice(0, 100)}
                        </p>
                        <div className="mt-1.5 text-[9px] text-text-tertiary pl-5 flex items-center gap-2">
                          <span>{formatCurrency(prediction.revenueAtRisk)} at risk</span>
                          <span className="text-purple-400/60">Click for details</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {!aiLoading && (!aiInsights || aiInsights.predictions.length === 0) && (
              <div className="p-4 rounded-lg border border-status-good/30 bg-status-good/5 text-center">
                <div className="text-xs text-status-good font-medium">No pattern anomalies detected</div>
                <div className="text-[10px] text-text-muted mt-1">All active customers on track</div>
              </div>
            )}
          </div>
        </div>

        {/* Expanded Detail Panel - Full Width Below Grid */}
        {expandedPrediction && aiInsights && (() => {
          const prediction = aiInsights.predictions.find(p => p.ns_customer_id === expandedPrediction);
          if (!prediction) return null;

          const riskGradient = prediction.riskLevel === "critical"
            ? "from-status-bad/10 via-status-bad/5 to-transparent"
            : prediction.riskLevel === "high"
            ? "from-status-warning/10 via-status-warning/5 to-transparent"
            : "from-purple-500/10 via-purple-500/5 to-transparent";

          return (
            <div className="mt-6 pt-6 border-t border-border/30 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className={`rounded-xl border border-border/30 bg-gradient-to-br ${riskGradient} overflow-hidden`}>
                {/* Header */}
                <div className="px-6 py-4 border-b border-border/20 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      prediction.riskLevel === "critical" ? "bg-status-bad/20" :
                      prediction.riskLevel === "high" ? "bg-status-warning/20" :
                      "bg-purple-500/20"
                    }`}>
                      <AlertTriangle className={`w-5 h-5 ${
                        prediction.riskLevel === "critical" ? "text-status-bad" :
                        prediction.riskLevel === "high" ? "text-status-warning" :
                        "text-purple-400"
                      }`} />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-text-primary">{prediction.company_name}</h4>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-[10px] text-text-muted uppercase tracking-wider">{prediction.segment} Account</span>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                          prediction.riskLevel === "critical" ? "bg-status-bad/20 text-status-bad" :
                          prediction.riskLevel === "high" ? "bg-status-warning/20 text-status-warning" :
                          "bg-purple-500/20 text-purple-400"
                        }`}>
                          {prediction.riskLevel.toUpperCase()} RISK
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setExpandedPrediction(null); }}
                    className="p-2 rounded-lg hover:bg-bg-tertiary transition-colors"
                  >
                    <ChevronUp className="w-4 h-4 text-text-muted" />
                  </button>
                </div>

                {/* Content Grid */}
                <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Column 1: Narrative */}
                  <div className="lg:col-span-2 space-y-4">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.15em] text-text-muted font-semibold mb-2">
                        Pattern Analysis
                      </div>
                      <p className="text-sm text-text-secondary leading-relaxed">
                        {prediction.narrative}
                      </p>
                    </div>

                    {/* Warning Signals */}
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.15em] text-text-muted font-semibold mb-3">
                        Warning Signals ({prediction.signals.length})
                      </div>
                      <div className="space-y-2">
                        {prediction.signals.map((signal, idx) => (
                          <div
                            key={idx}
                            className={`p-3 rounded-lg border ${
                              signal.severity === "critical" ? "border-status-bad/30 bg-status-bad/5" :
                              signal.severity === "warning" ? "border-status-warning/30 bg-status-warning/5" :
                              "border-border/30 bg-bg-tertiary/30"
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                                signal.severity === "critical" ? "bg-status-bad" :
                                signal.severity === "warning" ? "bg-status-warning" :
                                "bg-text-muted"
                              }`} />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-text-primary font-medium">{signal.description}</p>
                                <p className="text-[10px] text-text-tertiary mt-1">{signal.evidence}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Column 2: Stats & Action */}
                  <div className="space-y-4">
                    {/* Key Metrics */}
                    <div className="p-4 rounded-lg border border-border/30 bg-bg-tertiary/30">
                      <div className="text-[10px] uppercase tracking-[0.15em] text-text-muted font-semibold mb-3">
                        Risk Assessment
                      </div>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-text-secondary">Risk Score</span>
                          <span className={`text-lg font-bold tabular-nums ${
                            prediction.churnRiskScore >= 70 ? "text-status-bad" :
                            prediction.churnRiskScore >= 50 ? "text-status-warning" :
                            "text-purple-400"
                          }`}>
                            {prediction.churnRiskScore}
                          </span>
                        </div>
                        <div className="h-1.5 bg-bg-primary rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              prediction.churnRiskScore >= 70 ? "bg-status-bad" :
                              prediction.churnRiskScore >= 50 ? "bg-status-warning" :
                              "bg-purple-500"
                            }`}
                            style={{ width: `${prediction.churnRiskScore}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between pt-2 border-t border-border/20">
                          <span className="text-[11px] text-text-secondary">Revenue at Risk</span>
                          <span className="text-sm font-bold text-status-bad tabular-nums">
                            {formatCurrency(prediction.revenueAtRisk)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-text-secondary">Confidence</span>
                          <span className="text-sm font-medium text-text-primary tabular-nums">
                            {prediction.confidenceLevel}%
                          </span>
                        </div>
                      </div>
                    </div>

                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ============================================================================
// SORTABLE TABLE HEADER
// ============================================================================

function SortableHeader({
  label,
  field,
  currentSort,
  currentDirection,
  onSort,
  align = "right",
}: {
  label: string;
  field: SortField;
  currentSort: SortField;
  currentDirection: SortDirection;
  onSort: (field: SortField) => void;
  align?: "left" | "right";
}) {
  const isActive = currentSort === field;

  return (
    <th
      className={`py-3 px-3 text-${align} cursor-pointer select-none group`}
      onClick={() => onSort(field)}
    >
      <div className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider ${
        isActive ? "text-accent-blue" : "text-text-muted group-hover:text-text-secondary"
      } transition-colors`}>
        {label}
        <span className={`transition-opacity ${isActive ? "opacity-100" : "opacity-0 group-hover:opacity-50"}`}>
          {currentDirection === "desc" ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronUp className="w-3 h-3" />
          )}
        </span>
      </div>
    </th>
  );
}

// ============================================================================
// MAIN DASHBOARD
// ============================================================================

export function WholesaleDashboard({
  data,
  loading,
  period,
  onPeriodChange,
  onRefresh,
}: WholesaleDashboardProps) {
  const [showAllCustomers, setShowAllCustomers] = useState(false);
  const [showAllAtRisk, setShowAllAtRisk] = useState(false);
  const [hideChurned, setHideChurned] = useState(true); // Hide churned by default
  const [selectedHealthFilter, setSelectedHealthFilter] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("revenue");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [aiInsights, setAiInsights] = useState<PatternInsightsResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // Fetch AI pattern insights
  useEffect(() => {
    if (!data) return;

    const fetchInsights = async () => {
      setAiLoading(true);
      try {
        const res = await fetch("/api/wholesale/insights");
        if (res.ok) {
          const insights = await res.json();
          setAiInsights(insights);
        }
      } catch (error) {
        console.error("Failed to fetch AI insights:", error);
      } finally {
        setAiLoading(false);
      }
    };

    fetchInsights();
  }, [data]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const sortedCustomers = useMemo(() => {
    const customers = [...(data?.topCustomers || [])];

    customers.sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case "revenue":
          comparison = b.total_revenue - a.total_revenue;
          break;
        case "orders":
          comparison = b.order_count - a.order_count;
          break;
        case "last_order":
          const aDate = a.last_sale_date ? new Date(a.last_sale_date).getTime() : 0;
          const bDate = b.last_sale_date ? new Date(b.last_sale_date).getTime() : 0;
          comparison = bDate - aDate;
          break;
        case "company":
          comparison = a.company_name.localeCompare(b.company_name);
          break;
      }

      return sortDirection === "desc" ? comparison : -comparison;
    });

    return customers;
  }, [data?.topCustomers, sortField, sortDirection]);

  const displayedCustomers = showAllCustomers ? sortedCustomers : sortedCustomers.slice(0, 10);

  const periodOptions = [
    { value: "mtd" as const, label: "MTD" },
    { value: "last_month" as const, label: "Last Month" },
    { value: "qtd" as const, label: "QTD" },
    { value: "ytd" as const, label: "YTD" },
    { value: "90d" as const, label: "90D" },
    { value: "12m" as const, label: "12M" },
  ];

  // Loading state with progress indicator
  const [loadingProgress, setLoadingProgress] = useState(0);

  useEffect(() => {
    if (loading && !data) {
      // Simulated progress (actual API doesn't support progress events)
      const progressInterval = setInterval(() => {
        setLoadingProgress(prev => {
          // Slow down as we approach 90% (never reaches 100% until data arrives)
          if (prev < 30) return prev + 3;
          if (prev < 60) return prev + 2;
          if (prev < 85) return prev + 0.5;
          return Math.min(prev + 0.1, 90);
        });
      }, 200);

      return () => {
        clearInterval(progressInterval);
      };
    } else {
      setLoadingProgress(0);
    }
  }, [loading, data]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-6 text-text-tertiary w-80">
          {/* Animated icon */}
          <div className="relative">
            <div className="absolute inset-0 animate-ping opacity-20">
              <BarChart3 className="w-10 h-10 text-accent-blue" />
            </div>
            <BarChart3 className="w-10 h-10 text-accent-blue animate-pulse" />
          </div>

          {/* Progress bar */}
          <div className="w-full">
            <div className="flex justify-between text-xs mb-2">
              <span className="text-text-secondary">Loading analytics...</span>
              <span className="text-text-muted font-mono">{Math.round(loadingProgress)}%</span>
            </div>
            <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-accent-blue to-accent-purple transition-all duration-200 ease-out rounded-full"
                style={{ width: `${loadingProgress}%` }}
              />
            </div>
          </div>

          {/* Status messages */}
          <div className="text-center space-y-1">
            <p className="text-xs text-text-muted">
              {loadingProgress < 30 && "Fetching customers & transactions..."}
              {loadingProgress >= 30 && loadingProgress < 60 && "Processing revenue data..."}
              {loadingProgress >= 60 && loadingProgress < 85 && "Calculating analytics..."}
              {loadingProgress >= 85 && "Almost there..."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // No data state
  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-6">
        <div className="p-6 rounded-full bg-bg-tertiary/50">
          <Building2 className="w-12 h-12 text-text-muted" />
        </div>
        <div className="text-center">
          <p className="text-lg text-text-secondary mb-2">No wholesale data available</p>
          <p className="text-xs text-text-muted">Data syncs from NetSuite</p>
        </div>
        <button
          onClick={onRefresh}
          className="flex items-center gap-2 px-5 py-2.5 bg-accent-blue text-white text-sm font-medium rounded-lg hover:bg-accent-blue/90 transition-all shadow-lg shadow-accent-blue/20"
        >
          <RefreshCw className="w-4 h-4" />
          Load Data
        </button>
      </div>
    );
  }

  const { stats, partialErrors } = data;

  return (
    <div className="space-y-8">
      {/* Partial errors banner */}
      {partialErrors && partialErrors.length > 0 && (
        <div className="flex items-start gap-3 p-4 bg-status-warning/10 border border-status-warning/30 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-status-warning flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-status-warning">Some data failed to load</p>
            <p className="text-xs text-text-secondary mt-1">
              {partialErrors.map(e => e.section).join(", ")} data is temporarily unavailable. Other metrics are still accurate.
            </p>
          </div>
        </div>
      )}

      {/* ================================================================
          HEADER ROW
          ================================================================ */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Building2 className="w-4 h-4 text-accent-blue" />
            <h2 className="text-[10px] uppercase tracking-[0.25em] text-text-muted font-semibold">
              WHOLESALE ANALYTICS
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-text-tertiary">{getPeriodLabel(period)}</span>
            {data.lastSynced && (
              <>
                <span className="text-text-muted">•</span>
                <span className="text-[10px] text-text-muted">
                  Updated {formatDistanceToNow(new Date(data.lastSynced), { addSuffix: true })}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Period Toggle */}
          <div className="flex items-center bg-bg-tertiary rounded-lg p-0.5 border border-border/20">
            {periodOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => onPeriodChange(option.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  period === option.value
                    ? "bg-accent-blue text-white shadow-sm"
                    : "text-text-tertiary hover:text-text-secondary"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

        </div>
      </div>

      {/* ================================================================
          HERO KPIs
          ================================================================ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <BreakdownCard
          label="Total Revenue"
          value={formatCurrency(stats.total_revenue)}
          subValue={`${stats.total_orders} orders`}
          delta={stats.revenue_delta_pct}
          icon={DollarSign}
          color="green"
        />
        <BreakdownCard
          label="Active Customers"
          value={stats.active_customers.toString()}
          subValue={`of ${stats.total_customers} total`}
          delta={stats.customers_delta_pct}
          description="Ordered in this period"
          icon={Users}
          color="blue"
        />
        <BreakdownCard
          label="Avg Order Value"
          value={formatCurrency(stats.avg_order_value)}
          icon={ShoppingCart}
          color="purple"
        />
{/* At Risk - Clickable to expand */}
        <button
          onClick={() => setShowAllAtRisk(!showAllAtRisk)}
          className="relative overflow-hidden bg-bg-secondary rounded-xl border border-status-warning/30 p-5 text-left hover:bg-status-warning/5 transition-all group"
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted mb-2">
                At Risk
              </div>
              <div className="text-2xl font-semibold tracking-tight text-status-warning tabular-nums">
                {stats.health_distribution.at_risk + stats.health_distribution.churning}
              </div>
              <div className="text-[10px] text-text-muted mt-1">
                {stats.health_distribution.at_risk} at risk • {stats.health_distribution.churning} churning
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-status-warning/10">
              <AlertTriangle className="w-4 h-4 text-status-warning" />
            </div>
          </div>
        </button>
      </div>

      {/* ================================================================
          CUSTOMER HEALTH - Minimal inline display
          ================================================================ */}
      <div className="px-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
          <button
            onClick={() => setSelectedHealthFilter(selectedHealthFilter === "churning" ? null : "churning")}
            className={`hover:underline transition-colors ${selectedHealthFilter === "churning" ? "underline" : ""}`}
          >
            <span className="text-status-bad font-medium">Churning ({stats.health_distribution.churning})</span>
          </button>
          <span className="text-text-muted/30">•</span>
          <button
            onClick={() => setSelectedHealthFilter(selectedHealthFilter === "at_risk" ? null : "at_risk")}
            className={`hover:underline transition-colors ${selectedHealthFilter === "at_risk" ? "underline" : ""}`}
          >
            <span className="text-orange-400 font-medium">At Risk ({stats.health_distribution.at_risk})</span>
          </button>
          <span className="text-text-muted/30">•</span>
          <button
            onClick={() => setSelectedHealthFilter(selectedHealthFilter === "declining" ? null : "declining")}
            className={`hover:underline transition-colors ${selectedHealthFilter === "declining" ? "underline" : ""}`}
          >
            <span className="text-status-warning font-medium">Declining ({stats.health_distribution.declining})</span>
          </button>
          <span className="text-text-muted/30">•</span>
          <button
            onClick={() => setSelectedHealthFilter(selectedHealthFilter === "thriving" ? null : "thriving")}
            className={`hover:underline transition-colors ${selectedHealthFilter === "thriving" ? "underline" : ""}`}
          >
            <span className="text-status-good font-medium">Thriving ({stats.health_distribution.thriving})</span>
          </button>
          <span className="text-text-muted/30">•</span>
          <button
            onClick={() => setSelectedHealthFilter(selectedHealthFilter === "stable" ? null : "stable")}
            className={`hover:underline transition-colors ${selectedHealthFilter === "stable" ? "underline" : ""}`}
          >
            <span className="text-accent-blue font-medium">Stable ({stats.health_distribution.stable})</span>
          </button>
          <span className="text-text-muted/30">•</span>
          <button
            onClick={() => setSelectedHealthFilter(selectedHealthFilter === "new" ? null : "new")}
            className={`hover:underline transition-colors ${selectedHealthFilter === "new" ? "underline" : ""}`}
          >
            <span className="text-purple-400 font-medium">New ({stats.health_distribution.new})</span>
          </button>
          <span className="text-text-muted/30">•</span>
          <button
            onClick={() => setSelectedHealthFilter(selectedHealthFilter === "one_time" ? null : "one_time")}
            className={`hover:underline transition-colors ${selectedHealthFilter === "one_time" ? "underline" : ""}`}
          >
            <span className="text-text-tertiary font-medium">One-Time ({stats.health_distribution.one_time})</span>
          </button>
          <span className="text-text-muted/30">•</span>
          <button
            onClick={() => setSelectedHealthFilter(selectedHealthFilter === "churned" ? null : "churned")}
            className={`hover:underline transition-colors ${selectedHealthFilter === "churned" ? "underline" : ""}`}
          >
            <span className="text-text-muted font-medium">Churned ({stats.health_distribution.churned})</span>
          </button>
        </div>

        {/* Revenue Mix: Corporate vs Standard B2B */}
        {stats.revenue_by_type && (
          <div className="mt-2 flex items-center gap-3 text-[12px] text-text-muted">
            <span className="text-[10px] uppercase tracking-[0.15em]">Revenue Mix</span>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                <span>
                  Corporate: <span className="text-purple-400 font-medium">{stats.revenue_by_type.corporate.revenue_pct}%</span>
                  <span className="text-text-tertiary ml-1">({formatCurrency(stats.revenue_by_type.corporate.revenue)})</span>
                </span>
              </div>
              <span className="text-text-muted/30">|</span>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-accent-blue"></span>
                <span>
                  B2B: <span className="text-accent-blue font-medium">{stats.revenue_by_type.standard_b2b.revenue_pct}%</span>
                  <span className="text-text-tertiary ml-1">({formatCurrency(stats.revenue_by_type.standard_b2b.revenue)})</span>
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Expandable Customer List */}
        {selectedHealthFilter && (
          <div className="mt-4 pt-4 border-t border-border/20">
            {/* Clickable header to collapse */}
            <button
              onClick={() => setSelectedHealthFilter(null)}
              className="w-full flex items-center justify-between mb-2 group cursor-pointer hover:bg-white/[0.02] -mx-2 px-2 py-1 rounded transition-colors"
            >
              <div className="text-left">
                <h4 className="text-[10px] uppercase tracking-[0.15em] text-text-muted font-medium">
                  {selectedHealthFilter.replace("_", " ")} customers
                </h4>
                <span className="text-[9px] text-text-tertiary">
                  {selectedHealthFilter === "churning" && "No orders in 90+ days"}
                  {selectedHealthFilter === "at_risk" && "Order frequency declining significantly"}
                  {selectedHealthFilter === "declining" && "Order frequency slowing down"}
                  {selectedHealthFilter === "thriving" && "Growing order volume or frequency"}
                  {selectedHealthFilter === "stable" && "Consistent ordering patterns"}
                  {selectedHealthFilter === "new" && "First order within 90 days"}
                  {selectedHealthFilter === "one_time" && "Only placed 1 order ever"}
                  {selectedHealthFilter === "churned" && "No orders in 12+ months"}
                </span>
              </div>
              <div className="flex items-center gap-2 text-text-muted group-hover:text-accent-blue transition-colors">
                <span className="text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">
                  Click to close
                </span>
                <ChevronUp className="w-4 h-4" />
              </div>
            </button>

            <div className="max-h-[400px] overflow-y-auto rounded-lg border border-border/20 animate-in fade-in slide-in-from-top-2 duration-200">
              {(() => {
                // Use the new customersByHealth field which has ALL customers for each status
                const healthKey = selectedHealthFilter as keyof typeof data.customersByHealth;
                const filteredCustomers = data.customersByHealth?.[healthKey] || [];

                if (filteredCustomers.length === 0) {
                  return (
                    <div className="p-4 text-center text-text-muted text-sm">
                      No customers with this status
                    </div>
                  );
                }

                return (
                  <table className="w-full">
                    <thead className="sticky top-0 z-10 bg-bg-tertiary/98 backdrop-blur-sm">
                      <tr className="border-b border-border/20">
                        <th className="py-2 px-3 text-left text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                          Customer
                        </th>
                        <th className="py-2 px-3 text-right text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                          Revenue
                        </th>
                        <th className="py-2 px-3 text-right text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                          Orders
                        </th>
                        <th className="py-2 px-3 text-right text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                          Last Order
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCustomers.map((customer) => (
                        <tr
                          key={customer.ns_customer_id}
                          className="border-b border-border/10 hover:bg-white/[0.02] transition-colors cursor-pointer"
                          onClick={() => window.location.href = `/sales/customer/${customer.ns_customer_id}`}
                        >
                          <td className="py-2 px-3">
                            <div className="text-sm text-text-primary truncate max-w-[200px] hover:text-accent-blue transition-colors">
                              {customer.company_name}
                            </div>
                          </td>
                          <td className="py-2 px-3 text-right">
                            <span className="text-sm text-status-good tabular-nums">
                              {formatCurrencyFull(customer.total_revenue)}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right">
                            <span className="text-sm text-text-secondary tabular-nums">
                              {customer.order_count.toLocaleString()}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right">
                            <span className={`text-sm tabular-nums ${
                              customer.days_since_last_order === null
                                ? "text-text-muted"
                                : customer.days_since_last_order > 180
                                ? "text-status-bad"
                                : customer.days_since_last_order > 90
                                ? "text-status-warning"
                                : "text-text-secondary"
                            }`}>
                              {customer.days_since_last_order !== null ? `${customer.days_since_last_order}d` : "—"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          </div>
        )}
      </div>

      {/* ================================================================
          MONTHLY TREND CHART (Compact)
          ================================================================ */}
      {data.monthly && data.monthly.length > 1 && (
        <MonthlyRevenueTrend monthly={data.monthly} period={period} />
      )}

      {/* ================================================================
          ORDERING ANOMALIES - Always visible (intelligent at-risk detection)
          ================================================================ */}
      {data.orderingAnomalies && data.orderingAnomalies.length > 0 && (
        <OrderingAnomaliesSection
          anomalies={data.orderingAnomalies}
          hideChurned={hideChurned}
          onToggleChurned={() => setHideChurned(!hideChurned)}
        />
      )}

      {/* ================================================================
          EXPANDED AT-RISK VIEW - Traditional fixed threshold (when clicked)
          ================================================================ */}
      {showAllAtRisk && data.atRiskCustomers && data.atRiskCustomers.length > 0 && (() => {
        const filteredAtRisk = hideChurned
          ? data.atRiskCustomers.filter(c => !c.is_churned)
          : data.atRiskCustomers;
        const churnedAtRiskCount = data.atRiskCustomers.filter(c => c.is_churned).length;

        return (
          <div className="bg-bg-secondary rounded-xl border border-border/30 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-status-warning" />
                <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
                  AT-RISK CUSTOMERS (FIXED THRESHOLD)
                </h3>
              </div>
              <div className="flex items-center gap-3">
                {churnedAtRiskCount > 0 && (
                  <button
                    onClick={() => setHideChurned(!hideChurned)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
                      hideChurned
                        ? "bg-accent-blue/20 text-accent-blue"
                        : "bg-text-muted/10 text-text-muted hover:bg-text-muted/20"
                    }`}
                  >
                    {hideChurned ? "Show" : "Hide"} {churnedAtRiskCount} churned
                  </button>
                )}
                <span className="text-[10px] text-text-muted">
                  {filteredAtRisk.length} customers • 120+ days since last order
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {filteredAtRisk.map((customer) => (
                <AtRiskCustomerCard key={customer.ns_customer_id} customer={customer} />
              ))}
            </div>
          </div>
        );
      })()}

      {/* ================================================================
          TOP CUSTOMERS + NEW CUSTOMERS (Side by Side)
          ================================================================ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* TOP CUSTOMERS TABLE (Left Half) */}
        <div className="bg-bg-secondary rounded-xl border border-border/30 overflow-hidden">
          <div className="px-5 py-4 border-b border-border/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-text-tertiary" />
              <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted font-semibold">
                TOP CUSTOMERS
              </h3>
            </div>
            <span className="text-[10px] text-text-muted">
              {sortedCustomers.length} customers
            </span>
          </div>

          {displayedCustomers.length > 0 ? (
            <>
              <div className="overflow-x-auto max-h-[450px] overflow-y-auto">
                <table className="w-full min-w-[500px]">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-border/20 bg-bg-tertiary/95 backdrop-blur-sm">
                      <th className="py-3 pl-4 pr-2 w-10 text-left text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                        #
                      </th>
                      <SortableHeader
                        label="Customer"
                        field="company"
                        currentSort={sortField}
                        currentDirection={sortDirection}
                        onSort={handleSort}
                        align="left"
                      />
                      <SortableHeader
                        label="Revenue"
                        field="revenue"
                        currentSort={sortField}
                        currentDirection={sortDirection}
                        onSort={handleSort}
                      />
                      <SortableHeader
                        label="Orders"
                        field="orders"
                        currentSort={sortField}
                        currentDirection={sortDirection}
                        onSort={handleSort}
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {displayedCustomers.map((customer, idx) => (
                      <tr
                        key={customer.ns_customer_id}
                        className="group border-b border-border/10 hover:bg-white/[0.02] transition-colors cursor-pointer"
                        onClick={() => window.location.href = `/sales/customer/${customer.ns_customer_id}`}
                      >
                        <td className="py-3 pl-4 pr-2 w-10">
                          <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold tabular-nums ${
                            idx < 3 ? "bg-status-good/20 text-status-good" : "text-text-muted"
                          }`}>
                            {idx + 1}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <div className="text-sm text-text-primary truncate max-w-[150px] font-medium">
                            {customer.company_name}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <SegmentBadge segment={customer.segment} isCorporate={customer.is_corporate_gifting} />
                            <HealthBadge status={customer.health_status} isCorporate={customer.is_corporate_gifting} />
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="text-sm font-semibold text-status-good tabular-nums">
                            {formatCurrencyFull(customer.total_revenue)}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="text-sm text-text-primary tabular-nums">
                            {customer.order_count.toLocaleString()}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {sortedCustomers.length > 10 && (
                <div className="px-4 py-3 border-t border-border/20 bg-bg-tertiary/20">
                  <button
                    onClick={() => setShowAllCustomers(!showAllCustomers)}
                    className="w-full py-2 text-sm text-accent-blue hover:text-accent-blue/80 flex items-center justify-center gap-1.5 transition-colors font-medium"
                  >
                    {showAllCustomers ? (
                      <>
                        Show Top 10 <ChevronUp className="w-4 h-4" />
                      </>
                    ) : (
                      <>
                        Show All {sortedCustomers.length} <ChevronDown className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-56 text-text-muted">
              <Building2 className="w-10 h-10 mb-3 opacity-40" />
              <span className="text-sm font-medium">No customer data</span>
              <span className="text-xs mt-1">Try a different time period</span>
            </div>
          )}
        </div>

        {/* NEW CUSTOMERS (Right Half) */}
        {data.newCustomers && data.newCustomers.length > 0 ? (
          <NewCustomersSection
            customers={data.newCustomers}
            acquisition={data.newCustomerAcquisition}
          />
        ) : (
          <div className="bg-bg-secondary rounded-xl border border-border/30 flex items-center justify-center h-full min-h-[300px]">
            <div className="text-center text-text-muted">
              <UserPlus className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No new customers in the last 90 days</p>
            </div>
          </div>
        )}
      </div>

      {/* ================================================================
          NEVER ORDERED + CHURNED CUSTOMERS (Side by Side)
          ================================================================ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* NEVER ORDERED CUSTOMERS - SALES OPPORTUNITIES (Left Half) */}
        {data.neverOrderedCustomers && data.neverOrderedCustomers.length > 0 ? (
          <NeverOrderedCustomersCard customers={data.neverOrderedCustomers} />
        ) : (
          <div className="bg-bg-secondary rounded-xl border border-border/30 flex items-center justify-center h-full min-h-[300px]">
            <div className="text-center text-text-muted">
              <Building2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No never-ordered customers found</p>
            </div>
          </div>
        )}

        {/* CHURNED CUSTOMERS (Right Half) */}
        {data.churnedCustomers && data.churnedCustomers.length > 0 ? (
          <ChurnedCustomersSection customers={data.churnedCustomers} />
        ) : (
          <div className="bg-bg-secondary rounded-xl border border-border/30 flex items-center justify-center h-full min-h-[300px]">
            <div className="text-center text-text-muted">
              <UserMinus className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No churned customers</p>
            </div>
          </div>
        )}
      </div>

      {/* ================================================================
          SEGMENT INTELLIGENCE (Full Width - Actionable Insights)
          ================================================================ */}
      {stats.segment_distribution && (
        <SegmentIntelligenceCard
          distribution={stats.segment_distribution}
          healthDistribution={stats.health_distribution}
          topCustomers={data.topCustomers || []}
          aiInsights={aiInsights}
          aiLoading={aiLoading}
        />
      )}

      {/* ================================================================
          RECENT TRANSACTIONS + CORPORATE CUSTOMERS (Side by Side)
          ================================================================ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* RECENT TRANSACTIONS (Left Half) */}
        {data.recentTransactions && data.recentTransactions.length > 0 ? (
          <RecentTransactionsSection transactions={data.recentTransactions} />
        ) : (
          <div className="bg-bg-secondary rounded-xl border border-border/30 flex items-center justify-center h-full min-h-[300px]">
            <div className="text-center text-text-muted">
              <Activity className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No recent transactions</p>
            </div>
          </div>
        )}

        {/* CORPORATE GIFTING CUSTOMERS (Right Half) */}
        {data.corporateCustomers && data.corporateCustomers.length > 0 ? (
          <CorporateCustomersSection customers={data.corporateCustomers} />
        ) : (
          <div className="bg-bg-secondary rounded-xl border border-border/30 flex items-center justify-center h-full min-h-[300px]">
            <div className="text-center text-text-muted">
              <Building2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No corporate gifting accounts</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
