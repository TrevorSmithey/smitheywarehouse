"use client";

import { useState, useMemo, memo } from "react";
import { RefreshCw, Search, X, AlertTriangle } from "lucide-react";
import type { RestorationResponse, RestorationRecord } from "@/app/api/restorations/route";

interface RestorationOperationsProps {
  data: RestorationResponse | null;
  loading: boolean;
  onRefresh: () => void;
  onCardClick: (item: RestorationRecord) => void;
}

// Visual pipeline stages (simplified 3-stage model)
const PIPELINE_STAGES = ["here", "out", "ship"] as const;
type PipelineStage = (typeof PIPELINE_STAGES)[number];

// Map visual stages to database statuses
const STAGE_STATUS_MAP: Record<PipelineStage, string[]> = {
  here: ["in_transit_inbound", "delivered_warehouse", "received"],
  out: ["at_restoration"],
  ship: ["ready_to_ship"],
};

// All database statuses we care about
const ALL_PIPELINE_STATUSES = Object.values(STAGE_STATUS_MAP).flat();

// Get visual stage for a database status
function getStageForStatus(dbStatus: string): PipelineStage | null {
  for (const [stage, statuses] of Object.entries(STAGE_STATUS_MAP)) {
    if (statuses.includes(dbStatus)) {
      return stage as PipelineStage;
    }
  }
  return null;
}

// Stage configuration - optimized for warehouse ops
const STAGE_CONFIG: Record<PipelineStage, {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  thresholds: { green: number; amber: number };
}> = {
  here: {
    label: "HERE",
    color: "text-sky-400",
    bgColor: "bg-sky-500/10",
    borderColor: "border-sky-500/30",
    thresholds: { green: 3, amber: 7 },
  },
  out: {
    label: "OUT",
    color: "text-purple-400",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/30",
    thresholds: { green: 7, amber: 14 },
  },
  ship: {
    label: "SHIP",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/30",
    thresholds: { green: 2, amber: 5 },
  },
};

// ============================================================================
// SIMPLE TAP CARD - Optimized for iPad warehouse use
// ============================================================================

interface CardProps {
  item: RestorationRecord;
  stage: PipelineStage;
  onClick: () => void;
}

// Late threshold: 21 days from warehouse arrival until shipped
const LATE_THRESHOLD_DAYS = 21;

// Memoized card component - prevents re-renders when parent re-renders but props unchanged
const Card = memo(function Card({ item, stage, onClick }: CardProps) {
  const config = STAGE_CONFIG[stage];
  const days = typeof item.days_in_status === "number" ? item.days_in_status : 0;

  const orderName = item.order_name || item.rma_number || `#${item.id}`;
  // Use tag_numbers array (new) or fall back to magnet_number (legacy)
  const tags = item.tag_numbers?.length ? item.tag_numbers : (item.magnet_number ? [item.magnet_number] : []);
  const hasTags = tags.length > 0;

  // Sub-status for HERE column
  const isInbound = item.status === "in_transit_inbound";
  const isArrived = item.status === "delivered_warehouse";

  // "Late" = 21+ days since warehouse arrival, until shipped
  // Clock starts at delivered_to_warehouse_at, stops at shipped status
  const terminalStatuses = ["shipped", "delivered", "cancelled", "damaged"];
  const isTerminal = terminalStatuses.includes(item.status);

  let daysSinceArrival = 0;
  if (item.delivered_to_warehouse_at && !isTerminal) {
    const arrivalDate = new Date(item.delivered_to_warehouse_at);
    daysSinceArrival = Math.floor((Date.now() - arrivalDate.getTime()) / (1000 * 60 * 60 * 24));
  }
  const isLate = daysSinceArrival >= LATE_THRESHOLD_DAYS;

  // Warning: per-stage threshold for visual feedback (amber border)
  const isPastThreshold = days > config.thresholds.amber;
  const isWarning = days > config.thresholds.green && !isPastThreshold;

  // Card styling based on priority
  const getCardClasses = () => {
    const base = "w-full rounded-xl border-2 transition-all active:scale-[0.98] min-h-[72px]";

    if (isLate) {
      return `${base} bg-red-500/20 border-red-500 animate-pulse`;
    }
    if (isArrived) {
      // Arrived at dock - needs check-in - amber highlight
      return `${base} bg-amber-500/15 border-amber-500/60`;
    }
    if (isInbound) {
      // Still in transit - muted (we can't control carrier speed)
      return `${base} bg-slate-800/30 border-slate-600/30 opacity-50`;
    }
    return `${base} ${config.bgColor} ${config.borderColor}`;
  };

  // HERE stage: Order number primary, tags secondary
  // OUT/SHIP stages: Tags primary, order number secondary
  const isHereStage = stage === "here";

  return (
    <button onClick={onClick} className={getCardClasses()}>
      <div className="px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          {isHereStage ? (
            // HERE: Order number primary
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg font-black text-white">
                  {orderName}
                </span>
                {/* Status badges */}
                {isInbound && (
                  <span className="shrink-0 text-xs font-medium px-2 py-0.5 bg-slate-600/80 text-slate-300 rounded">
                    In Transit
                  </span>
                )}
                {item.is_pos && (
                  <span className="shrink-0 text-xs font-bold px-2 py-0.5 bg-teal-500/80 text-white rounded">
                    POS
                  </span>
                )}
                {isLate && (
                  <span className="shrink-0 text-xs font-black px-2 py-0.5 bg-red-500 text-white rounded uppercase">
                    Late
                  </span>
                )}
              </div>
              {/* Tags as secondary */}
              {hasTags && (
                <div className="mt-1 flex items-center gap-1.5">
                  {tags.map((tag, idx) => (
                    <span key={idx} className="text-sm text-text-tertiary font-mono">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : (
            // OUT/SHIP: Tags primary
            <>
              <div className="flex items-center gap-2 flex-wrap">
                {hasTags ? (
                  tags.map((tag, idx) => (
                    <span
                      key={idx}
                      className="text-lg font-black text-white font-mono tracking-wider"
                    >
                      {tag}
                    </span>
                  ))
                ) : (
                  <span className="text-lg font-bold text-amber-400">
                    NEEDS TAG
                  </span>
                )}
                {/* Status badges */}
                {item.is_pos && (
                  <span className="shrink-0 text-xs font-bold px-2 py-0.5 bg-teal-500/80 text-white rounded">
                    POS
                  </span>
                )}
                {isLate && (
                  <span className="shrink-0 text-xs font-black px-2 py-0.5 bg-red-500 text-white rounded uppercase">
                    Late
                  </span>
                )}
              </div>
              {/* Order name as secondary */}
              <div className="mt-1">
                <span className="text-sm text-text-tertiary">{orderName}</span>
              </div>
            </>
          )}
        </div>

        {/* Right side: Days counter - BIG */}
        <div className={`text-right shrink-0 ${isLate ? "text-red-300" : isWarning ? "text-amber-400" : "text-text-secondary"}`}>
          <span className="text-2xl font-black tabular-nums">{days}</span>
          <span className="text-sm font-medium ml-0.5">d</span>
        </div>
      </div>
    </button>
  );
});

// ============================================================================
// COLUMN - Simple scrollable list
// ============================================================================

interface ColumnProps {
  stage: PipelineStage;
  items: RestorationRecord[];
  onCardClick: (item: RestorationRecord) => void;
}

function Column({ stage, items, onCardClick }: ColumnProps) {
  const config = STAGE_CONFIG[stage];

  // Sort: in-transit at bottom, then late items first, then by days descending
  const sortedItems = [...items].sort((a, b) => {
    // In-transit items always go to the bottom
    const aInTransit = a.status === "in_transit_inbound";
    const bInTransit = b.status === "in_transit_inbound";
    if (aInTransit && !bInTransit) return 1;
    if (!aInTransit && bInTransit) return -1;

    const aDays = typeof a.days_in_status === "number" ? a.days_in_status : 0;
    const bDays = typeof b.days_in_status === "number" ? b.days_in_status : 0;
    const aLate = aDays > config.thresholds.amber;
    const bLate = bDays > config.thresholds.amber;

    if (aLate && !bLate) return -1;
    if (!aLate && bLate) return 1;
    return bDays - aDays;
  });

  const lateCount = items.filter(i => {
    // Late flag only applies after delivery to warehouse, not while in transit
    if (i.status === "in_transit_inbound") return false;
    const days = typeof i.days_in_status === "number" ? i.days_in_status : 0;
    return days > config.thresholds.amber;
  }).length;

  return (
    <div className="flex flex-col flex-1 min-w-[300px] max-w-[400px] lg:max-w-none">
      {/* Column Header - Large, clear */}
      <div className={`rounded-t-xl px-5 py-4 ${config.bgColor} border-b-2 ${config.borderColor}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <span className={`text-xl font-black tracking-wide ${config.color}`}>
              {config.label}
            </span>
            <span className="text-lg text-text-tertiary font-semibold">
              {items.length}
            </span>
          </div>
          {lateCount > 0 && (
            <span className="text-sm px-3 py-1 bg-red-500 text-white rounded-full font-bold animate-pulse">
              {lateCount} LATE
            </span>
          )}
        </div>
      </div>

      {/* Column Body - Scrollable */}
      <div
        className={`flex-1 p-3 space-y-3 overflow-y-auto scrollbar-thin border-x-2 border-b-2 rounded-b-xl ${config.borderColor} ${config.bgColor}`}
        style={{ maxHeight: "calc(100vh - 240px)", minHeight: "300px" }}
      >
        {sortedItems.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-text-muted text-lg">
            All clear
          </div>
        ) : (
          sortedItems.map((item) => (
            <Card
              key={item.id}
              item={item}
              stage={stage}
              onClick={() => onCardClick(item)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT - Minimal, iPad-first
// ============================================================================

export function RestorationOperations({ data, loading, onRefresh, onCardClick }: RestorationOperationsProps) {
  const [searchQuery, setSearchQuery] = useState("");

  // Filter to active pipeline items
  const pipelineItems = useMemo(() => {
    if (!data?.restorations) return [];
    return data.restorations.filter((r) =>
      ALL_PIPELINE_STATUSES.includes(r.status) && !r.archived_at
    );
  }, [data?.restorations]);

  // Filter by search query (order number or tag number)
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return pipelineItems;

    const query = searchQuery.trim().toUpperCase();
    return pipelineItems.filter((item) => {
      // Match order name
      const orderName = (item.order_name || item.rma_number || "").toUpperCase();
      if (orderName.includes(query)) return true;

      // Match any tag number
      const tags = item.tag_numbers || (item.magnet_number ? [item.magnet_number] : []);
      if (tags.some((tag) => tag.toUpperCase().includes(query))) return true;

      return false;
    });
  }, [pipelineItems, searchQuery]);

  // Group by visual stage
  const itemsByStage = useMemo(() => {
    const grouped: Record<PipelineStage, RestorationRecord[]> = {
      here: [],
      out: [],
      ship: [],
    };
    for (const item of filteredItems) {
      const stage = getStageForStatus(item.status);
      if (stage) grouped[stage].push(item);
    }
    return grouped;
  }, [filteredItems]);

  // Counts
  const totalActive = pipelineItems.length;
  const totalLate = pipelineItems.filter((r) => {
    // Late flag only applies after delivery to warehouse, not while in transit
    if (r.status === "in_transit_inbound") return false;
    const stage = getStageForStatus(r.status);
    const config = stage ? STAGE_CONFIG[stage] : null;
    return config && r.days_in_status > config.thresholds.amber;
  }).length;

  // Filter unresolved damaged items (status='damaged' AND resolved_at IS NULL)
  const unresolvedDamagedItems = useMemo(() => {
    if (!data?.restorations) return [];
    return data.restorations
      .filter((r) => r.status === "damaged" && !r.resolved_at)
      .sort((a, b) => {
        // Sort by days since damaged (oldest first = highest priority)
        const aDays = a.damaged_at ? Date.now() - new Date(a.damaged_at).getTime() : 0;
        const bDays = b.damaged_at ? Date.now() - new Date(b.damaged_at).getTime() : 0;
        return bDays - aDays;
      });
  }, [data?.restorations]);

  // Loading state
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin text-accent-blue mx-auto mb-3" />
          <p className="text-text-secondary">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-2">
        <div className="flex items-baseline gap-4">
          <h1 className="text-2xl font-black text-white tracking-tight">
            RESTORATIONS
          </h1>
          <span className="text-lg text-text-secondary">
            {searchQuery ? `${filteredItems.length} of ${totalActive}` : `${totalActive} active`}
            {totalLate > 0 && !searchQuery && (
              <span className="text-red-400 ml-2">• {totalLate} late</span>
            )}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search order or tag..."
              className="pl-9 pr-8 py-2 w-[200px] sm:w-[240px] rounded-lg bg-bg-secondary border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-secondary"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-2.5 rounded-lg bg-bg-secondary hover:bg-border transition-colors disabled:opacity-50"
            aria-label="Refresh"
          >
            <RefreshCw className={`w-5 h-5 text-text-secondary ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Damaged Items Table - CS Action Queue (TOP OF PAGE - urgent items) */}
      {unresolvedDamagedItems.length > 0 && (
        <div className="mx-2 mb-4 bg-bg-secondary rounded-xl border-2 border-red-500/30">
          <div className="px-5 py-4 border-b border-red-500/20 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <h2 className="text-lg font-bold text-red-400 tracking-tight">
              DAMAGED ITEMS REQUIRING CS ACTION
            </h2>
            <span className="px-2 py-0.5 text-sm font-bold bg-red-500/20 text-red-300 rounded">
              {unresolvedDamagedItems.length}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/20 bg-bg-tertiary/50">
                  <th className="py-3 px-4 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Order
                  </th>
                  <th className="py-3 px-4 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Reason
                  </th>
                  <th className="py-3 px-4 text-center text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Days
                  </th>
                </tr>
              </thead>
              <tbody>
                {unresolvedDamagedItems.map((item) => {
                  const orderName = item.order_name || item.rma_number || `#${item.id}`;
                  const daysSinceDamaged = item.damaged_at
                    ? Math.floor((Date.now() - new Date(item.damaged_at).getTime()) / (1000 * 60 * 60 * 24))
                    : 0;

                  // Format damage reason for display
                  const reasonLabel = item.damage_reason
                    ? item.damage_reason
                        .replace(/_/g, " ")
                        .replace(/\b\w/g, (c) => c.toUpperCase())
                    : "Unknown";

                  // Color coding for damage reason
                  const reasonColorClass =
                    item.damage_reason === "lost"
                      ? "bg-red-500/20 text-red-300"
                      : item.damage_reason === "damaged_internal"
                      ? "bg-amber-500/20 text-amber-300"
                      : "bg-slate-500/20 text-slate-300";

                  return (
                    <tr
                      key={item.id}
                      onClick={() => onCardClick(item)}
                      className="border-b border-border-subtle hover:bg-white/[0.02] transition-colors cursor-pointer"
                    >
                      <td className="py-3 px-4">
                        <span className="text-sm font-semibold text-accent-blue">
                          {orderName}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-1 text-xs font-medium rounded ${reasonColorClass}`}>
                          {reasonLabel}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`text-lg font-bold tabular-nums ${daysSinceDamaged > 7 ? "text-red-400" : "text-text-secondary"}`}>
                          {daysSinceDamaged}d
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Three Column Board - flex on mobile/iPad, grid on desktop */}
      <div className="flex gap-4 overflow-x-auto pb-4 px-2 lg:grid lg:grid-cols-3 lg:overflow-visible">
        <Column
          stage="here"
          items={itemsByStage.here}
          onCardClick={onCardClick}
        />
        <Column
          stage="out"
          items={itemsByStage.out}
          onCardClick={onCardClick}
        />
        <Column
          stage="ship"
          items={itemsByStage.ship}
          onCardClick={onCardClick}
        />
      </div>
    </div>
  );
}
