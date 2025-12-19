"use client";

import { useState } from "react";
import { MetricLabel } from "@/components/MetricLabel";
import { StaleTimestamp } from "@/components/StaleTimestamp";
import { format, formatDistanceToNow } from "date-fns";
import {
  ExternalLink,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  MessageCircle,
  X,
  Quote,
  RotateCcw,
  AlertTriangle,
  Lightbulb,
  CheckCircle,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type {
  TicketsResponse,
  SupportTicket,
  TicketCategory,
  TicketCategoryCount,
  TopicTheme,
  VOCInsight,
  WordCloudItem,
  TORTrendPoint,
} from "@/lib/types";
import { formatNumber } from "@/lib/dashboard-utils";

/**
 * AI Slop Words Filter
 *
 * These are meta-words that AI summarization often produces when analyzing
 * customer tickets. They describe the process of communication rather than
 * actual customer concerns, and pollute the word cloud with noise.
 *
 * Categories:
 * - Communication meta-words: describe how something was said, not what
 * - Vague descriptors: words AI uses when it can't extract specifics
 * - Process words: describe the ticket handling, not the issue
 */
const AI_SLOP_WORDS = new Set([
  // Communication meta-words
  "unclear", "intent", "context", "provided", "mentioned", "stated",
  "indicated", "requested", "regarding", "concerning", "inquired",
  "expressed", "noted", "informed", "advised", "explained",
  // Vague descriptors
  "specific", "details", "additional", "information", "particular",
  "general", "various", "certain", "multiple", "several",
  // Process words
  "message", "response", "reply", "follow-up", "update", "status",
  "resolution", "assistance", "support", "inquiry", "request",
  // Common AI filler
  "customer", "order", "issue", "problem", "question", "help",
]);

interface VoiceOfCustomerDashboardProps {
  data: TicketsResponse | null;
  loading: boolean;
  dateRange: "today" | "7days" | "30days" | "90days" | "custom";
  onDateRangeChange: (range: "today" | "7days" | "30days" | "90days" | "custom") => void;
  customStart: string;
  customEnd: string;
  onCustomStartChange: (date: string) => void;
  onCustomEndChange: (date: string) => void;
  categoryFilter: TicketCategory | "all";
  onCategoryFilterChange: (category: TicketCategory | "all") => void;
  sentimentFilter: "all" | "Positive" | "Negative" | "Neutral" | "Mixed";
  onSentimentFilterChange: (
    sentiment: "all" | "Positive" | "Negative" | "Neutral" | "Mixed"
  ) => void;
  search: string;
  onSearchChange: (search: string) => void;
  page: number;
  onPageChange: (page: number) => void;
}

// Format percentage
function formatPct(n: number, decimals = 1): string {
  if (n === 0) return "0%";
  if (Math.abs(n) < 0.1) return n.toFixed(2) + "%";
  return n.toFixed(decimals) + "%";
}

// Format percentage change with sign
function formatPctChange(current: number, previous: number): { text: string; isPositive: boolean; isNeutral: boolean } {
  if (previous === 0) {
    if (current === 0) return { text: "—", isPositive: false, isNeutral: true };
    return { text: "+100%", isPositive: false, isNeutral: false };
  }
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 0.5) return { text: "—", isPositive: false, isNeutral: true };
  const sign = change > 0 ? "+" : "";
  return {
    text: `${sign}${change.toFixed(0)}%`,
    isPositive: change < 0, // For tickets, fewer is better
    isNeutral: false,
  };
}

// AI Insight Card
function InsightCard({ insight, onClick }: { insight: VOCInsight; onClick?: () => void }) {
  const getIcon = () => {
    switch (insight.type) {
      case "alert":
        return <AlertTriangle className="w-4 h-4" />;
      case "positive":
        return <CheckCircle className="w-4 h-4" />;
      case "trend":
        return <TrendingUp className="w-4 h-4" />;
      default:
        return <Lightbulb className="w-4 h-4" />;
    }
  };

  const getColors = () => {
    switch (insight.type) {
      case "alert":
        return {
          bg: "bg-status-bad/10",
          border: "border-status-bad/30",
          icon: "text-status-bad",
          metric: "text-status-bad",
        };
      case "positive":
        return {
          bg: "bg-status-good/10",
          border: "border-status-good/30",
          icon: "text-status-good",
          metric: "text-status-good",
        };
      case "trend":
        return {
          bg: "bg-status-warning/10",
          border: "border-status-warning/30",
          icon: "text-status-warning",
          metric: "text-status-warning",
        };
      default:
        return {
          bg: "bg-accent-blue/10",
          border: "border-accent-blue/30",
          icon: "text-accent-blue",
          metric: "text-accent-blue",
        };
    }
  };

  const colors = getColors();

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 rounded-lg border ${colors.bg} ${colors.border} transition-all hover:scale-[1.01] group`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 ${colors.icon}`}>{getIcon()}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-sm font-semibold text-text-primary">
              {insight.title}
            </span>
            {insight.metric && (
              <span className={`text-sm font-bold tabular-nums ${colors.metric}`}>
                {insight.metric}
              </span>
            )}
          </div>
          <p className="text-xs text-text-secondary leading-relaxed">
            {insight.description}
          </p>
        </div>
      </div>
    </button>
  );
}

// Category Distribution Bar
function CategoryBar({
  category,
  onClick,
  maxCount,
  isActive,
}: {
  category: TicketCategoryCount;
  onClick: () => void;
  maxCount: number;
  isActive: boolean;
}) {
  const barWidth = Math.max(5, (category.count / maxCount) * 100);
  const change = category.delta || 0;
  const isUp = change > 0;
  const isDown = change < 0;

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 py-2 px-3 rounded-lg transition-all hover:bg-white/5 ${
        isActive ? "bg-accent-blue/10 ring-1 ring-accent-blue/30" : ""
      }`}
    >
      {/* Category name */}
      <span className={`w-40 text-left text-sm truncate ${isActive ? "text-accent-blue font-medium" : "text-text-primary"}`}>
        {category.category}
      </span>

      {/* Bar */}
      <div className="flex-1 h-2 bg-border/30 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            isActive ? "bg-accent-blue" : "bg-text-tertiary"
          }`}
          style={{ width: `${barWidth}%` }}
        />
      </div>

      {/* Count */}
      <span className="w-12 text-right text-sm font-medium text-text-primary tabular-nums">
        {formatNumber(category.count)}
      </span>

      {/* Change indicator */}
      <span className={`w-12 text-right text-[10px] tabular-nums ${
        isUp ? "text-status-bad" : isDown ? "text-status-good" : "text-text-muted"
      }`}>
        {isUp && "+"}{change !== 0 ? change : "—"}
      </span>
    </button>
  );
}

// Customer story card
function StoryCard({ ticket }: { ticket: SupportTicket }) {
  const sentimentColors: Record<string, string> = {
    positive: "border-l-status-good",
    negative: "border-l-status-bad",
    mixed: "border-l-purple-400",
    neutral: "border-l-text-tertiary",
  };
  const borderColor = sentimentColors[ticket.sentiment?.toLowerCase() || "neutral"];

  return (
    <div className={`bg-bg-tertiary rounded-lg border border-border/20 border-l-2 ${borderColor} p-4 transition-all hover:border-border/40`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[10px] uppercase tracking-wider text-text-muted">
          {ticket.category}
        </span>
        <span className="text-[10px] text-text-muted">
          {format(new Date(ticket.created_at), "MMM d")}
        </span>
      </div>
      <div className="relative">
        <Quote className="absolute -left-1 -top-1 w-4 h-4 text-text-tertiary/30" />
        <p className="text-sm text-text-primary leading-relaxed pl-4">
          {ticket.summary || ticket.subject}
        </p>
      </div>
      {ticket.perma_url && (
        <a
          href={ticket.perma_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 mt-3 text-[10px] text-accent-blue hover:underline"
        >
          View conversation <ExternalLink className="w-2.5 h-2.5" />
        </a>
      )}
    </div>
  );
}

// Professional Word Cloud Component
function WordCloud({ words, onWordClick }: { words: WordCloudItem[]; onWordClick?: (word: string) => void }) {
  if (!words || words.length === 0) return null;

  // Calculate font size range based on frequency
  const maxValue = Math.max(...words.map((w) => w.value));
  const minValue = Math.min(...words.map((w) => w.value));
  const range = maxValue - minValue || 1;

  // Font size scale: 11px to 28px
  const getSize = (value: number) => {
    const normalized = (value - minValue) / range;
    return 11 + normalized * 17;
  };

  // Opacity scale: 0.5 to 1.0
  const getOpacity = (value: number) => {
    const normalized = (value - minValue) / range;
    return 0.5 + normalized * 0.5;
  };

  // Font weight: 400 (low freq) to 600 (high freq)
  const getWeight = (value: number) => {
    const normalized = (value - minValue) / range;
    if (normalized > 0.7) return 600;
    if (normalized > 0.4) return 500;
    return 400;
  };

  // Sentiment color (subtle underline indicator)
  const getSentimentColor = (sentiment: string) => {
    switch (sentiment) {
      case "negative":
        return "border-b-status-bad/60";
      case "positive":
        return "border-b-status-good/60";
      case "mixed":
        return "border-b-purple-400/60";
      default:
        return "border-b-transparent";
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 py-4">
      {words.map((word, i) => {
        const size = getSize(word.value);
        const opacity = getOpacity(word.value);
        const weight = getWeight(word.value);
        const sentimentBorder = getSentimentColor(word.sentiment);

        return (
          <button
            key={`${word.text}-${i}`}
            onClick={() => onWordClick?.(word.text)}
            className={`
              relative inline-block px-1 py-0.5
              text-text-primary transition-all duration-200
              hover:text-accent-blue hover:scale-105
              border-b ${sentimentBorder}
              group cursor-pointer
            `}
            style={{
              fontSize: `${size}px`,
              fontWeight: weight,
              opacity,
            }}
            title={`${word.text}: ${word.value} mentions (${word.sentiment})`}
          >
            {word.text}
            {/* Hover tooltip */}
            <span className="
              absolute -top-8 left-1/2 -translate-x-1/2
              px-2 py-1 text-[10px] font-normal
              bg-bg-primary border border-border rounded
              opacity-0 group-hover:opacity-100 transition-opacity
              pointer-events-none whitespace-nowrap z-10
              text-text-secondary
            ">
              {word.value} mentions
            </span>
          </button>
        );
      })}
    </div>
  );
}

// TOR Trend Tooltip - extracted to module level to avoid re-creation on render
function TORTrendTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload: TORTrendPoint & { displayDate: string } }>
}) {
  if (!active || !payload || !payload.length) return null;
  const item = payload[0].payload;
  return (
    <div className="bg-bg-primary border border-border rounded-lg p-3 shadow-lg">
      <p className="text-xs text-text-muted mb-2">{format(new Date(item.date), "EEEE, MMM d, yyyy")}</p>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-text-secondary">TOR</span>
          <span className="text-xs font-medium text-accent-blue tabular-nums">{item.tor.toFixed(1)}%</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-text-secondary">Tickets</span>
          <span className="text-xs font-medium text-text-primary tabular-nums">{item.tickets}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-text-secondary">Orders</span>
          <span className="text-xs font-medium text-text-primary tabular-nums">{item.orders}</span>
        </div>
      </div>
    </div>
  );
}

// TOR Trend Chart Component
function TORTrendChart({ data, avgTOR }: { data: TORTrendPoint[]; avgTOR: number }) {
  if (!data || data.length === 0) return null;

  // Format chart data with display dates
  const chartData = data.map((point) => ({
    ...point,
    displayDate: format(new Date(point.date), "MMM d"),
  }));

  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted mb-1">
            TICKET-TO-ORDER RATIO OVER TIME
          </h3>
          <p className="text-[10px] text-text-muted">
            Daily TOR trend showing tickets vs orders
          </p>
        </div>
        <div className="text-right">
          <span className="text-lg font-semibold text-accent-blue tabular-nums">{avgTOR.toFixed(1)}%</span>
          <p className="text-[10px] text-text-muted">Period Average</p>
        </div>
      </div>

      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
            <defs>
              <linearGradient id="torGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0EA5E9" stopOpacity={0.2} />
                <stop offset="100%" stopColor="#0EA5E9" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="displayDate"
              tick={{ fill: "#64748B", fontSize: 10 }}
              axisLine={{ stroke: "#1E293B" }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: "#64748B", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={35}
              tickFormatter={(value) => `${value}%`}
            />
            <Tooltip content={<TORTrendTooltip />} />
            <ReferenceLine
              y={avgTOR}
              stroke="#64748B"
              strokeDasharray="3 3"
              strokeOpacity={0.5}
            />
            <Area
              type="monotone"
              dataKey="tor"
              stroke="#0EA5E9"
              strokeWidth={2}
              fill="url(#torGradient)"
              dot={false}
              activeDot={{ r: 4, fill: "#0EA5E9", stroke: "#0c4a6e", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center justify-center gap-6 mt-3 pt-3 border-t border-border/20">
        <div className="flex items-center gap-2">
          <div className="w-3 h-0.5 rounded-full bg-accent-blue" />
          <span className="text-[10px] text-text-tertiary">Daily TOR</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-0 border-t border-dashed border-text-tertiary" />
          <span className="text-[10px] text-text-tertiary">Period Average</span>
        </div>
      </div>
    </div>
  );
}

// Main Dashboard Component
export function VoiceOfCustomerDashboard({
  data,
  loading,
  dateRange,
  onDateRangeChange,
  categoryFilter,
  onCategoryFilterChange,
  sentimentFilter,
  onSentimentFilterChange,
  search,
  onSearchChange,
  page,
  onPageChange,
}: VoiceOfCustomerDashboardProps) {
  const dateRangeOptions = [
    { value: "today" as const, label: "Today" },
    { value: "7days" as const, label: "7D" },
    { value: "30days" as const, label: "30D" },
    { value: "90days" as const, label: "90D" },
  ];

  // Loading state
  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="bg-bg-secondary rounded-xl border border-border/30 p-6">
          <div className="h-4 bg-bg-tertiary rounded w-1/4 mb-4 animate-pulse" />
          <div className="h-48 bg-bg-tertiary rounded animate-pulse" />
        </div>
      </div>
    );
  }

  const tor = data?.ticketToOrderRatio || 0;
  const prevTor = data?.previousTOR || 0;
  const sentiment = data?.sentimentBreakdown;
  const categoryCounts = data?.categoryCounts || [];
  const insights = data?.insights || [];
  // Filter out AI slop words that pollute the word cloud with meta-language
  const wordCloud = (data?.wordCloud || []).filter(
    (word) => !AI_SLOP_WORDS.has(word.text.toLowerCase())
  );
  const csat = data?.csat;
  const tickets = data?.tickets || [];
  const totalTickets = data?.totalCount || 0;
  const prevTotalTickets = data?.previousTotalCount || 0;
  const totalPages = Math.ceil(totalTickets / 50);
  const orderCount = data?.orderCount || 0;
  const prevOrderCount = data?.previousOrderCount || 0;
  const negativeCount = sentiment?.negative || 0;

  // Calculate % changes
  const torChange = formatPctChange(tor, prevTor);
  const ticketChange = formatPctChange(totalTickets, prevTotalTickets);
  const orderChange = formatPctChange(orderCount, prevOrderCount);

  // Get max count for bar scaling
  const maxCategoryCount = Math.max(...categoryCounts.map((c) => c.count), 1);

  // Active filters check
  const hasFilters = categoryFilter !== "all" || sentimentFilter !== "all" || search;

  // Reset ALL filters
  const resetFilters = () => {
    onCategoryFilterChange("all");
    onSentimentFilterChange("all");
    onSearchChange("");
    onPageChange(1);
  };

  return (
    <div className="space-y-6">
      {/* Header with metrics strip */}
      <div className="bg-bg-secondary rounded-xl border border-border/30 p-5">
        {/* Title row */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-[10px] uppercase tracking-[0.2em] text-text-muted mb-1">
              VOICE OF THE CUSTOMER
            </h2>
            <StaleTimestamp date={data?.lastSynced} prefix="Updated" />
          </div>

          <div className="flex items-center gap-3">
            {/* Reset Filters Button */}
            {hasFilters && (
              <button
                onClick={resetFilters}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-blue text-white text-xs font-medium rounded-lg hover:bg-accent-blue/90 transition-all"
              >
                <RotateCcw className="w-3 h-3" />
                Reset Filters
              </button>
            )}

            {/* Date Range Toggle */}
            <div className="flex items-center gap-0.5 bg-bg-tertiary rounded-lg p-0.5">
              {dateRangeOptions.map((option) => (
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

          </div>
        </div>

        {/* Metrics Strip */}
        <div className="flex flex-wrap items-center gap-6 pt-4 border-t border-border/20">
          {/* TOR */}
          <div className="flex items-center gap-3">
            <span className="text-[10px] uppercase tracking-wider text-text-muted">
              <MetricLabel label="TOR" tooltip="Tickets per 100 orders (lower is better)" />
            </span>
            <span className="text-lg font-semibold text-text-primary tabular-nums">
              {formatPct(tor)}
            </span>
            {!torChange.isNeutral && (
              <span className={`text-[10px] tabular-nums ${torChange.isPositive ? "text-status-good" : "text-status-bad"}`}>
                {torChange.text}
              </span>
            )}
          </div>

          <div className="w-px h-6 bg-border/30" />

          {/* Conversations */}
          <div className="flex items-center gap-3">
            <span className="text-[10px] uppercase tracking-wider text-text-muted">Conversations</span>
            <span className="text-lg font-semibold text-text-primary tabular-nums">
              {formatNumber(totalTickets)}
            </span>
            {!ticketChange.isNeutral && (
              <span className={`text-[10px] tabular-nums ${ticketChange.isPositive ? "text-status-good" : "text-status-bad"}`}>
                {ticketChange.text}
              </span>
            )}
          </div>

          <div className="w-px h-6 bg-border/30" />

          {/* Orders */}
          <div className="flex items-center gap-3">
            <span className="text-[10px] uppercase tracking-wider text-text-muted">Orders</span>
            <span className="text-lg font-semibold text-text-primary tabular-nums">
              {formatNumber(orderCount)}
            </span>
            {!orderChange.isNeutral && (
              <span className={`text-[10px] tabular-nums ${!orderChange.isPositive ? "text-status-good" : "text-status-bad"}`}>
                {orderChange.text}
              </span>
            )}
          </div>

          <div className="w-px h-6 bg-border/30" />

          {/* CSAT Score - Only shown when Re:amaze credentials are configured */}
          {csat && (
            <>
              <div className="flex items-center gap-3">
                <span className="text-[10px] uppercase tracking-wider text-text-muted">
                  <MetricLabel label="CSAT" tooltip="Customer satisfaction score from surveys" />
                </span>
                <span className={`text-lg font-semibold tabular-nums ${
                  csat.satisfactionRate >= 90 ? "text-status-good" :
                  csat.satisfactionRate >= 70 ? "text-text-primary" :
                  "text-status-warning"
                }`}>
                  {formatPct(csat.satisfactionRate, 0)}
                </span>
                {csat.previousSatisfactionRate !== undefined && (
                  <span className={`text-[10px] tabular-nums ${
                    csat.satisfactionRate > csat.previousSatisfactionRate ? "text-status-good" :
                    csat.satisfactionRate < csat.previousSatisfactionRate ? "text-status-bad" :
                    "text-text-muted"
                  }`}>
                    {csat.satisfactionRate > csat.previousSatisfactionRate ? "+" : ""}
                    {(csat.satisfactionRate - csat.previousSatisfactionRate).toFixed(0)}%
                  </span>
                )}
              </div>
              <div className="w-px h-6 bg-border/30" />
            </>
          )}

          {/* Negative - Clickable */}
          <button
            onClick={() => onSentimentFilterChange(sentimentFilter === "Negative" ? "all" : "Negative")}
            className={`flex items-center gap-3 px-2 py-1 -mx-2 rounded transition-all ${
              sentimentFilter === "Negative" ? "bg-status-bad/10" : "hover:bg-white/5"
            }`}
          >
            <span className="text-[10px] uppercase tracking-wider text-text-muted">Negative</span>
            <span className={`text-lg font-semibold tabular-nums ${negativeCount > 0 ? "text-status-bad" : "text-text-primary"}`}>
              {negativeCount}
            </span>
            <span className="text-[10px] text-text-muted">
              ({formatPct(sentiment?.negativePct || 0, 0)})
            </span>
          </button>
        </div>
      </div>

      {/* AI Insights Row */}
      {insights.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {insights.slice(0, 4).map((insight, i) => (
            <InsightCard
              key={i}
              insight={insight}
              onClick={() => {
                // Navigate to relevant filter based on insight
                if (insight.title.includes("Quality")) {
                  onCategoryFilterChange("Quality Issue" as TicketCategory);
                  onSentimentFilterChange("Negative");
                } else if (insight.title.includes("Delivery")) {
                  onCategoryFilterChange("Delivery Delay or Problem" as TicketCategory);
                } else if (insight.title.includes("Return")) {
                  onCategoryFilterChange("Return or Exchange" as TicketCategory);
                } else if (insight.title.includes("Negative")) {
                  onSentimentFilterChange("Negative");
                }
              }}
            />
          ))}
        </div>
      )}

      {/* Word Cloud Section */}
      {wordCloud.length > 0 && (
        <div className="bg-bg-secondary rounded-xl border border-border/30 p-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
              WHAT CUSTOMERS ARE TALKING ABOUT
            </h3>
            <span className="text-[10px] text-text-muted">
              {wordCloud.length} topics from {formatNumber(totalTickets)} conversations
            </span>
          </div>
          <WordCloud
            words={wordCloud.slice(0, 60)}
            onWordClick={(word) => onSearchChange(word)}
          />
          <div className="flex items-center justify-center gap-6 mt-2 pt-3 border-t border-border/20">
            <div className="flex items-center gap-2">
              <span className="w-4 border-b border-status-bad/60" />
              <span className="text-[10px] text-text-muted">Negative</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 border-b border-status-good/60" />
              <span className="text-[10px] text-text-muted">Positive</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 border-b border-purple-400/60" />
              <span className="text-[10px] text-text-muted">Mixed</span>
            </div>
          </div>
        </div>
      )}

      {/* Active Filter Banner */}
      {hasFilters && (
        <div className="flex items-center justify-between gap-2 px-4 py-3 bg-accent-blue/10 rounded-lg border border-accent-blue/20">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-text-secondary">Filtering:</span>
            {search && (
              <span className="px-2 py-0.5 bg-accent-blue/20 text-accent-blue text-xs rounded-full">
                &quot;{search}&quot;
              </span>
            )}
            {sentimentFilter !== "all" && (
              <span className="px-2 py-0.5 bg-accent-blue/20 text-accent-blue text-xs rounded-full">
                {sentimentFilter}
              </span>
            )}
            {categoryFilter !== "all" && (
              <span className="px-2 py-0.5 bg-accent-blue/20 text-accent-blue text-xs rounded-full">
                {categoryFilter}
              </span>
            )}
          </div>
          <button
            onClick={resetFilters}
            className="flex items-center gap-1 text-xs text-accent-blue hover:underline"
          >
            Clear all <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left Column: Category Distribution (2/5) */}
        <div className="lg:col-span-2 bg-bg-secondary rounded-xl border border-border/30 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
              CATEGORY DISTRIBUTION
            </h3>
            <span className="text-[10px] text-text-muted">
              vs prev period
            </span>
          </div>

          <div className="space-y-1 max-h-[400px] overflow-y-auto pr-2">
            {categoryCounts.slice(0, 15).map((cat) => (
              <CategoryBar
                key={cat.category}
                category={cat}
                onClick={() => onCategoryFilterChange(
                  categoryFilter === cat.category ? "all" : (cat.category as TicketCategory)
                )}
                maxCount={maxCategoryCount}
                isActive={categoryFilter === cat.category}
              />
            ))}
          </div>
        </div>

        {/* Right Column: Stories (3/5) */}
        <div className="lg:col-span-3 space-y-4">
          {/* Customer Stories Section */}
          <div className="bg-bg-secondary rounded-xl border border-border/30 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-text-tertiary" />
                <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
                  CUSTOMER STORIES
                </h3>
                <span className="text-[10px] text-text-muted">
                  ({formatNumber(totalTickets)})
                </span>
              </div>

              {/* Quick filters */}
              <div className="flex items-center gap-2">
                <select
                  value={sentimentFilter}
                  onChange={(e) => onSentimentFilterChange(e.target.value as typeof sentimentFilter)}
                  className="px-2 py-1 text-[10px] bg-bg-tertiary border border-border rounded text-text-primary focus:outline-none focus:border-accent-blue"
                >
                  <option value="all">All Sentiment</option>
                  <option value="Positive">Positive</option>
                  <option value="Neutral">Neutral</option>
                  <option value="Negative">Negative</option>
                  <option value="Mixed">Mixed</option>
                </select>
              </div>
            </div>

            {/* Stories Grid */}
            {tickets.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {tickets
                  .filter((t) => t.category !== "Spam" && t.category !== "Phone Call (No Context)")
                  .slice(0, 8)
                  .map((ticket) => (
                    <StoryCard key={ticket.id} ticket={ticket} />
                  ))}
              </div>
            ) : (
              <div className="text-center py-12 text-text-muted text-sm">
                {loading ? "Loading stories..." : "No conversations match your filters"}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-border/20">
                <button
                  onClick={() => onPageChange(page - 1)}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-xs bg-bg-tertiary border border-border rounded text-text-primary disabled:opacity-50 hover:border-border-hover transition-all"
                >
                  Previous
                </button>
                <span className="text-[10px] text-text-muted">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => onPageChange(page + 1)}
                  disabled={page === totalPages}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs bg-bg-tertiary border border-border rounded text-text-primary disabled:opacity-50 hover:border-border-hover transition-all"
                >
                  Next <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* TOR Trend Chart */}
      {data?.torTrend && data.torTrend.length > 1 && (
        <TORTrendChart data={data.torTrend} avgTOR={tor} />
      )}
    </div>
  );
}
