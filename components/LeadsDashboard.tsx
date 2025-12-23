"use client";

import { useState, useMemo } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  Users,
  ChevronDown,
  ChevronUp,
  Building2,
  Gift,
  Sparkles, // Used in FitScore and table headers
  Loader2,
  TrendingUp,
  ExternalLink,
  Mail,
  MapPin,
  Calendar,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type {
  LeadsResponse,
  TypeformLead,
  LeadFormType,
} from "@/lib/types";
import { StaleTimestamp } from "@/components/StaleTimestamp";

// ============================================================================
// COMPONENT PROPS
// ============================================================================

interface LeadsDashboardProps {
  data: LeadsResponse | null;
  loading: boolean;
  error?: string | null;
  onRefresh: () => void;
}

// ============================================================================
// FORMATTING UTILITIES
// ============================================================================

function formatCurrency(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

// ============================================================================
// FORM TYPE INDICATOR
// ============================================================================

function FormTypeIndicator({ formType }: { formType: LeadFormType }) {
  const isWholesale = formType === "wholesale";
  return (
    <div
      className={`
        inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider
        ${isWholesale
          ? "bg-accent-blue/10 text-accent-blue"
          : "bg-purple-400/10 text-purple-400"
        }
      `}
    >
      {isWholesale ? <Building2 className="w-3 h-3" /> : <Gift className="w-3 h-3" />}
      {isWholesale ? "B2B" : "Corporate"}
    </div>
  );
}

// ============================================================================
// AI FIT SCORE
// ============================================================================

function FitScore({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <div className="flex items-center gap-1.5 text-text-muted">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span className="text-xs">Analyzing...</span>
      </div>
    );
  }

  // Score visualization with gradient bar
  const scoreColors: Record<number, { bg: string; text: string; label: string }> = {
    1: { bg: "bg-status-bad/20", text: "text-status-bad", label: "Poor" },
    2: { bg: "bg-orange-500/20", text: "text-orange-400", label: "Weak" },
    3: { bg: "bg-status-warning/20", text: "text-status-warning", label: "Maybe" },
    4: { bg: "bg-accent-blue/20", text: "text-accent-blue", label: "Good" },
    5: { bg: "bg-status-good/20", text: "text-status-good", label: "Great" },
  };

  const config = scoreColors[score] || scoreColors[3];

  return (
    <div className="flex items-center gap-2">
      {/* Score dots */}
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={`w-1.5 h-4 rounded-full transition-all ${
              i <= score ? config.bg : "bg-border/30"
            }`}
          />
        ))}
      </div>
      <span className={`text-xs font-medium ${config.text}`}>
        {config.label}
      </span>
    </div>
  );
}

// ============================================================================
// PIPELINE HEADER - The Hero Metrics
// ============================================================================

function PipelineHeader({ data }: { data: LeadsResponse }) {
  const { funnel } = data;

  return (
    <div className="grid grid-cols-5 gap-4">
      {/* Total Leads */}
      <div className="bg-surface-secondary rounded-xl border border-border/30 p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] uppercase tracking-[0.15em] text-text-muted">Total Leads</span>
          <span className="text-[10px] text-text-muted/60">T365</span>
        </div>
        <div className="text-3xl font-semibold text-text-primary tabular-nums tracking-tight">
          {funnel.total_leads}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <div className="flex items-center gap-1 text-xs text-text-tertiary">
            <Building2 className="w-3 h-3 text-accent-blue" />
            <span>{funnel.wholesale_leads}</span>
          </div>
          <span className="text-text-muted">/</span>
          <div className="flex items-center gap-1 text-xs text-text-tertiary">
            <Gift className="w-3 h-3 text-purple-400" />
            <span>{funnel.corporate_leads}</span>
          </div>
        </div>
      </div>

      {/* Converted */}
      <div className="bg-surface-secondary rounded-xl border border-border/30 p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] uppercase tracking-[0.15em] text-text-muted">Converted</span>
          <TrendingUp className="w-3.5 h-3.5 text-status-good" />
        </div>
        <div className="text-3xl font-semibold text-status-good tabular-nums tracking-tight">
          {funnel.converted_leads}
        </div>
        <div className="text-xs text-text-tertiary mt-2">
          {funnel.conversion_rate.toFixed(1)}% conversion rate
        </div>
      </div>

      {/* First Order Revenue */}
      <div className="bg-surface-secondary rounded-xl border border-border/30 p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] uppercase tracking-[0.15em] text-text-muted">Revenue</span>
        </div>
        <div className="text-3xl font-semibold text-accent-blue tabular-nums tracking-tight">
          {formatCurrency(funnel.total_conversion_revenue)}
        </div>
        <div className="text-xs text-text-tertiary mt-2">
          from converted leads
        </div>
      </div>

      {/* Avg Days to Convert */}
      <div className="bg-surface-secondary rounded-xl border border-border/30 p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] uppercase tracking-[0.15em] text-text-muted">Avg Time</span>
          <Calendar className="w-3.5 h-3.5 text-text-muted" />
        </div>
        <div className="text-3xl font-semibold text-text-primary tabular-nums tracking-tight">
          {funnel.avg_days_to_conversion !== null ? funnel.avg_days_to_conversion.toFixed(0) : "—"}
        </div>
        <div className="text-xs text-text-tertiary mt-2">
          days to first order
        </div>
      </div>

      {/* AI Score Distribution */}
      <div className="bg-surface-secondary rounded-xl border border-border/30 p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] uppercase tracking-[0.15em] text-text-muted">AI Scores</span>
          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
        </div>
        {funnel.ai_score_distribution ? (
          <div className="space-y-1.5">
            {/* Score bars */}
            {[
              { key: "great", label: "Great", color: "bg-status-good", value: funnel.ai_score_distribution.great },
              { key: "good", label: "Good", color: "bg-accent-blue", value: funnel.ai_score_distribution.good },
              { key: "maybe", label: "Maybe", color: "bg-status-warning", value: funnel.ai_score_distribution.maybe },
              { key: "weak", label: "Weak", color: "bg-orange-400", value: funnel.ai_score_distribution.weak },
              { key: "poor", label: "Poor", color: "bg-status-bad", value: funnel.ai_score_distribution.poor },
            ].map((item) => {
              const total = funnel.ai_score_distribution!.great + funnel.ai_score_distribution!.good +
                           funnel.ai_score_distribution!.maybe + funnel.ai_score_distribution!.weak +
                           funnel.ai_score_distribution!.poor;
              const pct = total > 0 ? (item.value / total) * 100 : 0;
              return (
                <div key={item.key} className="flex items-center gap-2">
                  <span className="text-[10px] text-text-muted w-10">{item.label}</span>
                  <div className="flex-1 h-2 bg-surface-primary rounded-full overflow-hidden">
                    <div
                      className={`h-full ${item.color} rounded-full transition-all duration-500`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-text-tertiary tabular-nums w-6 text-right">{item.value}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-text-muted">No score data</div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// CONVERSION FUNNEL - Visual Pipeline
// ============================================================================

function ConversionFunnel({ data }: { data: LeadsResponse }) {
  const { funnel } = data;

  const stages = [
    {
      label: "B2B Wholesale",
      icon: Building2,
      color: "#0EA5E9",
      total: funnel.wholesale.total,
      converted: funnel.wholesale.converted,
      rate: funnel.wholesale.conversion_rate,
      avgDays: funnel.wholesale.avg_days_to_conversion,
    },
    {
      label: "Corporate Gifting",
      icon: Gift,
      color: "#A78BFA",
      total: funnel.corporate.total,
      converted: funnel.corporate.converted,
      rate: funnel.corporate.conversion_rate,
      avgDays: funnel.corporate.avg_days_to_conversion,
    },
  ];

  const maxTotal = Math.max(...stages.map(s => s.total), 1);

  return (
    <div className="bg-surface-secondary rounded-xl border border-border/30 p-5">
      <h3 className="text-[10px] uppercase tracking-[0.15em] text-text-muted mb-5">
        Conversion by Channel
      </h3>

      <div className="space-y-4">
        {stages.map((stage) => {
          const Icon = stage.icon;
          const widthPct = (stage.total / maxTotal) * 100;
          const conversionWidth = stage.total > 0 ? (stage.converted / stage.total) * 100 : 0;

          return (
            <div key={stage.label} className="space-y-2">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4" style={{ color: stage.color }} />
                  <span className="text-sm font-medium text-text-primary">{stage.label}</span>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-text-tertiary">{stage.total} leads</span>
                  <span className="font-medium" style={{ color: stage.color }}>
                    {stage.rate.toFixed(1)}%
                  </span>
                </div>
              </div>

              {/* Funnel Bar */}
              <div className="relative h-8">
                {/* Total bar (background) */}
                <div
                  className="absolute inset-y-0 left-0 rounded-lg transition-all duration-500"
                  style={{
                    width: `${widthPct}%`,
                    backgroundColor: `${stage.color}15`,
                  }}
                />
                {/* Converted bar (foreground) */}
                <div
                  className="absolute inset-y-0 left-0 rounded-lg transition-all duration-500 flex items-center"
                  style={{
                    width: `${(widthPct * conversionWidth) / 100}%`,
                    backgroundColor: `${stage.color}40`,
                    minWidth: stage.converted > 0 ? "60px" : "0",
                  }}
                >
                  {stage.converted > 0 && (
                    <span className="ml-3 text-xs font-semibold" style={{ color: stage.color }}>
                      {stage.converted} converted
                    </span>
                  )}
                </div>
              </div>

              {/* Metrics */}
              <div className="flex items-center gap-4 text-[11px] text-text-tertiary pl-6">
                <span>
                  Avg {stage.avgDays !== null ? `${stage.avgDays.toFixed(0)} days` : "—"} to convert
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// VOLUME TREND - Monthly Chart
// ============================================================================

function VolumeTrend({ data }: { data: LeadsResponse }) {
  const chartData = useMemo(() => {
    return data.volume_trend.map((item) => ({
      period: item.period,
      wholesale: item.wholesale,
      corporate: item.corporate,
      total: item.total,
    }));
  }, [data.volume_trend]);

  if (chartData.length === 0) {
    return null;
  }

  return (
    <div className="bg-surface-secondary rounded-xl border border-border/30 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[10px] uppercase tracking-[0.15em] text-text-muted">
          Volume Trend
        </h3>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-accent-blue" />
            <span className="text-[10px] text-text-tertiary">B2B</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-purple-400" />
            <span className="text-[10px] text-text-tertiary">Corporate</span>
          </div>
        </div>
      </div>

      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id="wholesaleGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0EA5E9" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#0EA5E9" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="corporateGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#A78BFA" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#A78BFA" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="period"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#64748B", fontSize: 10 }}
              tickFormatter={(v) => {
                const [, month] = v.split("-");
                return month;
              }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#64748B", fontSize: 10 }}
              width={25}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#12151F",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "8px",
                fontSize: "11px",
              }}
              labelFormatter={(label) => {
                const [year, month] = String(label).split("-");
                const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                return `${months[parseInt(month) - 1]} ${year}`;
              }}
            />
            <Area
              type="monotone"
              dataKey="wholesale"
              stroke="#0EA5E9"
              strokeWidth={2}
              fill="url(#wholesaleGrad)"
              name="B2B"
            />
            <Area
              type="monotone"
              dataKey="corporate"
              stroke="#A78BFA"
              strokeWidth={2}
              fill="url(#corporateGrad)"
              name="Corporate"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ============================================================================
// LEADS TABLE - Primary Interface
// ============================================================================

function LeadsTable({ leads, totalCount }: { leads: TypeformLead[]; totalCount: number }) {
  const [sortField, setSortField] = useState<"submitted_at" | "ai_fit_score">("submitted_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filterType, setFilterType] = useState<LeadFormType | "all">("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const filteredAndSortedLeads = useMemo(() => {
    let filtered = leads;
    if (filterType !== "all") {
      filtered = leads.filter(l => l.form_type === filterType);
    }

    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortField === "submitted_at") {
        cmp = new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime();
      } else if (sortField === "ai_fit_score") {
        const scoreA = a.ai_fit_score ?? 0;
        const scoreB = b.ai_fit_score ?? 0;
        cmp = scoreA - scoreB;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [leads, sortField, sortDir, filterType]);

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  if (leads.length === 0) {
    return (
      <div className="bg-surface-secondary rounded-xl border border-border/30 p-12 text-center">
        <Users className="w-12 h-12 text-text-muted mx-auto mb-4" />
        <p className="text-text-secondary font-medium">No leads yet</p>
        <p className="text-xs text-text-muted mt-1">
          Leads will appear here when form submissions come in
        </p>
      </div>
    );
  }

  return (
    <div className="bg-surface-secondary rounded-xl border border-border/30 overflow-hidden">
      {/* Table Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium text-text-primary">Recent Leads</h3>
          <span className="text-xs text-text-muted bg-surface-primary px-2 py-0.5 rounded-full">
            {totalCount}
          </span>
        </div>

        {/* Filter Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilterType("all")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              filterType === "all"
                ? "bg-surface-primary text-text-primary"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilterType("wholesale")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
              filterType === "wholesale"
                ? "bg-accent-blue/10 text-accent-blue"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            <Building2 className="w-3 h-3" />
            B2B
          </button>
          <button
            onClick={() => setFilterType("corporate")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
              filterType === "corporate"
                ? "bg-purple-400/10 text-purple-400"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            <Gift className="w-3 h-3" />
            Corporate
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-surface-primary/30">
            <tr>
              <th className="text-left px-5 py-3 text-[10px] font-medium text-text-muted uppercase tracking-wider">
                Company
              </th>
              <th className="text-left px-4 py-3 text-[10px] font-medium text-text-muted uppercase tracking-wider">
                Type
              </th>
              <th className="text-left px-4 py-3 text-[10px] font-medium text-text-muted uppercase tracking-wider">
                <button
                  onClick={() => toggleSort("submitted_at")}
                  className="flex items-center gap-1 hover:text-text-secondary transition-colors"
                >
                  Submitted
                  {sortField === "submitted_at" && (
                    sortDir === "desc" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />
                  )}
                </button>
              </th>
              <th className="text-left px-4 py-3 text-[10px] font-medium text-text-muted uppercase tracking-wider">
                <button
                  onClick={() => toggleSort("ai_fit_score")}
                  className="flex items-center gap-1 hover:text-text-secondary transition-colors"
                >
                  <Sparkles className="w-3 h-3" />
                  AI Fit
                  {sortField === "ai_fit_score" && (
                    sortDir === "desc" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />
                  )}
                </button>
              </th>
              <th className="text-left px-4 py-3 text-[10px] font-medium text-text-muted uppercase tracking-wider">
                Summary
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/20">
            {filteredAndSortedLeads.map((lead) => (
              <>
                <tr
                  key={lead.id}
                  className="group hover:bg-surface-primary/20 transition-colors cursor-pointer"
                  onClick={() => setExpandedId(expandedId === lead.id ? null : lead.id)}
                >
                  <td className="px-5 py-4">
                    <div className="flex items-start gap-3">
                      <div>
                        <div className="font-medium text-text-primary group-hover:text-accent-blue transition-colors">
                          {lead.company_name}
                        </div>
                        {lead.city && lead.state && (
                          <div className="flex items-center gap-1 text-xs text-text-muted mt-0.5">
                            <MapPin className="w-3 h-3" />
                            {lead.city}, {lead.state}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <FormTypeIndicator formType={lead.form_type} />
                  </td>
                  <td className="px-4 py-4">
                    <div className="text-sm text-text-secondary">
                      {format(new Date(lead.submitted_at), "MMM d, yyyy")}
                    </div>
                    <div className="text-xs text-text-muted">
                      {formatDistanceToNow(new Date(lead.submitted_at), { addSuffix: true })}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <FitScore score={lead.ai_fit_score} />
                  </td>
                  <td className="px-4 py-4 max-w-xs">
                    {lead.ai_summary ? (
                      <p className="text-xs text-text-secondary line-clamp-2">{lead.ai_summary}</p>
                    ) : (
                      <p className="text-xs text-text-muted italic">Pending analysis...</p>
                    )}
                  </td>
                </tr>
                {/* Expanded Row */}
                {expandedId === lead.id && (
                  <tr className="bg-surface-primary/40">
                    <td colSpan={5} className="px-5 py-4">
                      <div className="grid grid-cols-4 gap-6">
                        {/* Contact Info */}
                        <div>
                          <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-2">Contact</h4>
                          <div className="space-y-1.5">
                            {(lead.contact_first_name || lead.contact_last_name) && (
                              <div className="text-sm text-text-primary">
                                {[lead.contact_first_name, lead.contact_last_name].filter(Boolean).join(" ")}
                                {lead.contact_title && (
                                  <span className="text-text-muted ml-1">({lead.contact_title})</span>
                                )}
                              </div>
                            )}
                            {lead.email && (
                              <a
                                href={`mailto:${lead.email}`}
                                className="flex items-center gap-1.5 text-xs text-accent-blue hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Mail className="w-3 h-3" />
                                {lead.email}
                              </a>
                            )}
                            {lead.phone && (
                              <div className="text-xs text-text-tertiary">{lead.phone}</div>
                            )}
                          </div>
                        </div>

                        {/* Business Details */}
                        <div>
                          <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-2">Business</h4>
                          <div className="space-y-1 text-xs text-text-secondary">
                            {lead.industry && <div>Industry: {lead.industry}</div>}
                            {lead.years_in_business && <div>Years: {lead.years_in_business}</div>}
                            {lead.store_type && <div>Type: {lead.store_type}</div>}
                            {lead.location_count && <div>Locations: {lead.location_count}</div>}
                          </div>
                        </div>

                        {/* Web Presence */}
                        <div>
                          <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-2">Presence</h4>
                          <div className="space-y-1.5">
                            {lead.website && (
                              <a
                                href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1.5 text-xs text-accent-blue hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ExternalLink className="w-3 h-3" />
                                Website
                              </a>
                            )}
                            {lead.instagram_url && (
                              <a
                                href={lead.instagram_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1.5 text-xs text-purple-400 hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ExternalLink className="w-3 h-3" />
                                Instagram
                              </a>
                            )}
                          </div>
                        </div>

                        {/* Notes */}
                        <div>
                          <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-2">Notes</h4>
                          {lead.fit_reason && (
                            <p className="text-xs text-text-secondary italic">&ldquo;{lead.fit_reason}&rdquo;</p>
                          )}
                          {lead.referral_source && (
                            <div className="text-xs text-text-muted mt-2">Source: {lead.referral_source}</div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function LeadsDashboard({ data, loading, error, onRefresh }: LeadsDashboardProps) {
  // Error state - show error with retry button
  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-6">
        <div className="p-6 rounded-full bg-status-bad/10">
          <AlertCircle className="w-12 h-12 text-status-bad" />
        </div>
        <div className="text-center max-w-md">
          <p className="text-lg text-text-secondary mb-2">Failed to load leads data</p>
          <p className="text-sm text-text-muted mb-4">{error}</p>
        </div>
        <button
          onClick={onRefresh}
          className="flex items-center gap-2 px-5 py-2.5 bg-accent-blue text-white text-sm font-medium rounded-lg hover:bg-accent-blue/90 transition-all shadow-lg shadow-accent-blue/20"
        >
          <RefreshCw className="w-4 h-4" />
          Try Again
        </button>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="space-y-6">
        {/* Skeleton */}
        <div className="grid grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="bg-surface-secondary rounded-xl border border-border/30 p-5 animate-pulse">
              <div className="h-3 bg-surface-primary rounded w-20 mb-4" />
              <div className="h-8 bg-surface-primary rounded w-16" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-surface-secondary rounded-xl border border-border/30 h-48 animate-pulse" />
          <div className="bg-surface-secondary rounded-xl border border-border/30 h-48 animate-pulse" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-surface-secondary rounded-xl border border-border/30 p-12 text-center">
        <Users className="w-12 h-12 text-text-muted mx-auto mb-4" />
        <p className="text-text-secondary">No lead data available</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Pipeline Metrics */}
      <PipelineHeader data={data} />

      {/* Funnel + Trend */}
      <div className="grid grid-cols-2 gap-4">
        <ConversionFunnel data={data} />
        <VolumeTrend data={data} />
      </div>

      {/* Leads Table */}
      <LeadsTable leads={data.leads} totalCount={data.total_count} />

      {/* Last Synced */}
      <div className="flex justify-center">
        <StaleTimestamp date={data.lastSynced} prefix="Last synced" />
      </div>
    </div>
  );
}
