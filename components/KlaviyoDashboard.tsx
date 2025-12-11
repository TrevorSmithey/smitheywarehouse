"use client";

import { useState, useMemo } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Mail,
  Calendar,
  DollarSign,
  Users,
  Zap,
  PieChart,
  ChevronDown,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type {
  KlaviyoResponse,
  KlaviyoCampaignSummary,
  KlaviyoUpcomingCampaign,
} from "@/lib/types";

type KlaviyoPeriod = "mtd" | "last_month" | "qtd" | "ytd" | "30d" | "90d";

interface KlaviyoDashboardProps {
  data: KlaviyoResponse | null;
  loading: boolean;
  period: KlaviyoPeriod;
  onPeriodChange: (period: KlaviyoPeriod) => void;
  onRefresh: () => void;
}

// Format currency
function formatCurrency(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(2)}M`;
  if (n >= 1000) return `$${Math.round(n / 1000)}K`;
  return `$${n.toFixed(0)}`;
}

// Format number with commas
function formatNumber(n: number): string {
  return n.toLocaleString();
}

// Format percentage
function formatPct(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `${n.toFixed(0)}%`;
}

// Format rate (0.45 -> 45%)
function formatRate(n: number | null): string {
  if (n === null || n === undefined) return "—";
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

// Headline KPI Card (large, prominent)
function HeadlineKPI({
  label,
  value,
  delta,
  isPositive,
  icon: Icon,
}: {
  label: string;
  value: string;
  delta?: string;
  isPositive?: boolean;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="bg-bg-secondary border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-text-tertiary" />
        <span className="text-xs font-medium uppercase tracking-wider text-text-secondary">
          {label}
        </span>
      </div>
      <div className="text-3xl font-light tracking-tight text-text-primary mb-1">
        {value}
      </div>
      {delta && (
        <div className={`flex items-center gap-1 text-sm font-medium ${
          isPositive ? "text-status-good" : "text-status-bad"
        }`}>
          {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
          {delta}
        </div>
      )}
    </div>
  );
}

// Campaign Row
function CampaignRow({
  campaign,
}: {
  campaign: KlaviyoCampaignSummary;
}) {
  return (
    <tr className="border-b border-border/50 hover:bg-white/5 transition-colors">
      <td className="py-3 pl-4 pr-2">
        <div className="max-w-[300px]">
          <div className="text-sm text-text-primary truncate">{campaign.name}</div>
          <div className="text-xs text-text-tertiary">
            {format(new Date(campaign.send_time), "MMM d, yyyy")}
          </div>
        </div>
      </td>
      <td className="py-3 px-2 text-right">
        <div className="text-sm text-text-primary font-medium">{formatCurrency(campaign.conversion_value)}</div>
      </td>
      <td className="py-3 px-2 text-right">
        <div className="text-sm text-text-primary">{formatNumber(campaign.recipients)}</div>
      </td>
      <td className="py-3 px-2 text-right">
        <div className="text-sm text-text-primary">{formatRate(campaign.open_rate)}</div>
      </td>
      <td className="py-3 px-2 text-right">
        <div className="text-sm text-text-primary">{formatRate(campaign.click_rate)}</div>
      </td>
      <td className="py-3 pl-2 pr-4 text-right">
        <div className="text-sm text-text-primary">{campaign.conversions}</div>
      </td>
    </tr>
  );
}

// Upcoming Campaign Card
function UpcomingCard({ campaign }: { campaign: KlaviyoUpcomingCampaign }) {
  const scheduledDate = new Date(campaign.scheduled_time);
  const isToday = new Date().toDateString() === scheduledDate.toDateString();
  const isTomorrow = new Date(Date.now() + 86400000).toDateString() === scheduledDate.toDateString();

  return (
    <div className="flex items-center gap-4 p-3 bg-bg-tertiary/50 rounded-lg">
      <div className={`w-10 h-10 rounded-lg flex flex-col items-center justify-center text-xs ${
        isToday ? "bg-status-warning/20 text-status-warning" :
        isTomorrow ? "bg-accent-blue/20 text-accent-blue" :
        "bg-bg-tertiary text-text-secondary"
      }`}>
        <span className="text-[9px] font-medium uppercase leading-none">{format(scheduledDate, "MMM")}</span>
        <span className="text-base font-semibold leading-none">{format(scheduledDate, "d")}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary truncate">{campaign.name}</div>
        <div className="text-xs text-text-tertiary">
          {format(scheduledDate, "h:mm a")}
        </div>
      </div>
      {campaign.audience_size && (
        <div className="text-right">
          <div className="text-sm text-text-primary font-medium">{formatNumber(campaign.audience_size)}</div>
          <div className="text-xs text-text-tertiary">audience</div>
        </div>
      )}
    </div>
  );
}

export function KlaviyoDashboard({
  data,
  loading,
  period,
  onPeriodChange,
  onRefresh,
}: KlaviyoDashboardProps) {
  const [showAllCampaigns, setShowAllCampaigns] = useState(false);

  // Sort campaigns by date (newest first)
  const sortedCampaigns = useMemo(() =>
    [...(data?.campaigns || [])].sort((a, b) =>
      new Date(b.send_time).getTime() - new Date(a.send_time).getTime()
    ),
    [data?.campaigns]
  );

  const displayedCampaigns = showAllCampaigns ? sortedCampaigns : sortedCampaigns.slice(0, 10);

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
        <p className="text-text-secondary">No email marketing data available</p>
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-medium text-text-primary">Email Performance</h2>
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
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-secondary border border-border text-sm text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Headline KPIs - matching your report format */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <HeadlineKPI
          label="Email Subscribers"
          value={formatNumber(stats.subscribers_365day)}
          icon={Users}
        />
        <HeadlineKPI
          label="Campaign Revenue"
          value={formatCurrency(stats.campaign_revenue)}
          delta={stats.revenue_delta_pct !== 0 ? `${stats.revenue_delta_pct > 0 ? "+" : ""}${stats.revenue_delta_pct.toFixed(0)}%` : undefined}
          isPositive={stats.revenue_delta_pct > 0}
          icon={Mail}
        />
        <HeadlineKPI
          label="Flow Revenue"
          value={formatCurrency(stats.flow_revenue)}
          icon={Zap}
        />
        <HeadlineKPI
          label="Email % of Revenue"
          value={formatPct(stats.email_pct_of_revenue)}
          icon={PieChart}
        />
      </div>

      {/* Secondary stats row */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-bg-secondary/50 border border-border/50 rounded-lg p-4 text-center">
          <div className="text-xl font-light text-text-primary">{formatNumber(stats.campaigns_sent)}</div>
          <div className="text-xs text-text-tertiary">Campaigns Sent</div>
        </div>
        <div className="bg-bg-secondary/50 border border-border/50 rounded-lg p-4 text-center">
          <div className="text-xl font-light text-text-primary">{formatNumber(stats.total_conversions)}</div>
          <div className="text-xs text-text-tertiary">Total Orders</div>
        </div>
        <div className="bg-bg-secondary/50 border border-border/50 rounded-lg p-4 text-center">
          <div className="text-xl font-light text-text-primary">{formatRate(stats.avg_open_rate)}</div>
          <div className="text-xs text-text-tertiary">Avg Open Rate</div>
        </div>
        <div className="bg-bg-secondary/50 border border-border/50 rounded-lg p-4 text-center">
          <div className="text-xl font-light text-text-primary">{formatRate(stats.avg_click_rate)}</div>
          <div className="text-xs text-text-tertiary">Avg Click Rate</div>
        </div>
      </div>

      {/* Two column: Campaigns + Scheduled */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Campaign Table */}
        <div className="lg:col-span-2 bg-bg-secondary border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-primary">Recent Campaigns</h3>
            <span className="text-xs text-text-tertiary">{sortedCampaigns.length} campaigns</span>
          </div>

          {displayedCampaigns.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px]">
                  <thead>
                    <tr className="border-b border-border bg-bg-tertiary/30">
                      <th className="py-2 pl-4 pr-2 text-left text-xs font-medium text-text-tertiary uppercase">Campaign</th>
                      <th className="py-2 px-2 text-right text-xs font-medium text-text-tertiary uppercase">Revenue</th>
                      <th className="py-2 px-2 text-right text-xs font-medium text-text-tertiary uppercase">Sent</th>
                      <th className="py-2 px-2 text-right text-xs font-medium text-text-tertiary uppercase">Open</th>
                      <th className="py-2 px-2 text-right text-xs font-medium text-text-tertiary uppercase">Click</th>
                      <th className="py-2 pl-2 pr-4 text-right text-xs font-medium text-text-tertiary uppercase">Orders</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedCampaigns.map((campaign) => (
                      <CampaignRow key={campaign.klaviyo_id} campaign={campaign} />
                    ))}
                  </tbody>
                </table>
              </div>
              {sortedCampaigns.length > 10 && (
                <div className="px-4 py-2 border-t border-border">
                  <button
                    onClick={() => setShowAllCampaigns(!showAllCampaigns)}
                    className="w-full py-1 text-sm text-accent-blue hover:text-accent-blue/80 flex items-center justify-center gap-1"
                  >
                    {showAllCampaigns ? "Show less" : `Show all ${sortedCampaigns.length}`}
                    <ChevronDown className={`w-4 h-4 transition-transform ${showAllCampaigns ? "rotate-180" : ""}`} />
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="h-32 flex items-center justify-center text-text-tertiary text-sm">
              No campaigns found
            </div>
          )}
        </div>

        {/* Upcoming Campaigns */}
        <div className="bg-bg-secondary border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-text-primary">Scheduled</h3>
            <Calendar className="w-4 h-4 text-text-tertiary" />
          </div>
          {upcoming.length > 0 ? (
            <div className="space-y-2 max-h-[320px] overflow-y-auto">
              {upcoming.map((campaign) => (
                <UpcomingCard key={campaign.klaviyo_id} campaign={campaign} />
              ))}
            </div>
          ) : (
            <div className="h-32 flex flex-col items-center justify-center gap-2 text-text-tertiary">
              <Calendar className="w-6 h-6" />
              <span className="text-sm">No campaigns scheduled</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
