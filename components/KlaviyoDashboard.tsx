"use client";

import { useState, useMemo } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Mail,
  Calendar,
  Zap,
  ChevronDown,
  ChevronUp,
  Users,
  MousePointerClick,
  Eye,
  ShoppingCart,
  ArrowUpRight,
  Minus,
} from "lucide-react";
import type {
  KlaviyoResponse,
  KlaviyoCampaignSummary,
  KlaviyoUpcomingCampaign,
} from "@/lib/types";

type KlaviyoPeriod = "mtd" | "last_month" | "qtd" | "ytd" | "30d" | "90d";
type SortField = "date" | "revenue" | "recipients" | "open_rate" | "click_rate" | "conversions";
type SortDirection = "asc" | "desc";

interface KlaviyoDashboardProps {
  data: KlaviyoResponse | null;
  loading: boolean;
  period: KlaviyoPeriod;
  onPeriodChange: (period: KlaviyoPeriod) => void;
  onRefresh: () => void;
}

// ============================================================================
// FORMATTING UTILITIES
// ============================================================================

function formatCurrency(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(2)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
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

function formatNumberFull(n: number): string {
  return n.toLocaleString();
}

function formatPct(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `${n.toFixed(0)}%`;
}

function formatRate(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function formatRatePct(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `${(n * 100).toFixed(0)}%`;
}

// ============================================================================
// HEADLINE METRIC CARD
// ============================================================================

function HeadlineMetric({
  label,
  value,
  subValue,
  delta,
  deltaLabel,
  icon: Icon,
  accentColor = "blue",
}: {
  label: string;
  value: string;
  subValue?: string;
  delta?: number | null;
  deltaLabel?: string;
  icon: React.ComponentType<{ className?: string }>;
  accentColor?: "blue" | "green" | "amber" | "purple";
}) {
  const iconColors = {
    blue: "text-accent-blue",
    green: "text-status-good",
    amber: "text-status-warning",
    purple: "text-purple-400",
  };

  const bgColors = {
    blue: "bg-accent-blue/10",
    green: "bg-status-good/10",
    amber: "bg-status-warning/10",
    purple: "bg-purple-400/10",
  };

  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30 p-5">
      <div className="flex items-start justify-between mb-3">
        <span className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
          {label}
        </span>
        <div className={`p-2 rounded-lg ${bgColors[accentColor]}`}>
          <Icon className={`w-4 h-4 ${iconColors[accentColor]}`} />
        </div>
      </div>

      <div className="text-3xl font-semibold tracking-tight text-text-primary tabular-nums mb-1">
        {value}
      </div>

      {subValue && (
        <div className="text-xs text-text-tertiary mb-2">
          {subValue}
        </div>
      )}

      {delta !== undefined && delta !== null && delta !== 0 && (
        <div className={`flex items-center gap-1.5 text-xs font-medium ${
          delta > 0 ? "text-status-good" : "text-status-bad"
        }`}>
          {delta > 0 ? (
            <TrendingUp className="w-3.5 h-3.5" />
          ) : (
            <TrendingDown className="w-3.5 h-3.5" />
          )}
          <span className="tabular-nums">
            {delta > 0 ? "+" : ""}{delta.toFixed(0)}%
          </span>
          {deltaLabel && (
            <span className="text-text-muted font-normal">{deltaLabel}</span>
          )}
        </div>
      )}

      {(delta === 0 || delta === null) && deltaLabel && (
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          <Minus className="w-3.5 h-3.5" />
          <span>{deltaLabel}</span>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SECONDARY STAT PILL
// ============================================================================

function StatPill({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-bg-tertiary/50 rounded-lg">
      <Icon className="w-4 h-4 text-text-tertiary" />
      <div>
        <div className="text-lg font-semibold text-text-primary tabular-nums">{value}</div>
        <div className="text-[10px] uppercase tracking-wider text-text-muted">{label}</div>
      </div>
    </div>
  );
}

// ============================================================================
// CAMPAIGN TABLE ROW
// ============================================================================

function CampaignRow({ campaign, rank }: { campaign: KlaviyoCampaignSummary; rank: number }) {
  const revenuePerRecipient = campaign.recipients > 0
    ? campaign.conversion_value / campaign.recipients
    : 0;

  return (
    <tr className="group border-b border-border/20 hover:bg-white/[0.02] transition-colors">
      {/* Rank */}
      <td className="py-3 pl-4 pr-2 w-10">
        <span className={`text-xs font-medium tabular-nums ${
          rank <= 3 ? "text-status-good" : "text-text-muted"
        }`}>
          {rank}
        </span>
      </td>

      {/* Campaign Name + Date */}
      <td className="py-3 px-2">
        <div className="max-w-[280px]">
          <div className="text-sm text-text-primary truncate group-hover:text-accent-blue transition-colors">
            {campaign.name}
          </div>
          <div className="text-[10px] text-text-muted mt-0.5">
            {format(new Date(campaign.send_time), "MMM d, yyyy • h:mm a")}
          </div>
        </div>
      </td>

      {/* Revenue */}
      <td className="py-3 px-2 text-right">
        <div className="text-sm font-semibold text-status-good tabular-nums">
          {formatCurrencyFull(campaign.conversion_value)}
        </div>
        <div className="text-[10px] text-text-muted tabular-nums">
          ${revenuePerRecipient.toFixed(2)}/recipient
        </div>
      </td>

      {/* Recipients */}
      <td className="py-3 px-2 text-right">
        <div className="text-sm text-text-primary tabular-nums">
          {formatNumberFull(campaign.recipients)}
        </div>
      </td>

      {/* Open Rate */}
      <td className="py-3 px-2 text-right">
        <div className={`text-sm tabular-nums ${
          (campaign.open_rate || 0) >= 0.5 ? "text-status-good" :
          (campaign.open_rate || 0) >= 0.3 ? "text-text-primary" :
          "text-status-warning"
        }`}>
          {formatRate(campaign.open_rate)}
        </div>
      </td>

      {/* Click Rate */}
      <td className="py-3 px-2 text-right">
        <div className={`text-sm tabular-nums ${
          (campaign.click_rate || 0) >= 0.02 ? "text-status-good" :
          (campaign.click_rate || 0) >= 0.01 ? "text-text-primary" :
          "text-status-warning"
        }`}>
          {formatRate(campaign.click_rate)}
        </div>
      </td>

      {/* Conversions */}
      <td className="py-3 pl-2 pr-4 text-right">
        <div className="text-sm text-text-primary tabular-nums font-medium">
          {campaign.conversions}
        </div>
      </td>
    </tr>
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
      className={`py-2 px-2 text-${align} cursor-pointer select-none group`}
      onClick={() => onSort(field)}
    >
      <div className={`inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider ${
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
// UPCOMING CAMPAIGN CARD
// ============================================================================

function UpcomingCard({ campaign }: { campaign: KlaviyoUpcomingCampaign }) {
  const scheduledDate = new Date(campaign.scheduled_time);
  const now = new Date();
  const isToday = now.toDateString() === scheduledDate.toDateString();
  const isTomorrow = new Date(Date.now() + 86400000).toDateString() === scheduledDate.toDateString();
  const daysUntil = Math.ceil((scheduledDate.getTime() - now.getTime()) / 86400000);

  return (
    <div className="flex items-center gap-4 p-3 bg-bg-tertiary/30 rounded-lg border border-border/20 hover:border-border/40 transition-all">
      {/* Date badge */}
      <div className={`flex flex-col items-center justify-center w-12 h-12 rounded-lg text-center ${
        isToday ? "bg-status-warning/20 text-status-warning" :
        isTomorrow ? "bg-accent-blue/20 text-accent-blue" :
        "bg-bg-tertiary text-text-secondary"
      }`}>
        <span className="text-[9px] font-medium uppercase leading-tight">
          {format(scheduledDate, "MMM")}
        </span>
        <span className="text-lg font-semibold leading-tight">
          {format(scheduledDate, "d")}
        </span>
      </div>

      {/* Campaign info */}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary truncate">{campaign.name}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-text-muted">
            {format(scheduledDate, "h:mm a")}
          </span>
          {isToday && (
            <span className="px-1.5 py-0.5 text-[9px] font-medium uppercase bg-status-warning/20 text-status-warning rounded">
              Today
            </span>
          )}
          {isTomorrow && (
            <span className="px-1.5 py-0.5 text-[9px] font-medium uppercase bg-accent-blue/20 text-accent-blue rounded">
              Tomorrow
            </span>
          )}
          {!isToday && !isTomorrow && daysUntil <= 7 && (
            <span className="text-[10px] text-text-tertiary">
              in {daysUntil} days
            </span>
          )}
        </div>
      </div>

      {/* Audience size */}
      {campaign.audience_size && campaign.audience_size > 0 && (
        <div className="text-right">
          <div className="text-sm font-medium text-text-primary tabular-nums">
            {formatNumber(campaign.audience_size)}
          </div>
          <div className="text-[10px] text-text-muted">audience</div>
        </div>
      )}

      {/* Predicted revenue */}
      {campaign.predicted_revenue && campaign.predicted_revenue > 0 && (
        <div className="text-right border-l border-border/30 pl-3">
          <div className="text-sm font-medium text-status-good tabular-nums">
            {formatCurrency(campaign.predicted_revenue)}
          </div>
          <div className="text-[10px] text-text-muted">predicted</div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN DASHBOARD
// ============================================================================

export function KlaviyoDashboard({
  data,
  loading,
  period,
  onPeriodChange,
  onRefresh,
}: KlaviyoDashboardProps) {
  const [showAllCampaigns, setShowAllCampaigns] = useState(false);
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  // Handle sort
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  // Sort campaigns
  const sortedCampaigns = useMemo(() => {
    const campaigns = [...(data?.campaigns || [])];

    campaigns.sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case "date":
          comparison = new Date(b.send_time).getTime() - new Date(a.send_time).getTime();
          break;
        case "revenue":
          comparison = b.conversion_value - a.conversion_value;
          break;
        case "recipients":
          comparison = b.recipients - a.recipients;
          break;
        case "open_rate":
          comparison = (b.open_rate || 0) - (a.open_rate || 0);
          break;
        case "click_rate":
          comparison = (b.click_rate || 0) - (a.click_rate || 0);
          break;
        case "conversions":
          comparison = b.conversions - a.conversions;
          break;
      }

      return sortDirection === "desc" ? comparison : -comparison;
    });

    return campaigns;
  }, [data?.campaigns, sortField, sortDirection]);

  const displayedCampaigns = showAllCampaigns ? sortedCampaigns : sortedCampaigns.slice(0, 10);

  // Period options
  const periodOptions = [
    { value: "mtd" as const, label: "MTD" },
    { value: "last_month" as const, label: "Last Month" },
    { value: "qtd" as const, label: "QTD" },
    { value: "ytd" as const, label: "YTD" },
    { value: "30d" as const, label: "30D" },
    { value: "90d" as const, label: "90D" },
  ];

  // Loading state
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-text-tertiary">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading email performance...</span>
        </div>
      </div>
    );
  }

  // No data state
  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Mail className="w-12 h-12 text-text-muted" />
        <div className="text-center">
          <p className="text-text-secondary mb-1">No email marketing data available</p>
          <p className="text-xs text-text-muted">Data syncs daily at 1 AM EST</p>
        </div>
        <button
          onClick={onRefresh}
          className="flex items-center gap-2 px-4 py-2 bg-accent-blue text-white text-sm font-medium rounded-lg hover:bg-accent-blue/90 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh Now
        </button>
      </div>
    );
  }

  const { stats, upcoming } = data;

  // Calculate totals
  const totalEmailRevenue = (stats.campaign_revenue || 0) + (stats.flow_revenue || 0);
  const campaignPct = totalEmailRevenue > 0
    ? ((stats.campaign_revenue || 0) / totalEmailRevenue) * 100
    : 0;
  const flowPct = totalEmailRevenue > 0
    ? ((stats.flow_revenue || 0) / totalEmailRevenue) * 100
    : 0;

  return (
    <div className="space-y-6">
      {/* ================================================================
          HEADER
          ================================================================ */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-[10px] uppercase tracking-[0.2em] text-text-muted mb-1">
            EMAIL PERFORMANCE
          </h2>
          {data.lastSynced && (
            <p className="text-[10px] text-text-muted">
              Updated {formatDistanceToNow(new Date(data.lastSynced), { addSuffix: true })}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Period Toggle */}
          <div className="flex items-center gap-0.5 bg-bg-tertiary rounded-lg p-0.5">
            {periodOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => onPeriodChange(option.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-all ${
                  period === option.value
                    ? "bg-accent-blue text-white"
                    : "text-text-tertiary hover:text-text-secondary"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-2 text-text-tertiary hover:text-text-secondary transition-colors disabled:opacity-50 rounded-lg hover:bg-white/5"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* ================================================================
          HEADLINE METRICS (4 Cards)
          ================================================================ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <HeadlineMetric
          label="Email Subscribers"
          value={formatNumber(stats.subscribers_365day || 0)}
          subValue="365-day engaged"
          icon={Users}
          accentColor="purple"
        />

        <HeadlineMetric
          label="Campaign Revenue"
          value={formatCurrency(stats.campaign_revenue || 0)}
          subValue={`${campaignPct.toFixed(0)}% of email revenue`}
          delta={stats.revenue_delta_pct}
          deltaLabel="vs prev period"
          icon={Mail}
          accentColor="green"
        />

        <HeadlineMetric
          label="Flow Revenue"
          value={formatCurrency(stats.flow_revenue || 0)}
          subValue={`${flowPct.toFixed(0)}% of email revenue`}
          icon={Zap}
          accentColor="amber"
        />

        <HeadlineMetric
          label="Email % of Revenue"
          value={formatPct(stats.email_pct_of_revenue || 0)}
          subValue="of total web revenue"
          icon={ArrowUpRight}
          accentColor="blue"
        />
      </div>

      {/* ================================================================
          SECONDARY STATS STRIP
          ================================================================ */}
      <div className="flex flex-wrap items-center gap-4">
        <StatPill
          label="Campaigns Sent"
          value={stats.campaigns_sent?.toString() || "0"}
          icon={Mail}
        />
        <StatPill
          label="Total Orders"
          value={formatNumber(stats.total_conversions || 0)}
          icon={ShoppingCart}
        />
        <StatPill
          label="Avg Open Rate"
          value={formatRatePct(stats.avg_open_rate)}
          icon={Eye}
        />
        <StatPill
          label="Avg Click Rate"
          value={formatRate(stats.avg_click_rate)}
          icon={MousePointerClick}
        />
      </div>

      {/* ================================================================
          MAIN CONTENT: Campaign Table + Upcoming
          ================================================================ */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        {/* Campaign Performance Table (3/4) */}
        <div className="xl:col-span-3 bg-bg-secondary rounded-xl border border-border/30 overflow-hidden">
          <div className="px-4 py-3 border-b border-border/20 flex items-center justify-between">
            <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
              CAMPAIGN PERFORMANCE
            </h3>
            <span className="text-[10px] text-text-muted">
              {sortedCampaigns.length} campaigns • sorted by {sortField.replace("_", " ")}
            </span>
          </div>

          {displayedCampaigns.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px]">
                  <thead>
                    <tr className="border-b border-border/20 bg-bg-tertiary/30">
                      <th className="py-2 pl-4 pr-2 w-10 text-left text-[10px] font-medium uppercase tracking-wider text-text-muted">
                        #
                      </th>
                      <SortableHeader
                        label="Campaign"
                        field="date"
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
                        label="Sent"
                        field="recipients"
                        currentSort={sortField}
                        currentDirection={sortDirection}
                        onSort={handleSort}
                      />
                      <SortableHeader
                        label="Open"
                        field="open_rate"
                        currentSort={sortField}
                        currentDirection={sortDirection}
                        onSort={handleSort}
                      />
                      <SortableHeader
                        label="Click"
                        field="click_rate"
                        currentSort={sortField}
                        currentDirection={sortDirection}
                        onSort={handleSort}
                      />
                      <SortableHeader
                        label="Orders"
                        field="conversions"
                        currentSort={sortField}
                        currentDirection={sortDirection}
                        onSort={handleSort}
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {displayedCampaigns.map((campaign, idx) => (
                      <CampaignRow
                        key={campaign.klaviyo_id}
                        campaign={campaign}
                        rank={idx + 1}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Show more/less button */}
              {sortedCampaigns.length > 10 && (
                <div className="px-4 py-2 border-t border-border/20">
                  <button
                    onClick={() => setShowAllCampaigns(!showAllCampaigns)}
                    className="w-full py-2 text-sm text-accent-blue hover:text-accent-blue/80 flex items-center justify-center gap-1 transition-colors"
                  >
                    {showAllCampaigns ? (
                      <>
                        Show top 10 <ChevronUp className="w-4 h-4" />
                      </>
                    ) : (
                      <>
                        Show all {sortedCampaigns.length} campaigns <ChevronDown className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-48 text-text-muted">
              <Mail className="w-8 h-8 mb-2 opacity-50" />
              <span className="text-sm">No campaigns found for this period</span>
            </div>
          )}
        </div>

        {/* Upcoming Campaigns (1/4) */}
        <div className="bg-bg-secondary rounded-xl border border-border/30 p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
              SCHEDULED
            </h3>
            <Calendar className="w-4 h-4 text-text-tertiary" />
          </div>

          {upcoming && upcoming.length > 0 ? (
            <div className="space-y-3 max-h-[400px] overflow-y-auto custom-scrollbar pr-1">
              {upcoming.map((campaign) => (
                <UpcomingCard key={campaign.klaviyo_id} campaign={campaign} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-48 text-text-muted">
              <Calendar className="w-8 h-8 mb-2 opacity-50" />
              <span className="text-sm">No campaigns scheduled</span>
              <span className="text-[10px] mt-1">Schedule in Klaviyo to see here</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
