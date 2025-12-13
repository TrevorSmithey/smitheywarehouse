"use client";

import { useState, useMemo } from "react";
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
} from "@/lib/types";

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

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return n.toLocaleString();
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
// SEGMENT / HEALTH BADGES
// ============================================================================

function SegmentBadge({ segment }: { segment: CustomerSegment }) {
  const config: Record<CustomerSegment, { label: string; color: string; tooltip: string }> = {
    major: { label: "MAJOR", color: "bg-status-good/20 text-status-good", tooltip: "Lifetime revenue $25,000+" },
    large: { label: "LARGE", color: "bg-accent-blue/20 text-accent-blue", tooltip: "Lifetime revenue $10,000 - $25,000" },
    mid: { label: "MID", color: "bg-purple-400/20 text-purple-400", tooltip: "Lifetime revenue $5,000 - $10,000" },
    small: { label: "SMALL", color: "bg-status-warning/20 text-status-warning", tooltip: "Lifetime revenue $1,000 - $5,000" },
    starter: { label: "STARTER", color: "bg-text-muted/20 text-text-secondary", tooltip: "Lifetime revenue $500 - $1,000" },
    minimal: { label: "MINIMAL", color: "bg-text-muted/10 text-text-muted", tooltip: "Lifetime revenue under $500" },
  };
  const { label, color, tooltip } = config[segment];
  return (
    <span
      className={`text-[9px] font-bold px-1.5 py-0.5 rounded cursor-help ${color}`}
      title={tooltip}
    >
      {label}
    </span>
  );
}

function HealthBadge({ status }: { status: CustomerHealthStatus }) {
  const config: Record<CustomerHealthStatus, { label: string; color: string; icon: React.ReactNode }> = {
    thriving: { label: "Thriving", color: "text-status-good", icon: <TrendingUp className="w-3 h-3" /> },
    stable: { label: "Stable", color: "text-accent-blue", icon: <CheckCircle className="w-3 h-3" /> },
    declining: { label: "Declining", color: "text-status-warning", icon: <TrendingDown className="w-3 h-3" /> },
    at_risk: { label: "At Risk", color: "text-status-warning", icon: <AlertTriangle className="w-3 h-3" /> },
    churning: { label: "Churning", color: "text-status-bad", icon: <AlertCircle className="w-3 h-3" /> },
    churned: { label: "Churned", color: "text-text-muted", icon: <Clock className="w-3 h-3" /> },
    new: { label: "New", color: "text-purple-400", icon: <Sparkles className="w-3 h-3" /> },
    one_time: { label: "One-Time", color: "text-text-tertiary", icon: <Target className="w-3 h-3" /> },
    never_ordered: { label: "Never Ordered", color: "text-amber-400", icon: <Users className="w-3 h-3" /> },
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
    <tr className="group border-b border-border/10 hover:bg-white/[0.02] transition-colors">
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
          <div className="text-sm text-text-primary truncate group-hover:text-accent-blue transition-colors font-medium">
            {customer.company_name}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <SegmentBadge segment={customer.segment} />
            <HealthBadge status={customer.health_status} />
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
          {customer.order_count}
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
    <div className={`rounded-lg border p-4 ${daysColor}`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-sm font-medium text-text-primary truncate max-w-[200px]">
            {customer.company_name}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <SegmentBadge segment={customer.segment} />
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
    </div>
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
          <span className="text-xs text-text-secondary">Revenue</span>
          <span className="text-sm font-semibold text-status-good tabular-nums">
            {formatCurrency(item.revenue)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-6">
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
      return {
        month: m.month,
        displayMonth: format(date, "MMM"),
        revenue: m.total_revenue,
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
    <div className="bg-bg-secondary rounded-xl border border-border/30 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <BarChart3 className="w-4 h-4 text-text-tertiary" />
            <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
              MONTHLY WHOLESALE REVENUE
            </h3>
          </div>
          <p className="text-xs text-text-muted">
            NetSuite wholesale transactions
          </p>
        </div>

        <div className="text-right">
          <div className="text-xl font-semibold text-text-primary tabular-nums">
            {formatCurrency(avgRevenue)}
          </div>
          <p className="text-[10px] text-text-muted uppercase tracking-wider">Avg/Month</p>
        </div>
      </div>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 5, left: 0 }}>
            <defs>
              <linearGradient id="wholesaleRevenueGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10B981" stopOpacity={0.8} />
                <stop offset="100%" stopColor="#10B981" stopOpacity={0.3} />
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

            <Bar dataKey="revenue" fill="url(#wholesaleRevenueGradient)" radius={[3, 3, 0, 0]} />
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
          <span className="text-[10px] text-text-tertiary font-medium">Revenue</span>
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
        {distribution.never_ordered > 0 && (
          <span className="text-amber-400"> • {distribution.never_ordered} never ordered</span>
        )}
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
          <div
            key={customer.ns_customer_id}
            className="flex items-center justify-between px-5 py-3 border-b border-border/10 hover:bg-white/[0.02] transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm text-text-primary truncate font-medium">
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
                  {customer.days_since_created < 30 ? "Hot lead" :
                   customer.days_since_created < 90 ? `${customer.days_since_created}d old` :
                   `${Math.floor(customer.days_since_created / 30)}mo old`}
                </div>
              )}
              {customer.category && (
                <div className="text-[10px] text-text-muted">
                  {customer.category}
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
// NEW CUSTOMERS - First-time buyers in last 90 days
// ============================================================================

function NewCustomersSection({ customers }: { customers: WholesaleCustomer[] }) {
  if (!customers || customers.length === 0) return null;

  return (
    <div className="bg-bg-secondary rounded-xl border border-status-good/30 overflow-hidden h-full">
      <div className="px-5 py-4 border-b border-border/20 flex items-center justify-between bg-status-good/5">
        <div className="flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-status-good" />
          <h3 className="text-[10px] uppercase tracking-[0.2em] text-status-good font-semibold">
            NEW CUSTOMERS
          </h3>
        </div>
        <span className="text-[10px] text-status-good font-medium">
          {customers.length} in last 90 days
        </span>
      </div>

      <div className="max-h-[450px] overflow-y-auto">
        {customers.map((customer, idx) => (
          <div
            key={customer.ns_customer_id}
            className="flex items-center justify-between px-5 py-3 border-b border-border/10 hover:bg-white/[0.02] transition-colors"
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span className="text-[10px] text-text-muted tabular-nums w-5">{idx + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-text-primary truncate font-medium">
                  {customer.company_name}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <SegmentBadge segment={customer.segment} />
                  <span className="text-[10px] text-text-muted">
                    {customer.order_count} order{customer.order_count !== 1 ? "s" : ""}
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
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// CHURNED CUSTOMERS - 365+ days since last order (excludes corporate)
// ============================================================================

function ChurnedCustomersSection({ customers }: { customers: WholesaleCustomer[] }) {
  if (!customers || customers.length === 0) return null;

  return (
    <div className="bg-bg-secondary rounded-xl border border-text-muted/30 overflow-hidden">
      <div className="px-5 py-4 border-b border-border/20 flex items-center justify-between bg-text-muted/5">
        <div className="flex items-center gap-2">
          <UserMinus className="w-4 h-4 text-text-muted" />
          <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted font-semibold">
            CHURNED CUSTOMERS
          </h3>
        </div>
        <span className="text-[10px] text-text-muted font-medium">
          {customers.length} accounts • 365+ days inactive
        </span>
      </div>

      <p className="px-5 py-3 text-xs text-text-tertiary border-b border-border/10">
        Former customers who haven&apos;t ordered in over a year. Excludes corporate/major accounts.
      </p>

      <div className="max-h-[400px] overflow-y-auto">
        {customers.map((customer) => (
          <div
            key={customer.ns_customer_id}
            className="flex items-center justify-between px-5 py-3 border-b border-border/10 hover:bg-white/[0.02] transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm text-text-primary truncate font-medium">
                {customer.company_name}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <SegmentBadge segment={customer.segment} />
                <span className="text-[10px] text-text-muted">
                  {customer.order_count} lifetime orders
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-medium text-text-secondary tabular-nums">
                {formatCurrencyFull(customer.total_revenue)}
              </div>
              {customer.days_since_last_order !== null && (
                <div className="text-[10px] text-text-muted tabular-nums">
                  {customer.days_since_last_order}d ago
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
    <div className={`rounded-lg border p-4 ${borderColor}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0 mr-3">
          <div className="text-sm font-medium text-text-primary truncate">
            {anomaly.company_name}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <SegmentBadge segment={anomaly.segment} />
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
            {anomaly.order_count}
          </span>
        </div>
        <div className="flex items-center justify-between pt-1 border-t border-border/20">
          <span className="text-text-muted">Lifetime value</span>
          <span className="font-semibold text-text-primary tabular-nums">
            {formatCurrencyFull(anomaly.total_revenue)}
          </span>
        </div>
      </div>
    </div>
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
  if (!anomalies || anomalies.length === 0) return null;

  const filtered = hideChurned ? anomalies.filter(a => !a.is_churned) : anomalies;
  const churnedCount = anomalies.filter(a => a.is_churned).length;

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
  const [sortField, setSortField] = useState<SortField>("revenue");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

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

  // Loading state
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-4 text-text-tertiary">
          <div className="relative">
            <Sparkles className="w-8 h-8 animate-pulse" />
          </div>
          <span className="text-sm">Loading wholesale analytics...</span>
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

  const { stats } = data;

  return (
    <div className="space-y-8">
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
                {(data.atRiskCustomers?.length || 0) + (data.orderingAnomalies?.length || 0)}
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-status-warning/10">
              <AlertTriangle className="w-4 h-4 text-status-warning" />
            </div>
          </div>
        </button>
      </div>

      {/* ================================================================
          CUSTOMER HEALTH SUMMARY
          ================================================================ */}
      <div className="bg-bg-secondary rounded-xl border border-border/30 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-text-tertiary" />
            <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
              CUSTOMER HEALTH SUMMARY
            </h3>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div className="text-center cursor-help" title="Growing revenue - ordered more recently than their typical pattern">
            <div className="text-2xl font-bold text-status-good tabular-nums">
              {stats.health_distribution.thriving}
            </div>
            <div className="text-[10px] text-text-muted">Thriving</div>
          </div>
          <div className="text-center cursor-help" title="Consistent ordering pattern - on track with typical behavior">
            <div className="text-2xl font-bold text-accent-blue tabular-nums">
              {stats.health_distribution.stable}
            </div>
            <div className="text-[10px] text-text-muted">Stable</div>
          </div>
          <div className="text-center cursor-help" title="Decreasing order frequency - ordering less often than usual">
            <div className="text-2xl font-bold text-status-warning tabular-nums">
              {stats.health_distribution.declining}
            </div>
            <div className="text-[10px] text-text-muted">Declining</div>
          </div>
          <div className="text-center cursor-help" title="90-120 days since last order - may need re-engagement">
            <div className="text-2xl font-bold text-status-warning tabular-nums">
              {stats.health_distribution.at_risk}
            </div>
            <div className="text-[10px] text-text-muted">At Risk</div>
          </div>
          <div className="text-center cursor-help" title="First order within the last 90 days">
            <div className="text-2xl font-bold text-purple-400 tabular-nums">
              {stats.health_distribution.new}
            </div>
            <div className="text-[10px] text-text-muted">New</div>
          </div>
          <div className="text-center cursor-help" title="365+ days since last order - considered inactive">
            <div className="text-2xl font-bold text-text-muted tabular-nums">
              {stats.health_distribution.churned}
            </div>
            <div className="text-[10px] text-text-muted">Churned</div>
          </div>
        </div>
      </div>

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
          MONTHLY TREND CHART
          ================================================================ */}
      {data.monthly && data.monthly.length > 1 && (
        <MonthlyRevenueTrend monthly={data.monthly} period={period} />
      )}

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
                      <tr key={customer.ns_customer_id} className="group border-b border-border/10 hover:bg-white/[0.02] transition-colors">
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
                          <div className="flex items-center gap-1 mt-0.5">
                            <SegmentBadge segment={customer.segment} />
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="text-sm font-semibold text-status-good tabular-nums">
                            {formatCurrencyFull(customer.total_revenue)}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="text-sm text-text-primary tabular-nums">
                            {customer.order_count}
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
          <NewCustomersSection customers={data.newCustomers} />
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
    </div>
  );
}
