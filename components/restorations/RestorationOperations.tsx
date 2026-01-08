"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  RefreshCw,
  Search,
  GripVertical,
  Filter,
  X,
} from "lucide-react";
import type { RestorationResponse, RestorationRecord } from "@/app/api/restorations/route";
import { RestorationCheckIn } from "./RestorationCheckIn";
import { RestorationHandoff } from "./RestorationHandoff";
import { RestorationDetailModal } from "./RestorationDetailModal";
import { StaleTimestamp } from "@/components/StaleTimestamp";
import { useDashboard } from "@/app/(dashboard)/layout";

interface RestorationOperationsProps {
  data: RestorationResponse | null;
  loading: boolean;
  onRefresh: () => void;
}

// Visual pipeline stages (simplified 4-stage model)
const PIPELINE_STAGES = [
  "inbound",
  "processing",
  "at_restoration",
  "outbound",
] as const;

type PipelineStage = (typeof PIPELINE_STAGES)[number];

// Map visual stages to database statuses
const STAGE_STATUS_MAP: Record<PipelineStage, string[]> = {
  inbound: ["in_transit_inbound", "delivered_warehouse"],
  processing: ["received"],
  at_restoration: ["at_restoration"],
  outbound: ["ready_to_ship"],
};

// Valid drag transitions (only allow moving forward one step)
const VALID_DRAG_TRANSITIONS: Record<PipelineStage, PipelineStage | null> = {
  inbound: "processing",
  processing: "at_restoration",
  at_restoration: "outbound",
  outbound: null, // Can't drag forward from here
};

// Map database status -> target database status when advancing
const STAGE_ADVANCE_MAP: Record<PipelineStage, string> = {
  inbound: "received",          // Check in -> received
  processing: "at_restoration", // Send out -> at_restoration
  at_restoration: "ready_to_ship",
  outbound: "shipped",
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

// Stage configuration
const STAGE_CONFIG: Record<PipelineStage, {
  label: string;
  shortLabel: string;
  color: string;
  bgColor: string;
  borderColor: string;
  headerBg: string;
  thresholds: { green: number; amber: number };
  action?: string;
  actionHint?: string;
}> = {
  inbound: {
    label: "Inbound",
    shortLabel: "INBOUND",
    color: "text-sky-400",
    bgColor: "bg-sky-500/10",
    borderColor: "border-sky-500/30",
    headerBg: "bg-sky-500/20",
    thresholds: { green: 2, amber: 5 },
    action: "Bulk Check In",
    actionHint: "Check in delivered items",
  },
  processing: {
    label: "Processing",
    shortLabel: "PROCESSING",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/30",
    headerBg: "bg-emerald-500/20",
    thresholds: { green: 3, amber: 7 },
    action: "Bulk Send Out",
    actionHint: "Send items to restoration",
  },
  at_restoration: {
    label: "At Restoration",
    shortLabel: "AT RESTORATION",
    color: "text-purple-400",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/30",
    headerBg: "bg-purple-500/20",
    thresholds: { green: 7, amber: 14 },
    action: "Bulk Mark Ready",
    actionHint: "Mark items ready to ship",
  },
  outbound: {
    label: "Ready to Ship",
    shortLabel: "READY TO SHIP",
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    headerBg: "bg-blue-500/20",
    thresholds: { green: 2, amber: 5 },
  },
};

// Get conditional color for days
function getDaysColor(days: number, stage: PipelineStage): string {
  const { thresholds } = STAGE_CONFIG[stage];
  if (days <= thresholds.green) return "text-emerald-400";
  if (days <= thresholds.amber) return "text-amber-400";
  return "text-red-400";
}

// ============================================================================
// DRAGGABLE KANBAN CARD
// ============================================================================

interface DraggableCardProps {
  item: RestorationRecord;
  stage: PipelineStage;
  onClick: () => void;
  isDragOverlay?: boolean;
}

function DraggableCard({ item, stage, onClick, isDragOverlay }: DraggableCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `card-${item.id}`,
    data: { item, stage },
  });

  const config = STAGE_CONFIG[stage];
  const daysInStatus = typeof item.days_in_status === "number" ? item.days_in_status : 0;
  const daysColor = getDaysColor(daysInStatus, stage);
  const isOverdue = daysInStatus > config.thresholds.amber;

  const orderName = typeof item.order_name === "string" ? item.order_name : null;
  const rmaNumber = typeof item.rma_number === "string" ? item.rma_number : null;
  const magnetNumber = typeof item.magnet_number === "string" ? item.magnet_number : null;

  const canDrag = VALID_DRAG_TRANSITIONS[stage] !== null;

  // Items that have arrived at warehouse need attention (pulsing amber indicator)
  const needsCheckIn = item.status === "delivered_warehouse";

  return (
    <div
      ref={setNodeRef}
      className={`group w-full text-left rounded-lg border transition-all ${
        isDragging ? "opacity-40" : ""
      } ${isDragOverlay ? "shadow-xl ring-2 ring-accent-blue" : ""} ${
        isOverdue
          ? "bg-red-500/5 border-red-500/40 hover:border-red-500/60"
          : needsCheckIn
            ? "bg-amber-500/10 border-amber-500/50 hover:border-amber-400 animate-pulse"
            : `${config.bgColor} ${config.borderColor} hover:border-opacity-60`
      } hover:shadow-md active:scale-[0.98]`}
    >
      {/* Card is one big tap target */}
      <button
        onClick={onClick}
        className="w-full text-left p-4"
      >
        {/* Top row: Order Name + badges */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-base font-semibold text-accent-blue">
            {orderName || rmaNumber || `#${item.id}`}
          </span>
          <div className="flex items-center gap-1.5">
            {needsCheckIn && (
              <span className="text-[10px] px-2 py-1 bg-amber-500/30 text-amber-300 rounded font-semibold">
                Arrived
              </span>
            )}
            {item.is_pos && (
              <span className="text-[10px] px-2 py-1 bg-purple-500/30 text-purple-300 rounded font-semibold">
                POS
              </span>
            )}
          </div>
        </div>

        {/* Bottom row: Days + Magnet */}
        <div className="flex items-center justify-between">
          <span className={`text-lg font-bold tabular-nums ${daysColor}`}>
            {daysInStatus}d
            {isOverdue && <span className="ml-1 text-red-300 animate-pulse">!</span>}
          </span>
          {magnetNumber ? (
            <span className="text-sm text-text-secondary font-medium bg-bg-tertiary/50 px-2 py-0.5 rounded">
              {magnetNumber}
            </span>
          ) : (
            <span className="text-xs text-amber-400/70 italic">needs ID</span>
          )}
        </div>
      </button>

      {/* Drag handle - separate from tap area, larger touch target */}
      {canDrag && (
        <div className="border-t border-current/10 px-4 py-2">
          <button
            {...attributes}
            {...listeners}
            className="w-full flex items-center justify-center gap-2 py-1 text-text-muted hover:text-text-secondary cursor-grab active:cursor-grabbing touch-none"
            aria-label="Drag to advance"
          >
            <GripVertical className="w-5 h-5" />
            <span className="text-[10px] uppercase tracking-wider">Drag to advance</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// DROPPABLE KANBAN COLUMN
// ============================================================================

interface DroppableColumnProps {
  stage: PipelineStage;
  items: RestorationRecord[];
  onAction?: () => void;
  onCardClick: (item: RestorationRecord) => void;
  isDropTarget?: boolean;
}

function DroppableColumn({ stage, items, onAction, onCardClick, isDropTarget }: DroppableColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${stage}`,
    data: { stage },
  });

  const config = STAGE_CONFIG[stage];
  const overdueCount = items.filter((i) => {
    const days = typeof i.days_in_status === "number" ? i.days_in_status : 0;
    return days > config.thresholds.amber;
  }).length;

  const sortedItems = [...items].sort((a, b) => {
    const aDays = typeof a.days_in_status === "number" ? a.days_in_status : 0;
    const bDays = typeof b.days_in_status === "number" ? b.days_in_status : 0;
    return bDays - aDays;
  });

  return (
    <div className="flex flex-col min-w-[280px] max-w-[340px] flex-1">
      {/* Column Header */}
      <div className={`rounded-t-lg px-4 py-3 ${config.headerBg} border-b ${config.borderColor}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-bold uppercase tracking-wider ${config.color}`}>
              {config.shortLabel}
            </span>
            <span className="text-sm text-text-tertiary font-medium">
              ({items.length})
            </span>
          </div>
          {overdueCount > 0 && (
            <span className="text-[10px] px-2 py-1 bg-red-500/30 text-red-300 rounded font-bold tracking-wide uppercase animate-pulse">
              {overdueCount} late
            </span>
          )}
        </div>
        {/* Action button in header - always visible */}
        {config.action && items.length > 0 && onAction && (
          <button
            onClick={onAction}
            className={`w-full py-2.5 text-sm font-semibold rounded-lg
              bg-bg-primary/50 ${config.color} border ${config.borderColor}
              hover:bg-bg-primary/80 active:scale-[0.98] transition-all`}
          >
            {config.action}
          </button>
        )}
      </div>

      {/* Column Body - Droppable */}
      <div
        ref={setNodeRef}
        className={`flex-1 p-2 space-y-2 overflow-y-auto border-x border-b rounded-b-lg transition-colors ${
          config.borderColor
        } ${
          isOver && isDropTarget
            ? "bg-accent-blue/10 border-accent-blue/50"
            : config.bgColor
        }`}
        style={{ maxHeight: "calc(100vh - 320px)", minHeight: "200px" }}
      >
        {/* Drop hint when dragging */}
        {isOver && isDropTarget && (
          <div className="text-center py-3 text-sm text-accent-blue font-medium border-2 border-dashed border-accent-blue/50 rounded-lg mb-2">
            Drop to advance status
          </div>
        )}

        {sortedItems.length === 0 && !isOver ? (
          <div className="flex items-center justify-center h-20 text-text-muted text-xs">
            Empty
          </div>
        ) : (
          sortedItems.map((item) => (
            <DraggableCard
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
// MAIN COMPONENT
// ============================================================================

// Filter chip options
type FilterOption = "all" | "pos" | "overdue" | "no_magnet";

export function RestorationOperations({ data, loading, onRefresh }: RestorationOperationsProps) {
  const { lastRefresh } = useDashboard();
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterOption>("all");
  const [activeItem, setActiveItem] = useState<RestorationRecord | null>(null);
  const [activeStage, setActiveStage] = useState<PipelineStage | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // Track in-flight status updates to prevent race conditions
  const inFlightUpdatesRef = useRef<Set<number>>(new Set());

  // Modal states
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [showToRestoration, setShowToRestoration] = useState(false);
  const [showFromRestoration, setShowFromRestoration] = useState(false);
  const [selectedRestoration, setSelectedRestoration] = useState<RestorationRecord | null>(null);

  // DnD sensors - pointer for mouse, touch for iPad
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    })
  );

  // Filter to active pipeline items only (using ALL database statuses we care about)
  const pipelineItems = useMemo(() => {
    if (!data?.restorations) return [];
    return data.restorations.filter((r) =>
      ALL_PIPELINE_STATUSES.includes(r.status)
    );
  }, [data?.restorations]);

  // Apply search and filter
  const filteredItems = useMemo(() => {
    let items = pipelineItems;

    // Apply filter chip
    if (activeFilter === "pos") {
      items = items.filter((r) => r.is_pos);
    } else if (activeFilter === "overdue") {
      items = items.filter((r) => {
        const stage = getStageForStatus(r.status);
        const config = stage ? STAGE_CONFIG[stage] : null;
        return config && r.days_in_status > config.thresholds.amber;
      });
    } else if (activeFilter === "no_magnet") {
      items = items.filter((r) => !r.magnet_number);
    }

    // Apply search
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      items = items.filter(
        (r) =>
          r.order_name?.toLowerCase().includes(term) ||
          r.rma_number?.toLowerCase().includes(term) ||
          r.magnet_number?.toLowerCase().includes(term)
      );
    }

    return items;
  }, [pipelineItems, searchTerm, activeFilter]);

  // Group by visual stage (mapping DB statuses to visual stages)
  const itemsByStage = useMemo(() => {
    const grouped: Record<PipelineStage, RestorationRecord[]> = {
      inbound: [],
      processing: [],
      at_restoration: [],
      outbound: [],
    };
    for (const item of filteredItems) {
      const stage = getStageForStatus(item.status);
      if (stage && grouped[stage]) {
        grouped[stage].push(item);
      }
    }
    return grouped;
  }, [filteredItems]);

  // Totals and filter counts
  const totalActive = pipelineItems.length;
  const totalOverdue = pipelineItems.filter((r) => {
    const stage = getStageForStatus(r.status);
    const config = stage ? STAGE_CONFIG[stage] : null;
    return config && r.days_in_status > config.thresholds.amber;
  }).length;
  const totalPOS = pipelineItems.filter((r) => r.is_pos).length;
  const totalNoMagnet = pipelineItems.filter((r) => !r.magnet_number).length;

  // Count items waiting for customer (not shown on board but tracked in header)
  const awaitingCustomer = useMemo(() => {
    if (!data?.restorations) return 0;
    return data.restorations.filter(
      (r) => r.status === "pending_label" || r.status === "label_sent"
    ).length;
  }, [data?.restorations]);

  // Handle drag start
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { item, stage } = event.active.data.current as { item: RestorationRecord; stage: PipelineStage };
    setActiveItem(item);
    setActiveStage(stage);
  }, []);

  // Handle drag end - update status via API
  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;

    setActiveItem(null);
    setActiveStage(null);

    if (!over || !active.data.current) return;

    const { item, stage: fromStage } = active.data.current as { item: RestorationRecord; stage: PipelineStage };
    const toStage = (over.data.current as { stage: PipelineStage })?.stage;

    if (!toStage || fromStage === toStage) return;

    // Validate transition
    const validTarget = VALID_DRAG_TRANSITIONS[fromStage];
    if (validTarget !== toStage) {
      return; // Invalid transition, ignore
    }

    // Prevent concurrent updates for the same item (race condition protection)
    if (inFlightUpdatesRef.current.has(item.id)) {
      console.log(`[DRAG] Skipping update for ${item.id} - already in flight`);
      return;
    }

    // Mark as in-flight
    inFlightUpdatesRef.current.add(item.id);
    setIsUpdating(true);

    // Get the target database status (visual stage -> DB status)
    const targetDbStatus = STAGE_ADVANCE_MAP[fromStage];

    try {
      const res = await fetch(`/api/restorations/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: targetDbStatus }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update status");
      }

      // Refresh data
      onRefresh();
    } catch (error) {
      console.error("Error updating status:", error);
      alert(error instanceof Error ? error.message : "Failed to update status");
    } finally {
      // Remove from in-flight set
      inFlightUpdatesRef.current.delete(item.id);
      setIsUpdating(false);
    }
  }, [onRefresh]);

  // Determine which column is a valid drop target
  const getDropTarget = useCallback((stage: PipelineStage): boolean => {
    if (!activeStage) return false;
    return VALID_DRAG_TRANSITIONS[activeStage] === stage;
  }, [activeStage]);

  // Loading skeleton
  if (loading && !data) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-12 bg-bg-secondary rounded-lg" />
        <div className="flex gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex-1 h-96 bg-bg-secondary rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="space-y-4">
        {/* ============================================================ */}
        {/* HEADER */}
        {/* ============================================================ */}
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-semibold text-text-primary uppercase tracking-wider">
                  Restoration Queue
                </h1>
                <StaleTimestamp date={lastRefresh} prefix="Updated" />
              </div>
              <p className="text-sm text-text-secondary mt-1">
                {totalActive} active
                {totalOverdue > 0 && (
                  <span className="text-red-400 ml-2">• {totalOverdue} overdue</span>
                )}
                {awaitingCustomer > 0 && (
                  <span className="text-text-muted ml-2">• {awaitingCustomer} awaiting customer</span>
                )}
                <span className="text-text-muted ml-2">• Drag cards to advance</span>
              </p>
            </div>

            <div className="flex items-center gap-3">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                <input
                  type="text"
                  placeholder="Search order..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 pr-4 py-2 text-sm bg-bg-secondary border border-border rounded-lg
                    text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-blue
                    w-40 sm:w-48"
                />
              </div>

              {/* Refresh */}
              <button
                onClick={onRefresh}
                disabled={loading || isUpdating}
                className="p-2 text-text-secondary hover:text-accent-blue transition-colors disabled:opacity-50"
                title="Refresh data"
              >
                <RefreshCw className={`w-5 h-5 ${loading || isUpdating ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {/* Filter Chips - 44px min touch targets for iOS accessibility */}
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-4 h-4 text-text-muted" />
            <button
              onClick={() => setActiveFilter("all")}
              className={`px-4 py-2 min-h-[44px] text-xs font-medium rounded-full transition-colors flex items-center justify-center ${
                activeFilter === "all"
                  ? "bg-accent-blue text-white"
                  : "bg-bg-secondary text-text-secondary hover:bg-border"
              }`}
            >
              All ({totalActive})
            </button>
            {totalOverdue > 0 && (
              <button
                onClick={() => setActiveFilter(activeFilter === "overdue" ? "all" : "overdue")}
                className={`px-4 py-2 min-h-[44px] text-xs font-medium rounded-full transition-colors flex items-center justify-center gap-1.5 ${
                  activeFilter === "overdue"
                    ? "bg-red-500 text-white"
                    : "bg-red-500/10 text-red-400 hover:bg-red-500/20"
                }`}
              >
                Overdue ({totalOverdue})
                {activeFilter === "overdue" && <X className="w-3 h-3" />}
              </button>
            )}
            {totalPOS > 0 && (
              <button
                onClick={() => setActiveFilter(activeFilter === "pos" ? "all" : "pos")}
                className={`px-4 py-2 min-h-[44px] text-xs font-medium rounded-full transition-colors flex items-center justify-center gap-1.5 ${
                  activeFilter === "pos"
                    ? "bg-purple-500 text-white"
                    : "bg-purple-500/10 text-purple-400 hover:bg-purple-500/20"
                }`}
              >
                POS ({totalPOS})
                {activeFilter === "pos" && <X className="w-3 h-3" />}
              </button>
            )}
            {totalNoMagnet > 0 && (
              <button
                onClick={() => setActiveFilter(activeFilter === "no_magnet" ? "all" : "no_magnet")}
                className={`px-4 py-2 min-h-[44px] text-xs font-medium rounded-full transition-colors flex items-center justify-center gap-1.5 ${
                  activeFilter === "no_magnet"
                    ? "bg-amber-500 text-white"
                    : "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                }`}
              >
                Needs ID ({totalNoMagnet})
                {activeFilter === "no_magnet" && <X className="w-3 h-3" />}
              </button>
            )}
          </div>
        </div>

        {/* ============================================================ */}
        {/* KANBAN BOARD */}
        {/* ============================================================ */}
        <div className="relative">
          {/* Scroll fade indicators */}
          <div className="absolute left-0 top-0 bottom-4 w-8 bg-gradient-to-r from-bg-primary to-transparent z-10 pointer-events-none" />
          <div className="absolute right-0 top-0 bottom-4 w-8 bg-gradient-to-l from-bg-primary to-transparent z-10 pointer-events-none" />

          <div className="flex gap-4 overflow-x-auto pb-4 scroll-smooth snap-x snap-mandatory justify-center"
            style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.1) transparent" }}
          >
            <DroppableColumn
              stage="inbound"
              items={itemsByStage.inbound}
              onAction={() => setShowCheckIn(true)}
              onCardClick={setSelectedRestoration}
              isDropTarget={getDropTarget("inbound")}
            />
            <DroppableColumn
              stage="processing"
              items={itemsByStage.processing}
              onAction={() => setShowToRestoration(true)}
              onCardClick={setSelectedRestoration}
              isDropTarget={getDropTarget("processing")}
            />
            <DroppableColumn
              stage="at_restoration"
              items={itemsByStage.at_restoration}
              onAction={() => setShowFromRestoration(true)}
              onCardClick={setSelectedRestoration}
              isDropTarget={getDropTarget("at_restoration")}
            />
            <DroppableColumn
              stage="outbound"
              items={itemsByStage.outbound}
              onCardClick={setSelectedRestoration}
              isDropTarget={getDropTarget("outbound")}
            />
          </div>
        </div>

        {/* Drag Overlay - shows card being dragged */}
        <DragOverlay>
          {activeItem && activeStage && (
            <DraggableCard
              item={activeItem}
              stage={activeStage}
              onClick={() => {}}
              isDragOverlay
            />
          )}
        </DragOverlay>

        {/* ============================================================ */}
        {/* MODALS */}
        {/* ============================================================ */}
        <RestorationCheckIn
          isOpen={showCheckIn}
          onClose={() => setShowCheckIn(false)}
          onSuccess={() => {
            setShowCheckIn(false);
            onRefresh();
          }}
          restorations={data?.restorations || []}
        />

        <RestorationHandoff
          isOpen={showToRestoration}
          onClose={() => setShowToRestoration(false)}
          onSuccess={() => {
            setShowToRestoration(false);
            onRefresh();
          }}
          restorations={data?.restorations || []}
          handoffType="to_restoration"
        />

        <RestorationHandoff
          isOpen={showFromRestoration}
          onClose={() => setShowFromRestoration(false)}
          onSuccess={() => {
            setShowFromRestoration(false);
            onRefresh();
          }}
          restorations={data?.restorations || []}
          handoffType="from_restoration"
        />

        <RestorationDetailModal
          isOpen={!!selectedRestoration}
          onClose={() => setSelectedRestoration(null)}
          restoration={selectedRestoration}
          onSave={() => {
            setSelectedRestoration(null);
            onRefresh();
          }}
        />
      </div>
    </DndContext>
  );
}
