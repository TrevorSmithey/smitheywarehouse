"use client";

import { useState, useMemo, memo } from "react";
import { RefreshCw, Search, X, AlertTriangle, Plus, Loader2, Trash2 } from "lucide-react";
import { getAuthHeaders } from "@/lib/auth";
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
    label: "HOBSON",
    color: "text-sky-400",
    bgColor: "bg-sky-500/10",
    borderColor: "border-sky-500/30",
    thresholds: { green: 3, amber: 7 },
  },
  out: {
    label: "PIPEFITTER",
    color: "text-purple-400",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/30",
    thresholds: { green: 7, amber: 14 },
  },
  ship: {
    label: "HOBSON",
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
  const daysInStage = typeof item.days_in_status === "number" ? item.days_in_status : 0;

  const orderName = item.order_name || item.rma_number || `#${item.id}`;
  // Use tag_numbers array (new) or fall back to magnet_number (legacy)
  const tags = item.tag_numbers?.length ? item.tag_numbers : (item.magnet_number ? [item.magnet_number] : []);
  const hasTags = tags.length > 0;

  // Sub-status for HERE column
  const isInbound = item.status === "in_transit_inbound";
  const isArrived = item.status === "delivered_warehouse";

  // HERO METRIC: Days since Smithey took possession (SLA clock)
  // POS orders: from order creation (customer walked in)
  // Regular orders: from warehouse delivery
  const terminalStatuses = ["shipped", "delivered", "cancelled", "damaged"];
  const isTerminal = terminalStatuses.includes(item.status);

  let daysSincePossession = 0;
  if (!isTerminal) {
    const possessionDate = item.is_pos
      ? item.order_created_at
      : item.delivered_to_warehouse_at;
    if (possessionDate) {
      daysSincePossession = Math.floor((Date.now() - new Date(possessionDate).getTime()) / (1000 * 60 * 60 * 24));
    }
  }
  const isLate = daysSincePossession > LATE_THRESHOLD_DAYS;

  // Warning: SLA-based thresholds for visual feedback
  const isPastThreshold = daysSincePossession > 14; // Over 2 weeks
  const isWarning = daysSincePossession > 7 && !isPastThreshold; // 1-2 weeks

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
                {item.local_pickup && (
                  <span className="shrink-0 text-xs font-bold px-2 py-0.5 bg-amber-500/80 text-white rounded">
                    PICKUP
                  </span>
                )}
                {isLate && (
                  <span className="shrink-0 text-xs font-black px-2 py-0.5 bg-red-500 text-white rounded uppercase">
                    Late
                  </span>
                )}
                {item.was_damaged && (
                  <span className="shrink-0 text-xs font-bold px-2 py-0.5 bg-amber-500/80 text-amber-100 rounded">
                    WAS DAMAGED
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
                {item.local_pickup && (
                  <span className="shrink-0 text-xs font-bold px-2 py-0.5 bg-amber-500/80 text-white rounded">
                    PICKUP
                  </span>
                )}
                {isLate && (
                  <span className="shrink-0 text-xs font-black px-2 py-0.5 bg-red-500 text-white rounded uppercase">
                    Late
                  </span>
                )}
                {item.was_damaged && (
                  <span className="shrink-0 text-xs font-bold px-2 py-0.5 bg-amber-500/80 text-amber-100 rounded">
                    WAS DAMAGED
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

        {/* Right side: Days counter */}
        <div className="text-right shrink-0">
          {/* Hero: Days since possession (SLA clock) */}
          <div className={`${isLate ? "text-red-300" : isPastThreshold ? "text-amber-400" : isWarning ? "text-amber-300" : "text-text-primary"}`}>
            <span className="text-2xl font-black tabular-nums">{daysSincePossession}</span>
            <span className="text-sm font-medium ml-0.5">d</span>
          </div>
          {/* Sub: Days in current stage */}
          {daysInStage > 0 && (
            <div className="text-xs text-text-muted tabular-nums">
              {daysInStage}d in stage
            </div>
          )}
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

  // Helper: Calculate days since possession for an item
  const getDaysSincePossession = (item: RestorationRecord): number => {
    const possessionDate = item.is_pos
      ? item.order_created_at
      : item.delivered_to_warehouse_at;
    if (!possessionDate) return 0;
    return Math.floor((Date.now() - new Date(possessionDate).getTime()) / (1000 * 60 * 60 * 24));
  };

  // Sort: in-transit at bottom, then late items first (21+ days), then by days descending
  const sortedItems = [...items].sort((a, b) => {
    // In-transit items always go to the bottom
    const aInTransit = a.status === "in_transit_inbound";
    const bInTransit = b.status === "in_transit_inbound";
    if (aInTransit && !bInTransit) return 1;
    if (!aInTransit && bInTransit) return -1;

    const aDays = getDaysSincePossession(a);
    const bDays = getDaysSincePossession(b);
    const aLate = aDays > LATE_THRESHOLD_DAYS;
    const bLate = bDays > LATE_THRESHOLD_DAYS;

    if (aLate && !bLate) return -1;
    if (!aLate && bLate) return 1;
    return bDays - aDays;
  });

  // Count items that are late (>21 days since possession, past SLA)
  const lateCount = items.filter(i => {
    if (i.status === "in_transit_inbound") return false;
    return getDaysSincePossession(i) > LATE_THRESHOLD_DAYS;
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
  // Add order modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [addOrderNumber, setAddOrderNumber] = useState("");
  const [addingOrder, setAddingOrder] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

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
  const inboundCount = pipelineItems.filter((r) => r.status === "in_transit_inbound").length;
  const inHouseCount = totalActive - inboundCount;
  // Late = >21 days since Smithey took possession (past SLA, matches Analytics page)
  const totalLate = pipelineItems.filter((r) => {
    // In-transit items excluded - we can't control carrier speed
    if (r.status === "in_transit_inbound") return false;
    // Calculate days since possession (POS: order creation, Regular: warehouse delivery)
    const possessionDate = r.is_pos ? r.order_created_at : r.delivered_to_warehouse_at;
    if (!possessionDate) return false;
    const daysSincePossession = Math.floor(
      (Date.now() - new Date(possessionDate).getTime()) / (1000 * 60 * 60 * 24)
    );
    return daysSincePossession > LATE_THRESHOLD_DAYS;
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

  // Filter items pending physical disposal (status='pending_trash')
  const pendingTrashItems = useMemo(() => {
    if (!data?.restorations) return [];
    return data.restorations
      .filter((r) => r.status === "pending_trash")
      .sort((a, b) => {
        // Sort by days since marked for trash (oldest first)
        const aDays = a.trashed_at ? Date.now() - new Date(a.trashed_at).getTime() : 0;
        const bDays = b.trashed_at ? Date.now() - new Date(b.trashed_at).getTime() : 0;
        return bDays - aDays;
      });
  }, [data?.restorations]);

  // Handler: Add order manually
  const handleAddOrder = async () => {
    if (!addOrderNumber.trim() || addingOrder) return;

    setAddingOrder(true);
    setAddError(null);

    try {
      const res = await fetch("/api/restorations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ order_number: addOrderNumber.trim() }),
      });

      const result = await res.json();

      if (!res.ok) {
        setAddError(result.error || "Failed to add order");
        return;
      }

      // Success - close modal and refresh
      setShowAddModal(false);
      setAddOrderNumber("");
      setAddError(null);
      onRefresh();
    } catch (error) {
      console.error("Error adding order:", error);
      setAddError("Failed to add order. Please try again.");
    } finally {
      setAddingOrder(false);
    }
  };

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
            {searchQuery ? (
              `${filteredItems.length} of ${totalActive}`
            ) : (
              <>
                {inHouseCount} in-house
                {inboundCount > 0 && <span className="text-sky-400"> • {inboundCount} inbound</span>}
              </>
            )}
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

          {/* Add Order Button - small, tucked away for manual drop-offs */}
          <button
            onClick={() => {
              setShowAddModal(true);
              setAddOrderNumber("");
              setAddError(null);
            }}
            className="p-2.5 rounded-lg bg-bg-secondary hover:bg-border transition-colors border border-border/50"
            aria-label="Add order manually"
            title="Add walk-in drop-off"
          >
            <Plus className="w-5 h-5 text-text-secondary" />
          </button>
        </div>
      </div>

      {/* Add Order Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => {
              if (!addingOrder) {
                setShowAddModal(false);
                setAddOrderNumber("");
                setAddError(null);
              }
            }}
          />

          {/* Modal */}
          <div className="relative bg-bg-primary border border-border rounded-xl shadow-2xl w-full max-w-sm mx-4 p-5">
            <h2 className="text-lg font-bold text-white mb-4">Add Walk-In Drop-Off</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">
                  Shopify Order Number
                </label>
                <input
                  type="text"
                  value={addOrderNumber}
                  onChange={(e) => setAddOrderNumber(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !addingOrder) {
                      handleAddOrder();
                    }
                  }}
                  placeholder="e.g., S372281"
                  autoFocus
                  disabled={addingOrder}
                  className="w-full px-4 py-3 rounded-lg bg-bg-secondary border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue transition-colors disabled:opacity-50"
                />
              </div>

              {addError && (
                <div className="text-sm text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">
                  {addError}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowAddModal(false);
                    setAddOrderNumber("");
                    setAddError(null);
                  }}
                  disabled={addingOrder}
                  className="flex-1 px-4 py-3 rounded-lg bg-bg-secondary text-text-secondary hover:bg-border transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddOrder}
                  disabled={addingOrder || !addOrderNumber.trim()}
                  className="flex-1 px-4 py-3 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {addingOrder ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    "Add to Queue"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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

      {/* Trash Bin - Items pending physical disposal confirmation */}
      {pendingTrashItems.length > 0 && (
        <div className="mx-2 mt-6 bg-bg-secondary rounded-xl border-2 border-slate-500/30">
          <div className="px-5 py-4 border-b border-slate-500/20 flex items-center gap-3">
            <Trash2 className="w-5 h-5 text-slate-400" />
            <h2 className="text-lg font-bold text-slate-400 tracking-tight">
              TRASH BIN — PENDING DISPOSAL
            </h2>
            <span className="px-2 py-0.5 text-sm font-bold bg-slate-500/20 text-slate-300 rounded">
              {pendingTrashItems.length}
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
                    Original Damage Reason
                  </th>
                  <th className="py-3 px-4 text-center text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Days Pending
                  </th>
                </tr>
              </thead>
              <tbody>
                {pendingTrashItems.map((item) => {
                  const orderName = item.order_name || item.rma_number || `#${item.id}`;
                  const daysPending = item.trashed_at
                    ? Math.floor((Date.now() - new Date(item.trashed_at).getTime()) / (1000 * 60 * 60 * 24))
                    : 0;

                  // Format damage reason for display
                  const reasonLabel = item.damage_reason
                    ? item.damage_reason
                        .replace(/_/g, " ")
                        .replace(/\b\w/g, (c) => c.toUpperCase())
                    : "Unknown";

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
                        <span className="px-2 py-1 text-xs font-medium rounded bg-slate-500/20 text-slate-300">
                          {reasonLabel}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`text-lg font-bold tabular-nums ${daysPending > 3 ? "text-amber-400" : "text-text-secondary"}`}>
                          {daysPending}d
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
    </div>
  );
}
