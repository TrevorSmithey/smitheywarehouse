"use client";

import { useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Mail,
  MessageSquare,
  Calendar,
  DollarSign,
  Users,
  MousePointer,
  Eye,
  Target,
  ChevronDown,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";
import type {
  KlaviyoResponse,
  KlaviyoCampaignSummary,
  KlaviyoMonthlySummary,
  KlaviyoUpcomingCampaign,
  KlaviyoStats,
} from "@/lib/types";

type KlaviyoPeriod = "mtd" | "last_month" | "qtd" | "ytd" | "30d" | "90d";
type ChannelFilter = "all" | "email" | "sms";

interface KlaviyoDashboardProps {
  data: KlaviyoResponse | null;
  loading: boolean;
  period: KlaviyoPeriod;
  onPeriodChange: (period: KlaviyoPeriod) => void;
  channelFilter: ChannelFilter;
  onChannelFilterChange: (channel: ChannelFilter) => void;
  onRefresh: () => void;
}

// Format currency
function formatCurrency(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

// Format number with commas
function formatNumber(n: number): string {
  return n.toLocaleString();
}

// Format percentage (0.45 -> 45%)
function formatRate(n: number | null): string {
  if (n === null) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

// Get period label
function getPeriodLabel(period: KlaviyoPeriod): string {
  switch (period) {
    case "mtd": return "Month to Date";
    case "last_month": return "Last Month";
    case "qtd": return "Quarter to Date";
    case "ytd": return "Year to Date";
    case "30d": return "Last 30 Days";
    case "90d": return "Last 90 Days";
    default: return period;
  }
}

// Stat Card Component
function StatCard({
  label,
  value,
  delta,
  deltaLabel,
  icon: Icon,
  isPositiveGood = true,
}: {
  label: string;
  value: string;
  delta?: number;
  deltaLabel?: string;
  icon?: React.ComponentType<{ className?: string }>;
  isPositiveGood?: boolean;
}) {
  const isPositive = delta && delta > 0;
  const isNegative = delta && delta < 0;
  const deltaColor = isPositiveGood
    ? isPositive ? "text-status-good" : isNegative ? "text-status-bad" : "text-text-tertiary"
    : isNegative ? "text-status-good" : isPositive ? "text-status-bad" : "text-text-tertiary";

  return (
    <div className="bg-bg-secondary border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium uppercase tracking-wider text-text-secondary">
          {label}
        </span>
        {Icon && <Icon className="w-4 h-4 text-text-tertiary" />}
      </div>
      <div className="text-2xl font-light tracking-tight text-text-primary mb-1">
        {value}
      </div>
      {delta !== undefined && (
        <div className={`flex items-center gap-1 text-xs ${deltaColor}`}>
          {isPositive ? <TrendingUp className="w-3 h-3" /> : isNegative ? <TrendingDown className="w-3 h-3" /> : null}
          <span>
            {delta > 0 ? "+" : ""}{delta.toFixed(1)}% {deltaLabel || "vs prev period"}
          </span>
        </div>
      )}
    </div>
  );
}

// Campaign Row Component
function CampaignRow({ campaign }: { campaign: KlaviyoCampaignSummary }) {
  return (
    <div className="flex items-center gap-4 py-3 px-4 hover:bg-white/5 rounded-lg transition-colors">
      {/* Channel indicator */}
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
        campaign.channel === "email" ? "bg-accent-blue/20" : "bg-status-good/20"
      }`}>
        {campaign.channel === "email"
          ? <Mail className="w-4 h-4 text-accent-blue" />
          : <MessageSquare className="w-4 h-4 text-status-good" />
        }
      </div>

      {/* Campaign name & date */}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary truncate">{campaign.name}</div>
        <div className="text-xs text-text-tertiary">
          {format(new Date(campaign.send_time), "MMM d, yyyy 'at' h:mm a")}
        </div>
      </div>

      {/* Metrics */}
      <div className="hidden sm:flex items-center gap-6 text-xs">
        <div className="text-center w-16">
          <div className="text-text-primary font-medium">{formatNumber(campaign.recipients)}</div>
          <div className="text-text-tertiary">Sent</div>
        </div>
        <div className="text-center w-16">
          <div className="text-text-primary font-medium">{formatRate(campaign.open_rate)}</div>
          <div className="text-text-tertiary">Opens</div>
        </div>
        <div className="text-center w-16">
          <div className="text-text-primary font-medium">{formatRate(campaign.click_rate)}</div>
          <div className="text-text-tertiary">Clicks</div>
        </div>
        <div className="text-center w-20">
          <div className="text-status-good font-medium">{formatCurrency(campaign.conversion_value)}</div>
          <div className="text-text-tertiary">Revenue</div>
        </div>
      </div>
    </div>
  );
}

// Upcoming Campaign Row Component
function UpcomingCampaignRow({ campaign }: { campaign: KlaviyoUpcomingCampaign }) {
  const scheduledDate = new Date(campaign.scheduled_time);
  const isToday = new Date().toDateString() === scheduledDate.toDateString();
  const isTomorrow = new Date(Date.now() + 86400000).toDateString() === scheduledDate.toDateString();

  return (
    <div className="flex items-center gap-4 py-3 px-4 bg-bg-tertiary/50 rounded-lg">
      {/* Channel indicator */}
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
        campaign.channel === "email" ? "bg-accent-blue/20" : "bg-status-good/20"
      }`}>
        {campaign.channel === "email"
          ? <Mail className="w-4 h-4 text-accent-blue" />
          : <MessageSquare className="w-4 h-4 text-status-good" />
        }
      </div>

      {/* Campaign name & scheduled time */}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary truncate">{campaign.name}</div>
        <div className="flex items-center gap-2 text-xs">
          <Calendar className="w-3 h-3 text-text-tertiary" />
          <span className={isToday ? "text-status-warning font-medium" : isTomorrow ? "text-accent-blue" : "text-text-tertiary"}>
            {isToday ? "Today" : isTomorrow ? "Tomorrow" : format(scheduledDate, "EEE, MMM d")} at {format(scheduledDate, "h:mm a")}
          </span>
        </div>
      </div>

      {/* Predictions */}
      <div className="hidden sm:flex items-center gap-4 text-xs">
        {campaign.audience_size && (
          <div className="text-center w-20">
            <div className="text-text-primary font-medium">{formatNumber(campaign.audience_size)}</div>
            <div className="text-text-tertiary">Audience</div>
          </div>
        )}
        {campaign.predicted_revenue && (
          <div className="text-center w-20">
            <div className="text-status-good font-medium">{formatCurrency(campaign.predicted_revenue)}</div>
            <div className="text-text-tertiary">Est. Revenue</div>
          </div>
        )}
      </div>
    </div>
  );
}

export function KlaviyoDashboard({
  data,
  loading,
  period,
  onPeriodChange,
  channelFilter,
  onChannelFilterChange,
  onRefresh,
}: KlaviyoDashboardProps) {
  const [showAllCampaigns, setShowAllCampaigns] = useState(false);

  // Filter campaigns by channel
  const filteredCampaigns = data?.campaigns.filter((c) =>
    channelFilter === "all" || c.channel === channelFilter
  ) || [];

  // Prepare chart data - reverse to show oldest first
  const chartData = [...(data?.monthly || [])].reverse().map((m) => ({
    month: format(new Date(m.month_start), "MMM"),
    emailRevenue: m.email_revenue,
    smsRevenue: m.sms_revenue,
    totalRevenue: m.total_revenue,
    openRate: m.email_avg_open_rate ? m.email_avg_open_rate * 100 : null,
  }));

  // Loading state
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-text-tertiary" />
      </div>
    );
  }

  // No data state
  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Mail className="w-10 h-10 text-text-tertiary" />
        <p className="text-text-secondary">No marketing data available</p>
        <button
          onClick={onRefresh}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-blue/20 text-accent-blue text-sm hover:bg-accent-blue/30 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>
    );
  }

  const { stats, upcoming } = data;
  const displayedCampaigns = showAllCampaigns ? filteredCampaigns : filteredCampaigns.slice(0, 10);

  return (
    <div className="space-y-6">
      {/* Header with filters */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* Period selector */}
          <select
            value={period}
            onChange={(e) => onPeriodChange(e.target.value as KlaviyoPeriod)}
            className="bg-bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-blue/50"
          >
            <option value="mtd">Month to Date</option>
            <option value="last_month">Last Month</option>
            <option value="qtd">Quarter to Date</option>
            <option value="ytd">Year to Date</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
          </select>

          {/* Channel filter */}
          <div className="flex items-center gap-1 bg-bg-secondary border border-border rounded-lg p-1">
            <button
              onClick={() => onChannelFilterChange("all")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                channelFilter === "all" ? "bg-accent-blue text-white" : "text-text-secondary hover:text-text-primary"
              }`}
            >
              All
            </button>
            <button
              onClick={() => onChannelFilterChange("email")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                channelFilter === "email" ? "bg-accent-blue text-white" : "text-text-secondary hover:text-text-primary"
              }`}
            >
              Email
            </button>
            <button
              onClick={() => onChannelFilterChange("sms")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                channelFilter === "sms" ? "bg-accent-blue text-white" : "text-text-secondary hover:text-text-primary"
              }`}
            >
              SMS
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {data.lastSynced && (
            <span className="text-xs text-text-tertiary">
              Updated {formatDistanceToNow(new Date(data.lastSynced), { addSuffix: true })}
            </span>
          )}
          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-secondary border border-border text-sm text-text-secondary hover:text-text-primary hover:border-border-hover transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Total Revenue"
          value={formatCurrency(stats.total_revenue)}
          delta={stats.revenue_delta_pct}
          icon={DollarSign}
        />
        <StatCard
          label="Campaigns Sent"
          value={formatNumber(stats.campaigns_sent)}
          icon={Mail}
        />
        <StatCard
          label="Avg Open Rate"
          value={formatRate(stats.avg_open_rate)}
          icon={Eye}
        />
        <StatCard
          label="Avg Click Rate"
          value={formatRate(stats.avg_click_rate)}
          icon={MousePointer}
        />
      </div>

      {/* Two column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue Trend Chart */}
        <div className="bg-bg-secondary border border-border rounded-xl p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-4">
            Revenue Trend
          </h3>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="emailGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="smsGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#64748B", fontSize: 11 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#64748B", fontSize: 11 }}
                  tickFormatter={(v) => `$${v >= 1000 ? `${(v/1000).toFixed(0)}K` : v}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#12151F",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    color: "#fff",
                  }}
                  formatter={(value: number, name: string) => [
                    formatCurrency(value),
                    name === "emailRevenue" ? "Email" : name === "smsRevenue" ? "SMS" : "Total",
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="emailRevenue"
                  stroke="#3B82F6"
                  fill="url(#emailGradient)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="smsRevenue"
                  stroke="#10B981"
                  fill="url(#smsGradient)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-text-tertiary text-sm">
              No historical data available
            </div>
          )}
          <div className="flex items-center justify-center gap-6 mt-2">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-accent-blue" />
              <span className="text-xs text-text-secondary">Email</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-status-good" />
              <span className="text-xs text-text-secondary">SMS</span>
            </div>
          </div>
        </div>

        {/* Upcoming Campaigns */}
        <div className="bg-bg-secondary border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
              Upcoming Campaigns
            </h3>
            <span className="text-xs text-text-tertiary">Next 14 days</span>
          </div>
          {upcoming.length > 0 ? (
            <div className="space-y-2 max-h-[260px] overflow-y-auto">
              {upcoming.map((campaign) => (
                <UpcomingCampaignRow key={campaign.klaviyo_id} campaign={campaign} />
              ))}
            </div>
          ) : (
            <div className="h-[220px] flex flex-col items-center justify-center gap-2 text-text-tertiary">
              <Calendar className="w-8 h-8" />
              <span className="text-sm">No campaigns scheduled</span>
            </div>
          )}
        </div>
      </div>

      {/* Recent Campaigns Table */}
      <div className="bg-bg-secondary border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
            Recent Campaigns
          </h3>
          <span className="text-xs text-text-tertiary">
            {filteredCampaigns.length} campaigns in {getPeriodLabel(period).toLowerCase()}
          </span>
        </div>

        {displayedCampaigns.length > 0 ? (
          <>
            <div className="space-y-1">
              {displayedCampaigns.map((campaign) => (
                <CampaignRow key={campaign.klaviyo_id} campaign={campaign} />
              ))}
            </div>
            {filteredCampaigns.length > 10 && (
              <button
                onClick={() => setShowAllCampaigns(!showAllCampaigns)}
                className="w-full mt-4 py-2 text-sm text-accent-blue hover:text-accent-blue/80 transition-colors flex items-center justify-center gap-1"
              >
                {showAllCampaigns ? "Show less" : `Show all ${filteredCampaigns.length} campaigns`}
                <ChevronDown className={`w-4 h-4 transition-transform ${showAllCampaigns ? "rotate-180" : ""}`} />
              </button>
            )}
          </>
        ) : (
          <div className="h-32 flex items-center justify-center text-text-tertiary text-sm">
            No campaigns found for this period
          </div>
        )}
      </div>

      {/* Email vs SMS Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-bg-secondary border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-accent-blue/20 flex items-center justify-center">
              <Mail className="w-4 h-4 text-accent-blue" />
            </div>
            <h3 className="text-sm font-medium text-text-primary">Email Performance</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xl font-light text-text-primary">{formatCurrency(stats.email_revenue)}</div>
              <div className="text-xs text-text-tertiary">Revenue</div>
            </div>
            <div>
              <div className="text-xl font-light text-text-primary">{formatRate(stats.avg_open_rate)}</div>
              <div className="text-xs text-text-tertiary">Avg Open Rate</div>
            </div>
          </div>
        </div>

        <div className="bg-bg-secondary border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-status-good/20 flex items-center justify-center">
              <MessageSquare className="w-4 h-4 text-status-good" />
            </div>
            <h3 className="text-sm font-medium text-text-primary">SMS Performance</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xl font-light text-text-primary">{formatCurrency(stats.sms_revenue)}</div>
              <div className="text-xs text-text-tertiary">Revenue</div>
            </div>
            <div>
              <div className="text-xl font-light text-text-primary">{formatRate(stats.avg_click_rate)}</div>
              <div className="text-xs text-text-tertiary">Avg Click Rate</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
