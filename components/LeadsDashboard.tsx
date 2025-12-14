"use client";

import { useState, useMemo } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  Users,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronUp,
  Target,
  Clock,
  CheckCircle,
  AlertCircle,
  UserCheck,
  UserX,
  Building2,
  Gift,
  Mail,
  Phone,
  ExternalLink,
  Link2,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import type {
  LeadsResponse,
  TypeformLead,
  LeadStatus,
  LeadFormType,
  LeadMatchStatus,
} from "@/lib/types";

// ============================================================================
// COMPONENT PROPS
// ============================================================================

interface LeadsDashboardProps {
  data: LeadsResponse | null;
  loading: boolean;
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

function formatPct(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
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
        <div className="relative">
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
// STATUS BADGES
// ============================================================================

function LeadStatusBadge({ status }: { status: LeadStatus }) {
  const config: Record<LeadStatus, { label: string; color: string; icon: React.ReactNode }> = {
    new: { label: "NEW", color: "bg-accent-blue/20 text-accent-blue", icon: <UserCheck className="w-3 h-3" /> },
    contacted: { label: "CONTACTED", color: "bg-purple-400/20 text-purple-400", icon: <Mail className="w-3 h-3" /> },
    qualified: { label: "QUALIFIED", color: "bg-status-warning/20 text-status-warning", icon: <Target className="w-3 h-3" /> },
    converted: { label: "CONVERTED", color: "bg-status-good/20 text-status-good", icon: <CheckCircle className="w-3 h-3" /> },
    lost: { label: "LOST", color: "bg-status-error/20 text-status-error", icon: <UserX className="w-3 h-3" /> },
    archived: { label: "ARCHIVED", color: "bg-text-muted/20 text-text-muted", icon: <AlertCircle className="w-3 h-3" /> },
  };
  const { label, color, icon } = config[status];
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded ${color}`}>
      {icon}
      {label}
    </span>
  );
}

function FormTypeBadge({ formType }: { formType: LeadFormType }) {
  const config: Record<LeadFormType, { label: string; color: string; icon: React.ReactNode; tooltip: string }> = {
    wholesale: {
      label: "B2B",
      color: "bg-accent-blue/20 text-accent-blue",
      icon: <Building2 className="w-3 h-3" />,
      tooltip: "Standard B2B wholesale application"
    },
    corporate: {
      label: "CORP",
      color: "bg-purple-400/20 text-purple-400",
      icon: <Gift className="w-3 h-3" />,
      tooltip: "Corporate gifting / bulk orders"
    },
  };
  const { label, color, icon, tooltip } = config[formType];
  return (
    <InfoTooltip content={tooltip}>
      <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded cursor-help ${color}`}>
        {icon}
        {label}
      </span>
    </InfoTooltip>
  );
}

function MatchStatusBadge({ status, confidence }: { status: LeadMatchStatus; confidence: number | null }) {
  const config: Record<LeadMatchStatus, { label: string; color: string; icon: React.ReactNode }> = {
    auto_matched: { label: "AUTO", color: "bg-status-good/20 text-status-good", icon: <Link2 className="w-3 h-3" /> },
    manual_matched: { label: "MANUAL", color: "bg-accent-blue/20 text-accent-blue", icon: <CheckCircle className="w-3 h-3" /> },
    pending: { label: "REVIEW", color: "bg-status-warning/20 text-status-warning", icon: <AlertCircle className="w-3 h-3" /> },
    no_match: { label: "NEW", color: "bg-text-muted/20 text-text-muted", icon: <UserCheck className="w-3 h-3" /> },
    rejected: { label: "REJECTED", color: "bg-status-error/20 text-status-error", icon: <UserX className="w-3 h-3" /> },
  };
  const { label, color, icon } = config[status];
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded ${color}`}>
      {icon}
      {label}
      {confidence !== null && (
        <span className="opacity-70">({confidence}%)</span>
      )}
    </span>
  );
}

// ============================================================================
// METRIC CARD
// ============================================================================

function MetricCard({
  label,
  value,
  delta,
  icon,
  tooltip,
}: {
  label: string;
  value: string | number;
  delta?: number | null;
  icon: React.ReactNode;
  tooltip?: string;
}) {
  const content = (
    <div className="bg-surface-secondary rounded-lg p-4 border border-border/30">
      <div className="flex items-center justify-between mb-2">
        <span className="text-text-muted text-xs uppercase tracking-wider">{label}</span>
        <span className="text-text-muted">{icon}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-text-primary">{value}</span>
        {delta !== undefined && delta !== null && (
          <span className={`text-xs flex items-center ${delta >= 0 ? "text-status-good" : "text-status-error"}`}>
            {delta >= 0 ? <TrendingUp className="w-3 h-3 mr-0.5" /> : <TrendingDown className="w-3 h-3 mr-0.5" />}
            {formatPct(delta)}
          </span>
        )}
      </div>
    </div>
  );

  if (tooltip) {
    return <InfoTooltip content={tooltip}>{content}</InfoTooltip>;
  }
  return content;
}

// ============================================================================
// CONVERSION FUNNEL BY FORM TYPE
// ============================================================================

function ConversionFunnel({ data }: { data: LeadsResponse }) {
  const { funnel } = data;

  // Data for each form type
  const funnelTypes = [
    {
      name: "B2B Wholesale",
      icon: <Building2 className="w-4 h-4" />,
      color: "#60A5FA",
      bgColor: "bg-accent-blue/20",
      total: funnel.wholesale.total,
      converted: funnel.wholesale.converted,
      rate: funnel.wholesale.conversion_rate,
      avgDays: funnel.wholesale.avg_days_to_conversion,
    },
    {
      name: "Corporate",
      icon: <Gift className="w-4 h-4" />,
      color: "#A78BFA",
      bgColor: "bg-purple-400/20",
      total: funnel.corporate.total,
      converted: funnel.corporate.converted,
      rate: funnel.corporate.conversion_rate,
      avgDays: funnel.corporate.avg_days_to_conversion,
    },
  ];

  return (
    <div className="bg-surface-secondary rounded-lg p-4 border border-border/30">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-text-primary">Conversion by Form Type</h3>
        <span className="text-[10px] text-text-muted uppercase">T365</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {funnelTypes.map((type) => (
          <div key={type.name} className="space-y-3">
            {/* Header */}
            <div className="flex items-center gap-2">
              <span style={{ color: type.color }}>{type.icon}</span>
              <span className="text-xs font-medium text-text-secondary">{type.name}</span>
            </div>

            {/* Funnel visualization */}
            <div className="space-y-1.5">
              {/* Total leads */}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-7 bg-surface-primary rounded overflow-hidden">
                  <div
                    className="h-full rounded flex items-center justify-between px-2"
                    style={{ width: "100%", backgroundColor: `${type.color}33` }}
                  >
                    <span className="text-[10px] text-text-muted">Leads</span>
                    <span className="text-xs font-medium" style={{ color: type.color }}>
                      {type.total}
                    </span>
                  </div>
                </div>
              </div>

              {/* Converted */}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-7 bg-surface-primary rounded overflow-hidden">
                  <div
                    className="h-full rounded flex items-center justify-between px-2"
                    style={{
                      width: type.total > 0 ? `${Math.max((type.converted / type.total) * 100, 15)}%` : "15%",
                      backgroundColor: "#4ADE8033",
                    }}
                  >
                    <span className="text-[10px] text-text-muted">Conv</span>
                    <span className="text-xs font-medium text-status-good">
                      {type.converted}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Metrics */}
            <div className="pt-2 border-t border-border/20 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-text-muted">Rate</span>
                <span className="font-medium text-status-good">{type.rate}%</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-muted">Avg Days</span>
                <span className="font-medium text-text-secondary">
                  {type.avgDays !== null ? type.avgDays : "—"}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// VOLUME TREND CHART
// ============================================================================

function VolumeTrendChart({ data }: { data: LeadsResponse }) {
  const chartData = useMemo(() => {
    return data.volume_trend.map((item) => ({
      period: item.period,
      wholesale: item.wholesale,
      corporate: item.corporate,
      total: item.total,
      converted: item.converted,
    }));
  }, [data.volume_trend]);

  if (chartData.length === 0) {
    return (
      <div className="bg-surface-secondary rounded-lg p-4 border border-border/30">
        <h3 className="text-sm font-medium text-text-primary mb-4">Lead Volume Trend</h3>
        <div className="h-48 flex items-center justify-center text-text-muted text-sm">
          No volume data available
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface-secondary rounded-lg p-4 border border-border/30">
      <h3 className="text-sm font-medium text-text-primary mb-4">Lead Volume Trend</h3>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id="wholesaleGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#60A5FA" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#60A5FA" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="corporateGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#A78BFA" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#A78BFA" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="period"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#6B7280", fontSize: 10 }}
              tickFormatter={(v) => {
                const [year, month] = v.split("-");
                return `${month}/${year.slice(2)}`;
              }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#6B7280", fontSize: 10 }}
              width={30}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1a1a1a",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "8px",
                fontSize: "11px",
              }}
              labelFormatter={(label) => {
                const [year, month] = String(label).split("-");
                return `${month}/${year}`;
              }}
            />
            <Area
              type="monotone"
              dataKey="wholesale"
              stroke="#60A5FA"
              fill="url(#wholesaleGradient)"
              name="B2B Wholesale"
            />
            <Area
              type="monotone"
              dataKey="corporate"
              stroke="#A78BFA"
              fill="url(#corporateGradient)"
              name="Corporate"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-center gap-6 mt-2">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-accent-blue" />
          <span className="text-xs text-text-muted">B2B Wholesale</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-purple-400" />
          <span className="text-xs text-text-muted">Corporate</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// FORM TYPE BREAKDOWN
// ============================================================================

function FormTypeBreakdown({ data }: { data: LeadsResponse }) {
  const { funnel } = data;
  const total = funnel.total_leads || 1;
  const wholesalePct = (funnel.wholesale_leads / total) * 100;
  const corporatePct = (funnel.corporate_leads / total) * 100;

  return (
    <div className="bg-surface-secondary rounded-lg p-4 border border-border/30">
      <h3 className="text-sm font-medium text-text-primary mb-4">Form Type Breakdown</h3>
      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-accent-blue" />
              <span className="text-sm text-text-secondary">B2B Wholesale</span>
            </div>
            <span className="text-sm font-medium text-text-primary">{funnel.wholesale_leads}</span>
          </div>
          <div className="h-2 bg-surface-primary rounded overflow-hidden">
            <div
              className="h-full bg-accent-blue rounded transition-all duration-500"
              style={{ width: `${wholesalePct}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Gift className="w-4 h-4 text-purple-400" />
              <span className="text-sm text-text-secondary">Corporate Gifting</span>
            </div>
            <span className="text-sm font-medium text-text-primary">{funnel.corporate_leads}</span>
          </div>
          <div className="h-2 bg-surface-primary rounded overflow-hidden">
            <div
              className="h-full bg-purple-400 rounded transition-all duration-500"
              style={{ width: `${corporatePct}%` }}
            />
          </div>
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-border/30">
        <div className="flex justify-between text-xs">
          <span className="text-text-muted">Corporate %</span>
          <span className="font-medium text-purple-400">{corporatePct.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MATCH STATUS BREAKDOWN
// ============================================================================

function MatchStatusBreakdown({ data }: { data: LeadsResponse }) {
  const { funnel } = data;
  const total = funnel.total_leads || 1;

  const statuses = [
    { label: "Auto-matched", value: funnel.auto_matched, color: "#4ADE80" },
    { label: "Manual-matched", value: funnel.manual_matched, color: "#60A5FA" },
    { label: "Pending Review", value: funnel.pending_match, color: "#FBBF24" },
  ];

  const matchedTotal = funnel.auto_matched + funnel.manual_matched;
  const matchRate = (matchedTotal / total) * 100;

  return (
    <div className="bg-surface-secondary rounded-lg p-4 border border-border/30">
      <h3 className="text-sm font-medium text-text-primary mb-4">Match Status</h3>
      <div className="space-y-2">
        {statuses.map((item) => {
          const pct = (item.value / total) * 100;
          return (
            <div key={item.label} className="flex items-center gap-3">
              <span className="text-xs text-text-muted w-28">{item.label}</span>
              <div className="flex-1 h-4 bg-surface-primary rounded overflow-hidden">
                <div
                  className="h-full rounded transition-all duration-500"
                  style={{ width: `${pct}%`, backgroundColor: item.color }}
                />
              </div>
              <span className="text-xs font-medium text-text-secondary w-10 text-right">
                {item.value}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-4 pt-3 border-t border-border/30">
        <div className="flex justify-between text-xs">
          <span className="text-text-muted">Overall Match Rate</span>
          <span className="font-medium text-status-good">{matchRate.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// LEADS TABLE
// ============================================================================

function LeadsTable({ leads }: { leads: TypeformLead[] }) {
  const [sortField, setSortField] = useState<"submitted_at" | "company_name">("submitted_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const sortedLeads = useMemo(() => {
    return [...leads].sort((a, b) => {
      let cmp = 0;
      if (sortField === "submitted_at") {
        cmp = new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime();
      } else if (sortField === "company_name") {
        cmp = a.company_name.localeCompare(b.company_name);
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [leads, sortField, sortDir]);

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
      <div className="bg-surface-secondary rounded-lg p-8 border border-border/30 text-center">
        <Users className="w-12 h-12 text-text-muted mx-auto mb-3" />
        <p className="text-text-muted">No leads yet</p>
        <p className="text-xs text-text-muted mt-1">
          Leads will appear here when form submissions come in
        </p>
      </div>
    );
  }

  return (
    <div className="bg-surface-secondary rounded-lg border border-border/30 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-primary/50 border-b border-border/30">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">
                <button
                  onClick={() => toggleSort("company_name")}
                  className="flex items-center gap-1 hover:text-text-primary transition-colors"
                >
                  Company
                  {sortField === "company_name" && (
                    sortDir === "desc" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />
                  )}
                </button>
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">
                Type
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">
                Status
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">
                Match
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">
                <button
                  onClick={() => toggleSort("submitted_at")}
                  className="flex items-center gap-1 hover:text-text-primary transition-colors"
                >
                  Submitted
                  {sortField === "submitted_at" && (
                    sortDir === "desc" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />
                  )}
                </button>
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">
                Contact
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/20">
            {sortedLeads.map((lead) => (
              <tr
                key={lead.id}
                className="hover:bg-surface-primary/30 transition-colors cursor-pointer"
                onClick={() => setExpandedId(expandedId === lead.id ? null : lead.id)}
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-text-primary">{lead.company_name}</div>
                  {lead.city && lead.state && (
                    <div className="text-xs text-text-muted">{lead.city}, {lead.state}</div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <FormTypeBadge formType={lead.form_type} />
                </td>
                <td className="px-4 py-3">
                  <LeadStatusBadge status={lead.status} />
                </td>
                <td className="px-4 py-3">
                  <MatchStatusBadge status={lead.match_status} confidence={lead.match_confidence} />
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  <div className="text-xs">{format(new Date(lead.submitted_at), "MMM d, yyyy")}</div>
                  <div className="text-xs text-text-muted">{formatDistanceToNow(new Date(lead.submitted_at), { addSuffix: true })}</div>
                </td>
                <td className="px-4 py-3">
                  {lead.email && (
                    <div className="flex items-center gap-1 text-xs text-text-secondary">
                      <Mail className="w-3 h-3 text-text-muted" />
                      <span className="truncate max-w-[150px]">{lead.email}</span>
                    </div>
                  )}
                  {lead.phone && (
                    <div className="flex items-center gap-1 text-xs text-text-muted">
                      <Phone className="w-3 h-3" />
                      {lead.phone}
                    </div>
                  )}
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
// PENDING REVIEW SECTION
// ============================================================================

function PendingReviewSection({ leads }: { leads: TypeformLead[] }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (leads.length === 0) {
    return null;
  }

  return (
    <div className="bg-surface-secondary rounded-lg border border-status-warning/30 overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-primary/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-status-warning" />
          <span className="font-medium text-text-primary">Pending Match Review</span>
          <span className="text-xs bg-status-warning/20 text-status-warning px-2 py-0.5 rounded-full">
            {leads.length} leads
          </span>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-5 h-5 text-text-muted" />
        ) : (
          <ChevronDown className="w-5 h-5 text-text-muted" />
        )}
      </button>

      {isExpanded && (
        <div className="border-t border-border/30 divide-y divide-border/20">
          {leads.map((lead) => (
            <div key={lead.id} className="px-4 py-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium text-text-primary">{lead.company_name}</div>
                  <div className="text-xs text-text-muted mt-1">
                    {lead.email} {lead.phone && `| ${lead.phone}`}
                  </div>
                </div>
                <div className="text-right">
                  <MatchStatusBadge status={lead.match_status} confidence={lead.match_confidence} />
                  <div className="text-xs text-text-muted mt-1">
                    {format(new Date(lead.submitted_at), "MMM d")}
                  </div>
                </div>
              </div>
              {lead.match_candidates && lead.match_candidates.length > 0 && (
                <div className="mt-3 bg-surface-primary/50 rounded p-2">
                  <div className="text-xs font-medium text-text-muted mb-2">Potential Matches:</div>
                  {lead.match_candidates.map((candidate, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-1">
                      <span className="text-text-secondary">{candidate.company_name}</span>
                      <span className="text-status-warning">{candidate.confidence}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function LeadsDashboard({ data, loading, onRefresh }: LeadsDashboardProps) {
  if (loading && !data) {
    return (
      <div className="space-y-6">
        {/* Skeleton loaders */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-surface-secondary rounded-lg p-4 border border-border/30 animate-pulse">
              <div className="h-4 bg-surface-primary rounded w-1/2 mb-3" />
              <div className="h-8 bg-surface-primary rounded w-3/4" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-surface-secondary rounded-lg p-4 border border-border/30 h-64 animate-pulse" />
          <div className="bg-surface-secondary rounded-lg p-4 border border-border/30 h-64 animate-pulse" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-surface-secondary rounded-lg p-8 border border-border/30 text-center">
        <Users className="w-12 h-12 text-text-muted mx-auto mb-3" />
        <p className="text-text-muted">No lead data available</p>
      </div>
    );
  }

  const { funnel } = data;

  return (
    <div className="space-y-6">
      {/* Metrics Strip */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total Leads"
          value={funnel.total_leads}
          delta={funnel.leads_delta_pct || null}
          icon={<Users className="w-4 h-4" />}
          tooltip="All-time lead submissions"
        />
        <MetricCard
          label="Conversion Rate"
          value={`${funnel.conversion_rate.toFixed(1)}%`}
          delta={funnel.conversion_rate_delta || null}
          icon={<Target className="w-4 h-4" />}
          tooltip="Leads that became customers"
        />
        <MetricCard
          label="Avg Days to Convert"
          value={funnel.avg_days_to_conversion !== null ? funnel.avg_days_to_conversion.toFixed(0) : "—"}
          icon={<Clock className="w-4 h-4" />}
          tooltip="Average time from lead to first order"
        />
        <MetricCard
          label="Conversion Revenue"
          value={formatCurrency(funnel.total_conversion_revenue)}
          icon={<TrendingUp className="w-4 h-4" />}
          tooltip="Total first order revenue from converted leads"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ConversionFunnel data={data} />
        <VolumeTrendChart data={data} />
      </div>

      {/* Leads Table */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-text-primary">Recent Leads</h3>
          <span className="text-xs text-text-muted">{data.total_count} total</span>
        </div>
        <LeadsTable leads={data.leads} />
      </div>

      {/* Last Synced */}
      {data.lastSynced && (
        <div className="text-xs text-text-muted text-center">
          Last synced {formatDistanceToNow(new Date(data.lastSynced), { addSuffix: true })}
        </div>
      )}
    </div>
  );
}
