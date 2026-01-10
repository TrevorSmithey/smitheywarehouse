"use client";

import { useMemo, useCallback, useState } from "react";
import {
  ComposedChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import {
  RefreshCw,
  Activity,
  Timer,
  Target,
  Award,
  AlertTriangle,
  ExternalLink,
  Clock,
  Download,
  Calendar,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type { RestorationResponse, RestorationRecord } from "@/app/api/restorations/route";
import { StaleTimestamp } from "@/components/StaleTimestamp";
import { useDashboard } from "@/app/(dashboard)/layout";
import { type RestorationDateRange, DATE_RANGE_OPTIONS } from "@/app/(dashboard)/restoration/layout";

interface RestorationAnalyticsProps {
  data: RestorationResponse | null;
  loading: boolean;
  onRefresh: () => void;
  onItemClick?: (restoration: RestorationRecord) => void;
  dateRange: RestorationDateRange;
  onDateRangeChange: (range: RestorationDateRange) => void;
}

// Pipeline stages (for CS action items)
const PIPELINE_STAGES = [
  "delivered_warehouse",
  "received",
  "at_restoration",
  "ready_to_ship",
] as const;

type PipelineStage = (typeof PIPELINE_STAGES)[number];

// Thresholds for CS callouts
const CS_THRESHOLDS = {
  delivered_warehouse: 2, // Contact if > 2 days
  at_restoration: 14, // Contact if > 14 days
  timeout_warning: 49, // 7 weeks (1 week before 8-week timeout)
};

// ============================================================================
// INTERNAL CYCLE TREND CHART (Recharts)
// ============================================================================

interface InternalCycleTrendChartProps {
  data: Array<{ month: string; medianDays: number; count: number; exceededSLA: number }>;
}

function InternalCycleTrendChart({ data }: InternalCycleTrendChartProps) {
  if (!data || data.length < 2) return null;

  // Format month for display - include year if > 12 months of data
  const showYear = data.length > 12;
  const formatMonth = (monthStr: string) => {
    const [year, month] = monthStr.split("-");
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthName = monthNames[parseInt(month) - 1] || month;
    if (showYear) {
      // Show 'Jan '24 format for multi-year views
      return `${monthName} '${year.slice(2)}`;
    }
    return monthName;
  };

  const chartData = data.map((d) => ({
    month: formatMonth(d.month),
    rawMonth: d.month, // Keep raw for tooltip
    days: d.medianDays,
    count: d.count,
    exceeded: d.exceededSLA,
  }));

  const maxDays = Math.max(...data.map((d) => d.medianDays), 25);
  const maxExceeded = Math.max(...data.map((d) => d.exceededSLA), 1);

  return (
    <div
      role="img"
      aria-label={`Internal cycle time trend chart showing ${data.length} months of data. Latest month: ${data[data.length - 1]?.medianDays || 0} days median cycle time.`}
    >
    <ResponsiveContainer width="100%" height={showYear ? 240 : 200}>
      <ComposedChart data={chartData} margin={{ top: 10, right: 40, left: 0, bottom: showYear ? 20 : 0 }}>
        <defs>
          <linearGradient id="cycleGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="month"
          stroke="#94A3B8"
          fontSize={showYear ? 9 : 11}
          tickLine={false}
          axisLine={false}
          interval={showYear ? Math.floor(chartData.length / 12) : 0}
          angle={showYear ? -45 : 0}
          textAnchor={showYear ? "end" : "middle"}
          height={showYear ? 50 : 30}
        />
        {/* Left Y-axis for cycle time (days) */}
        <YAxis
          yAxisId="days"
          stroke="#94A3B8"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={35}
          domain={[0, maxDays]}
          tickFormatter={(value) => `${value}d`}
        />
        {/* Right Y-axis for exceeded count */}
        <YAxis
          yAxisId="exceeded"
          orientation="right"
          stroke="#ef444480"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          width={30}
          domain={[0, Math.max(maxExceeded * 1.2, 5)]}
          tickFormatter={(value) => `${Math.round(value)}`}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#1E293B",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "8px",
            fontSize: "12px",
          }}
          labelStyle={{ color: "#E2E8F0", marginBottom: "4px" }}
          formatter={(value: number, name: string) => {
            if (name === "days") {
              return [<span key="v" style={{ color: "#f59e0b", fontWeight: 600 }}>{value}d</span>, "Median Cycle"];
            }
            if (name === "exceeded") {
              return [<span key="v" style={{ color: "#ef4444", fontWeight: 600 }}>{value}</span>, "Exceeded SLA"];
            }
            return [value, name];
          }}
        />
        <ReferenceLine
          yAxisId="days"
          y={21}
          stroke="#10b981"
          strokeDasharray="4 2"
          strokeOpacity={0.6}
          label={{ value: "21d SLA", position: "insideTopRight", fontSize: 10, fill: "#10b981", opacity: 0.8 }}
        />
        {/* Bar for exceeded SLA count - very light red */}
        <Bar
          yAxisId="exceeded"
          dataKey="exceeded"
          fill="#ef4444"
          fillOpacity={0.15}
          stroke="#ef4444"
          strokeOpacity={0.3}
          strokeWidth={1}
          radius={[2, 2, 0, 0]}
        />
        {/* Area for median cycle time */}
        <Area
          yAxisId="days"
          type="monotone"
          dataKey="days"
          stroke="#f59e0b"
          strokeWidth={2}
          fill="url(#cycleGradient)"
          dot={{ fill: "#f59e0b", strokeWidth: 0, r: 4 }}
          activeDot={{ fill: "#f59e0b", strokeWidth: 2, stroke: "#fff", r: 6 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
    </div>
  );
}

// ============================================================================
// STAGE BREAKDOWN BAR
// ============================================================================

interface StageBreakdownProps {
  internalCycle: {
    receivedToRestoration: number;
    atRestoration: number;
    restorationToShipped: number;
    totalInternal: number;
  };
}

function StageBreakdown({ internalCycle }: StageBreakdownProps) {
  const stages = [
    { label: "Check-in → Send Out", days: internalCycle.receivedToRestoration, color: "bg-emerald-500" },
    { label: "At Restoration", days: internalCycle.atRestoration, color: "bg-purple-500" },
    { label: "Back → Shipped", days: internalCycle.restorationToShipped, color: "bg-blue-500" },
  ];

  const maxStage = Math.max(...stages.map((s) => s.days || 0));

  return (
    <div className="space-y-3">
      {stages.map((stage) => {
        const width = maxStage > 0 ? ((stage.days || 0) / maxStage) * 100 : 0;
        return (
          <div key={stage.label}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-text-secondary">{stage.label}</span>
              <span className="text-sm font-semibold text-text-primary">{stage.days || 0}d</span>
            </div>
            <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
              <div
                className={`h-full ${stage.color} rounded-full transition-all`}
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        );
      })}
      <div className="pt-3 border-t border-border/30">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
            Your Total Time
          </span>
          <span
            className={`text-xl font-bold ${
              internalCycle.totalInternal <= 14
                ? "text-emerald-400"
                : internalCycle.totalInternal <= 21
                ? "text-amber-400"
                : "text-red-400"
            }`}
          >
            {internalCycle.totalInternal || 0}d
          </span>
        </div>
        <p className="text-[10px] text-text-muted mt-1">
          Median time from received to shipped (what you control)
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// CS ACTION ITEMS
// ============================================================================

interface CSActionItemsProps {
  restorations: RestorationRecord[];
  onItemClick?: (restoration: RestorationRecord) => void;
}

function CSActionItems({ restorations, onItemClick }: CSActionItemsProps) {
  // Group items by CS action type
  const deliveredTooLong = restorations.filter(
    (r) => r.status === "delivered_warehouse" && r.days_in_status > CS_THRESHOLDS.delivered_warehouse
  );

  const atRestorationTooLong = restorations.filter(
    (r) => r.status === "at_restoration" && r.days_in_status > CS_THRESHOLDS.at_restoration
  );

  const timeoutApproaching = restorations.filter(
    (r) =>
      PIPELINE_STAGES.includes(r.status as PipelineStage) &&
      r.total_days > CS_THRESHOLDS.timeout_warning
  );

  const hasItems = deliveredTooLong.length > 0 || atRestorationTooLong.length > 0 || timeoutApproaching.length > 0;

  if (!hasItems) {
    return (
      <div className="bg-bg-secondary border border-border rounded-lg p-4 text-center">
        <div className="text-text-secondary text-sm">No customers need proactive outreach right now</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Delivered > 2 days */}
      {deliveredTooLong.length > 0 && (
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full bg-orange-400" />
            <span className="text-sm font-semibold text-orange-400 uppercase tracking-wider">
              Delivered &gt; 2 Days ({deliveredTooLong.length})
            </span>
          </div>
          <p className="text-xs text-text-secondary mb-3">
            Customer may be asking &quot;where&apos;s my stuff?&quot; - item delivered but not checked in
          </p>
          <div className="space-y-2">
            {deliveredTooLong.slice(0, 5).map((item) => (
              <CSItem key={item.id} item={item} onItemClick={onItemClick} />
            ))}
            {deliveredTooLong.length > 5 && (
              <div className="text-xs text-text-muted">+{deliveredTooLong.length - 5} more</div>
            )}
          </div>
        </div>
      )}

      {/* At Restoration > 14 days */}
      {atRestorationTooLong.length > 0 && (
        <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full bg-purple-400" />
            <span className="text-sm font-semibold text-purple-400 uppercase tracking-wider">
              At Restoration &gt; 14 Days ({atRestorationTooLong.length})
            </span>
          </div>
          <p className="text-xs text-text-secondary mb-3">
            Consider proactive status update - customer hasn&apos;t heard from us in a while
          </p>
          <div className="space-y-2">
            {atRestorationTooLong.slice(0, 5).map((item) => (
              <CSItem key={item.id} item={item} onItemClick={onItemClick} />
            ))}
            {atRestorationTooLong.length > 5 && (
              <div className="text-xs text-text-muted">+{atRestorationTooLong.length - 5} more</div>
            )}
          </div>
        </div>
      )}

      {/* 8-week timeout approaching */}
      {timeoutApproaching.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-sm font-semibold text-red-400 uppercase tracking-wider">
              8-Week Timeout Approaching ({timeoutApproaching.length})
            </span>
          </div>
          <p className="text-xs text-text-secondary mb-3">
            Contact before auto-cancel - these orders are approaching the 8-week deadline
          </p>
          <div className="space-y-2">
            {timeoutApproaching.slice(0, 5).map((item) => (
              <CSItem key={item.id} item={item} showTotalDays onItemClick={onItemClick} />
            ))}
            {timeoutApproaching.length > 5 && (
              <div className="text-xs text-text-muted">+{timeoutApproaching.length - 5} more</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface CSItemProps {
  item: RestorationRecord;
  showTotalDays?: boolean;
  onItemClick?: (restoration: RestorationRecord) => void;
}

function CSItem({ item, showTotalDays, onItemClick }: CSItemProps) {
  return (
    <button
      onClick={() => onItemClick?.(item)}
      className="w-full flex items-center justify-between py-2 px-3 bg-bg-secondary/50 rounded hover:bg-bg-secondary transition-colors cursor-pointer text-left"
    >
      <div className="flex items-center gap-3">
        <span className="text-sm text-text-primary font-medium">
          {item.order_name || `#${item.id}`}
        </span>
        {item.shopify_order_id && (
          <a
            href={`https://admin.shopify.com/store/smithey-iron-ware/orders/${item.shopify_order_id}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-accent-blue hover:underline flex items-center gap-0.5"
          >
            Shopify
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-text-secondary">
        <Clock className="w-3 h-3" />
        <span className="tabular-nums font-medium">
          {showTotalDays ? `${item.total_days}d total` : `${item.days_in_status}d`}
        </span>
      </div>
    </button>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function RestorationAnalytics({ data, loading, onRefresh, onItemClick, dateRange, onDateRangeChange }: RestorationAnalyticsProps) {
  const { lastRefresh } = useDashboard();

  const stats = data?.stats;
  const restorations = data?.restorations || [];

  // Destructure the new stats structure for clarity
  const current = stats?.current;
  const period = stats?.period;
  const allTime = stats?.allTime;
  const internalCycleTrend = stats?.internalCycleTrend || [];

  // Export to CSV (uses server-filtered data)
  const handleExportCSV = useCallback(() => {
    if (!restorations.length) return;

    const headers = ["Order", "RMA", "Status", "Days in Status", "Total Days", "Created", "Is POS"];
    const rows = restorations.map((r) => [
      r.order_name || "",
      r.rma_number || "",
      r.status,
      r.days_in_status,
      r.total_days,
      r.created_at,
      r.is_pos ? "Yes" : "No",
    ]);

    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `restorations-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [restorations]);

  // State for expandable lists
  const [overdueExpanded, setOverdueExpanded] = useState(false);
  const [customerSideExpanded, setCustomerSideExpanded] = useState(false);
  const [atSmitheyExpanded, setAtSmitheyExpanded] = useState(false);

  // Helper: get internal start date (when Smithey's SLA clock starts)
  // POS orders: clock starts at ORDER creation (immediate possession)
  // Web orders: clock starts at delivery (or received_at fallback)
  const getInternalStart = (r: RestorationRecord): string | null => {
    if (r.is_pos) {
      // POS: use order_created_at (Shopify order date) - when customer dropped it off
      return r.order_created_at || r.delivered_to_warehouse_at || r.received_at;
    }
    return r.delivered_to_warehouse_at || r.received_at;
  };

  // Compute overdue items (items at Smithey past 21 days)
  // Clock starts when delivered_to_warehouse_at (or received_at fallback)
  const overdueItems = useMemo(() => {
    const AT_SMITHEY_STATUSES = ["delivered_warehouse", "received", "at_restoration", "ready_to_ship"];
    return restorations
      .filter(r => AT_SMITHEY_STATUSES.includes(r.status))
      .filter(r => {
        const internalStart = getInternalStart(r);
        if (!internalStart) return false; // Not at Smithey yet
        const internalDays = Math.floor((Date.now() - new Date(internalStart).getTime()) / (1000 * 60 * 60 * 24));
        return internalDays > 21;
      })
      .map(r => {
        const internalStart = getInternalStart(r);
        const internalDays = internalStart
          ? Math.floor((Date.now() - new Date(internalStart).getTime()) / (1000 * 60 * 60 * 24))
          : 0;
        return { ...r, _internalDays: internalDays };
      })
      .sort((a, b) => b._internalDays - a._internalDays); // Oldest first
  }, [restorations]);

  // Compute customer side items (label_sent or in_transit_inbound)
  const customerSideItems = useMemo(() => {
    return restorations
      .filter(r => r.status === "label_sent" || r.status === "in_transit_inbound")
      .map(r => {
        const daysSinceLabelSent = r.label_sent_at
          ? Math.floor((Date.now() - new Date(r.label_sent_at).getTime()) / (1000 * 60 * 60 * 24))
          : 0;
        return { ...r, _daysSinceLabelSent: daysSinceLabelSent };
      })
      .sort((a, b) => b._daysSinceLabelSent - a._daysSinceLabelSent); // Oldest first
  }, [restorations]);

  // Compute at Smithey items (delivered_warehouse through ready_to_ship)
  const atSmitheyItems = useMemo(() => {
    const AT_SMITHEY_STATUSES = ["delivered_warehouse", "received", "at_restoration", "ready_to_ship"];
    return restorations
      .filter(r => AT_SMITHEY_STATUSES.includes(r.status))
      .map(r => {
        const internalStart = getInternalStart(r);
        const daysSinceDelivered = internalStart
          ? Math.floor((Date.now() - new Date(internalStart).getTime()) / (1000 * 60 * 60 * 24))
          : 0;
        return { ...r, _daysSinceDelivered: daysSinceDelivered };
      })
      .sort((a, b) => b._daysSinceDelivered - a._daysSinceDelivered); // Oldest first
  }, [restorations]);

  // Get date range label for context
  const dateRangeLabel = DATE_RANGE_OPTIONS.find(o => o.value === dateRange)?.label || "All";

  // Loading skeleton
  if (loading && !data) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-12 bg-bg-secondary rounded-lg" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 bg-bg-secondary rounded-lg" />
          ))}
        </div>
        <div className="h-64 bg-bg-secondary rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ============================================================ */}
      {/* HEADER */}
      {/* ============================================================ */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-text-primary uppercase tracking-wider">
            Restoration Analytics
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <StaleTimestamp date={lastRefresh} prefix="Updated" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Date Range Toggle (chip-style, matching VoC pattern) */}
          <div className="flex items-center gap-0.5 bg-bg-tertiary rounded-lg p-0.5">
            {DATE_RANGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => onDateRangeChange(option.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-all ${
                  dateRange === option.value
                    ? "bg-accent-blue text-white"
                    : "text-text-tertiary hover:text-text-secondary"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {/* Export CSV */}
          <button
            onClick={handleExportCSV}
            disabled={!restorations.length}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-bg-secondary border border-border rounded-lg text-text-secondary hover:text-accent-blue transition-colors disabled:opacity-50"
            title="Export to CSV"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span>
          </button>

          {/* Refresh */}
          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-2 text-text-secondary hover:text-accent-blue transition-colors disabled:opacity-50"
            title="Refresh data"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* ============================================================ */}
      {/* CURRENT STATE (STOCK) - Always shows now, never filtered */}
      {/* ============================================================ */}
      {current && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
              Current State
            </h2>
            <span className="text-[10px] text-text-muted px-2 py-0.5 bg-bg-tertiary rounded">
              Live snapshot
            </span>
          </div>

          {/* Compact Metrics Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Customer Side - Expandable */}
            <div className="bg-bg-secondary rounded-lg border border-amber-500/20 overflow-hidden">
              <button
                onClick={() => customerSideItems.length > 0 && setCustomerSideExpanded(!customerSideExpanded)}
                className={`w-full p-3 text-left ${customerSideItems.length > 0 ? "cursor-pointer hover:bg-amber-500/5" : ""} transition-colors`}
                disabled={customerSideItems.length === 0}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-amber-500/10 rounded">
                      <Clock className="w-3.5 h-3.5 text-amber-400" />
                    </div>
                    <span className="text-[10px] text-text-tertiary uppercase tracking-wider">Customer Side</span>
                  </div>
                  {customerSideItems.length > 0 && (
                    customerSideExpanded ? (
                      <ChevronUp className="w-3.5 h-3.5 text-amber-400/60" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-amber-400/60" />
                    )
                  )}
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold text-amber-400">{current.preWarehouse}</span>
                  <span className="text-xs text-text-tertiary">pending</span>
                </div>
              </button>

              {/* Expanded list */}
              {customerSideExpanded && customerSideItems.length > 0 && (
                <div className="border-t border-amber-500/20 bg-amber-500/5 max-h-60 overflow-y-auto scrollbar-thin">
                  <div className="p-2 space-y-1.5">
                    {customerSideItems.map((item) => (
                      <button
                        key={item.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onItemClick?.(item);
                        }}
                        className="w-full flex items-center justify-between py-1.5 px-2 bg-bg-secondary/80 rounded hover:bg-bg-secondary transition-colors text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-text-primary font-medium">
                            {item.order_name || `#${item.id}`}
                          </span>
                          <span className={`text-[9px] px-1 py-0.5 rounded ${
                            item.status === "in_transit_inbound" ? "bg-blue-500/20 text-blue-400" :
                            "bg-amber-500/20 text-amber-400"
                          }`}>
                            {data?.statusConfig[item.status]?.label || item.status}
                          </span>
                        </div>
                        <span className="text-[10px] text-amber-400 font-medium tabular-nums">
                          {item._daysSinceLabelSent}d
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* At Smithey - Expandable */}
            <div className="bg-bg-secondary rounded-lg border border-emerald-500/20 overflow-hidden">
              <button
                onClick={() => atSmitheyItems.length > 0 && setAtSmitheyExpanded(!atSmitheyExpanded)}
                className={`w-full p-3 text-left ${atSmitheyItems.length > 0 ? "cursor-pointer hover:bg-emerald-500/5" : ""} transition-colors`}
                disabled={atSmitheyItems.length === 0}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-emerald-500/10 rounded">
                      <Target className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                    <span className="text-[10px] text-text-tertiary uppercase tracking-wider">At Smithey</span>
                  </div>
                  {atSmitheyItems.length > 0 && (
                    atSmitheyExpanded ? (
                      <ChevronUp className="w-3.5 h-3.5 text-emerald-400/60" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-emerald-400/60" />
                    )
                  )}
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold text-emerald-400">{current.inHouse}</span>
                  <span className="text-xs text-text-tertiary">in-house</span>
                </div>
              </button>

              {/* Expanded list */}
              {atSmitheyExpanded && atSmitheyItems.length > 0 && (
                <div className="border-t border-emerald-500/20 bg-emerald-500/5 max-h-60 overflow-y-auto scrollbar-thin">
                  <div className="p-2 space-y-1.5">
                    {atSmitheyItems.map((item) => (
                      <button
                        key={item.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onItemClick?.(item);
                        }}
                        className="w-full flex items-center justify-between py-1.5 px-2 bg-bg-secondary/80 rounded hover:bg-bg-secondary transition-colors text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-text-primary font-medium">
                            {item.order_name || `#${item.id}`}
                          </span>
                          <span className={`text-[9px] px-1 py-0.5 rounded ${
                            item.status === "at_restoration" ? "bg-purple-500/20 text-purple-400" :
                            item.status === "received" ? "bg-cyan-500/20 text-cyan-400" :
                            item.status === "ready_to_ship" ? "bg-blue-500/20 text-blue-400" :
                            "bg-emerald-500/20 text-emerald-400"
                          }`}>
                            {data?.statusConfig[item.status]?.label || item.status}
                          </span>
                        </div>
                        <span className={`text-[10px] font-medium tabular-nums ${
                          item._daysSinceDelivered > 21 ? "text-red-400" :
                          item._daysSinceDelivered > 14 ? "text-amber-400" :
                          "text-emerald-400"
                        }`}>
                          {item._daysSinceDelivered}d
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Overdue Count - Clickable to expand */}
            <div
              className={`bg-bg-secondary rounded-lg border overflow-hidden ${current.overdueCount > 0 ? "border-red-500/30" : "border-emerald-500/20"}`}
              aria-label={`${current.overdueCount} items overdue, past 21-day SLA target.`}
            >
              <button
                onClick={() => current.overdueCount > 0 && setOverdueExpanded(!overdueExpanded)}
                className={`w-full p-3 text-left ${current.overdueCount > 0 ? "cursor-pointer hover:bg-red-500/5" : ""} transition-colors`}
                disabled={current.overdueCount === 0}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <div className={`p-1.5 rounded ${current.overdueCount > 0 ? "bg-red-500/10" : "bg-emerald-500/10"}`}>
                      <AlertTriangle className={`w-3.5 h-3.5 ${current.overdueCount > 0 ? "text-red-400" : "text-emerald-400"}`} />
                    </div>
                    <span className="text-[10px] text-text-tertiary uppercase tracking-wider">Overdue</span>
                  </div>
                  {current.overdueCount > 0 && (
                    overdueExpanded ? (
                      <ChevronUp className="w-3.5 h-3.5 text-red-400/60" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-red-400/60" />
                    )
                  )}
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className={`text-2xl font-bold ${current.overdueCount > 0 ? "text-red-400" : "text-emerald-400"}`}>
                    {current.overdueCount}
                  </span>
                  <span className="text-xs text-text-tertiary">&gt;21d</span>
                </div>
              </button>

              {/* Expanded list of overdue items */}
              {overdueExpanded && overdueItems.length > 0 && (
                <div className="border-t border-red-500/20 bg-red-500/5 max-h-60 overflow-y-auto scrollbar-thin">
                  <div className="p-2 space-y-1.5">
                    {overdueItems.map((item) => (
                      <button
                        key={item.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onItemClick?.(item);
                        }}
                        className="w-full flex items-center justify-between py-1.5 px-2 bg-bg-secondary/80 rounded hover:bg-bg-secondary transition-colors text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-text-primary font-medium">
                            {item.order_name || `#${item.id}`}
                          </span>
                          <span className={`text-[9px] px-1 py-0.5 rounded ${
                            item.status === "at_restoration" ? "bg-purple-500/20 text-purple-400" :
                            item.status === "received" ? "bg-cyan-500/20 text-cyan-400" :
                            item.status === "ready_to_ship" ? "bg-blue-500/20 text-blue-400" :
                            "bg-emerald-500/20 text-emerald-400"
                          }`}>
                            {data?.statusConfig[item.status]?.label || item.status}
                          </span>
                        </div>
                        <span className="text-[10px] text-red-400 font-medium tabular-nums">
                          {item._internalDays}d
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* PERIOD PERFORMANCE (FLOW) - Filtered by shipped_at */}
      {/* ============================================================ */}
      {period && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
              Performance ({dateRangeLabel})
            </h2>
            <span className="text-[10px] text-text-muted px-2 py-0.5 bg-bg-tertiary rounded">
              {period.completed} shipped
            </span>
          </div>

          {/* Compact Performance Metrics - Single Row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {/* Internal Cycle Time (what you control) */}
            <div
              className="bg-bg-secondary rounded-lg p-3 border border-amber-500/20"
              aria-label={`Internal cycle time: ${period.internalMedian} days from received to shipped.`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <div className="p-1.5 bg-amber-500/10 rounded">
                  <Timer className="w-3.5 h-3.5 text-amber-400" />
                </div>
                <span className="text-[10px] text-text-tertiary uppercase tracking-wider">Your Cycle</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className={`text-2xl font-bold ${
                  period.internalMedian <= 14 ? "text-emerald-400" :
                  period.internalMedian <= 21 ? "text-amber-400" : "text-red-400"
                }`}>{period.internalMedian || "—"}</span>
                <span className="text-xs text-text-tertiary">days</span>
              </div>
              <div className="mt-1 text-[10px] text-text-muted">
                Received → Shipped
              </div>
            </div>

            {/* SLA Rate */}
            <div
              className="bg-bg-secondary rounded-lg p-3 border border-border"
              aria-label={`SLA rate: ${period.slaRate}%. ${period.meetingSLA} of ${period.completed} shipped within 21 days.`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <div className="p-1.5 bg-emerald-500/10 rounded">
                  <Target className="w-3.5 h-3.5 text-emerald-400" />
                </div>
                <span className="text-[10px] text-text-tertiary uppercase tracking-wider">SLA Rate</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className={`text-2xl font-bold ${
                  period.slaRate >= 80 ? "text-emerald-400" :
                  period.slaRate >= 60 ? "text-amber-400" : "text-red-400"
                }`}>{period.slaRate}%</span>
                <span className="text-xs text-text-tertiary">≤21d</span>
              </div>
              <div className="mt-1 text-[10px] text-text-muted">
                {period.meetingSLA}/{period.completed} on time
              </div>
            </div>

            {/* D2C Cycle */}
            <div className="bg-bg-secondary rounded-lg p-3 border border-border">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="p-1.5 bg-sky-500/10 rounded">
                  <Clock className="w-3.5 h-3.5 text-sky-400" />
                </div>
                <span className="text-[10px] text-text-tertiary uppercase tracking-wider">D2C</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className={`text-2xl font-bold ${
                  (period.d2cInternalMedian || 0) <= 21 ? "text-sky-400" : "text-amber-400"
                }`}>{period.d2cInternalMedian || "—"}</span>
                <span className="text-xs text-text-tertiary">days</span>
              </div>
              <div className="mt-1 text-[10px] text-text-muted">
                Online orders
              </div>
            </div>

            {/* POS Cycle */}
            <div className="bg-bg-secondary rounded-lg p-3 border border-border">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="p-1.5 bg-purple-500/10 rounded">
                  <Clock className="w-3.5 h-3.5 text-purple-400" />
                </div>
                <span className="text-[10px] text-text-tertiary uppercase tracking-wider">POS</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className={`text-2xl font-bold ${
                  (period.posInternalMedian || 0) <= 21 ? "text-purple-400" : "text-amber-400"
                }`}>{period.posInternalMedian || "—"}</span>
                <span className="text-xs text-text-tertiary">days</span>
              </div>
              <div className="mt-1 text-[10px] text-text-muted">
                In-store orders
              </div>
            </div>

            {/* Avg Internal */}
            <div className="bg-bg-secondary rounded-lg p-3 border border-border">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="p-1.5 bg-amber-500/10 rounded">
                  <Timer className="w-3.5 h-3.5 text-amber-400" />
                </div>
                <span className="text-[10px] text-text-tertiary uppercase tracking-wider">Avg</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className={`text-2xl font-bold ${
                  period.internalAvg <= 14 ? "text-emerald-400" :
                  period.internalAvg <= 21 ? "text-amber-400" : "text-red-400"
                }`}>{period.internalAvg}</span>
                <span className="text-xs text-text-tertiary">days</span>
              </div>
              <div className="mt-1 text-[10px] text-text-muted">
                Average cycle
              </div>
            </div>

            {/* Total Cycle (for reference) */}
            <div className="bg-bg-secondary rounded-lg p-3 border border-border/50">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="p-1.5 bg-bg-tertiary rounded">
                  <Clock className="w-3.5 h-3.5 text-text-tertiary" />
                </div>
                <span className="text-[10px] text-text-muted uppercase tracking-wider">Total</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-text-secondary">{period.medianCycleTime}</span>
                <span className="text-xs text-text-muted">days</span>
              </div>
              <div className="mt-1 text-[10px] text-text-muted">
                Incl. customer time
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* INTERNAL CYCLE TREND - THE KEY CHART */}
      {/* ============================================================ */}
      {internalCycleTrend.length >= 2 && (
        <div className="bg-gradient-to-br from-amber-500/5 to-bg-secondary rounded-xl border border-amber-500/20 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-text-primary uppercase tracking-wider">
                Your Cycle Time Trend
              </h2>
              <p className="text-xs text-text-muted mt-1">
                By intake month (cohort) • Bars show exceeded 21-day SLA
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-amber-400">
                {internalCycleTrend[internalCycleTrend.length - 1]?.medianDays || "—"}d
              </div>
              <div className="text-[10px] text-text-muted uppercase">Latest Month</div>
            </div>
          </div>
          <InternalCycleTrendChart data={internalCycleTrend.filter((m) => m.count > 0)} />
        </div>
      )}

      {/* ============================================================ */}
      {/* CS ACTION ITEMS + STAGE BREAKDOWN */}
      {/* ============================================================ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* CS Action Items - 2 cols */}
        <div className="lg:col-span-2">
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
            CS Action Items
          </h2>
          <CSActionItems restorations={restorations} onItemClick={onItemClick} />
        </div>

        {/* Stage Breakdown - 1 col */}
        {period?.internalCycle && (
          <div className="bg-bg-secondary rounded-lg border border-border p-4">
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-4">
              Stage Breakdown ({dateRangeLabel})
            </h2>
            <StageBreakdown internalCycle={period.internalCycle} />
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* ALL-TIME STATS (BENCHMARK) - Never filtered */}
      {/* ============================================================ */}
      {allTime && (
        <div className="bg-bg-secondary rounded-lg border border-border p-4">
          <div className="flex items-center gap-2 mb-4">
            <Award className="w-4 h-4 text-text-tertiary" />
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
              All-Time Benchmarks
            </h2>
            <span className="text-[10px] text-text-muted px-2 py-0.5 bg-bg-tertiary rounded">
              Historical reference
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Total Processed */}
            <div>
              <div className="text-xs text-text-tertiary uppercase tracking-wider mb-1">Total Processed</div>
              <div className="text-2xl font-bold text-text-primary">{allTime.totalProcessed.toLocaleString()}</div>
              <div className="text-xs text-text-secondary mt-1">
                {allTime.completedCount.toLocaleString()} completed
              </div>
            </div>

            {/* Completion Rate */}
            <div>
              <div className="text-xs text-text-tertiary uppercase tracking-wider mb-1">Completion Rate</div>
              <div
                className={`text-2xl font-bold ${
                  allTime.completionRate >= 90
                    ? "text-emerald-400"
                    : allTime.completionRate >= 70
                    ? "text-amber-400"
                    : "text-red-400"
                }`}
              >
                {allTime.completionRate}%
              </div>
              <div className="mt-1 h-1.5 bg-bg-tertiary rounded-full overflow-hidden max-w-[120px]">
                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${allTime.completionRate}%` }} />
              </div>
            </div>

            {/* Avg Cycle Time */}
            <div>
              <div className="text-xs text-text-tertiary uppercase tracking-wider mb-1">Avg Cycle Time</div>
              <div className="text-2xl font-bold text-text-primary">
                {allTime.avgCycleTime || "—"}
                <span className="text-sm font-normal text-text-tertiary ml-1">days</span>
              </div>
              <div className="text-xs text-text-secondary mt-1">
                {(allTime.avgCycleTime || 0) <= 21 ? (
                  <span className="text-emerald-400">Within target</span>
                ) : (
                  <span className="text-amber-400">Above 21d target</span>
                )}
              </div>
            </div>

            {/* Oldest Active */}
            <div>
              <div className="text-xs text-text-tertiary uppercase tracking-wider mb-1">Oldest Active</div>
              {allTime.oldestActiveDate ? (
                <>
                  <div className="text-2xl font-bold text-text-primary flex items-center gap-1.5">
                    <Calendar className="w-5 h-5 text-text-tertiary" />
                    {new Date(allTime.oldestActiveDate).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </div>
                  <div className="text-xs text-text-secondary mt-1">
                    {Math.floor(
                      (Date.now() - new Date(allTime.oldestActiveDate).getTime()) / (1000 * 60 * 60 * 24)
                    )}{" "}
                    days ago
                  </div>
                </>
              ) : (
                <div className="text-2xl font-bold text-text-muted">—</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
