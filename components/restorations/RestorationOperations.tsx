"use client";

import { useState, useMemo, useCallback } from "react";
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

// Active pipeline stages (internal - what we control)
const PIPELINE_STAGES = [
  "delivered_warehouse",
  "received",
  "at_restoration",
  "ready_to_ship",
] as const;

type PipelineStage = (typeof PIPELINE_STAGES)[number];

// Valid drag transitions (only allow moving forward one step)
const VALID_DRAG_TRANSITIONS: Record<PipelineStage, PipelineStage | null> = {
  delivered_warehouse: "received",
  received: "at_restoration",
  at_restoration: "ready_to_ship",
  ready_to_ship: null, // Can't drag forward from here
};

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
  delivered_warehouse: {
    label: "Delivered",
    shortLabel: "DELIVERED",
    color: "text-orange-400",
    bgColor: "bg-orange-500/10",
    borderColor: "border-orange-500/30",
    headerBg: "bg-orange-500/20",
    thresholds: { green: 2, amber: 5 },
    action: "Bulk Check In",
    actionHint: "Select multiple items to check in",
  },
  received: {
    label: "Received",
    shortLabel: "RECEIVED",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/30",
    headerBg: "bg-emerald-500/20",
    thresholds: { green: 3, amber: 7 },
    action: "Bulk Send Out",
    actionHint: "Select multiple items to send to restoration",
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
    actionHint: "Select multiple items to mark ready to ship",
  },
  ready_to_ship: {
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

  return (
    <div
      ref={setNodeRef}
      className={`group w-full text-left p-3 rounded-lg border transition-all ${
        isDragging ? "opacity-40" : ""
      } ${isDragOverlay ? "shadow-xl ring-2 ring-accent-blue" : ""} ${
        isOverdue
          ? "bg-red-500/5 border-red-500/40"
          : `${config.bgColor} ${config.borderColor}`
      }`}
    >
      {/* Drag Handle + Order Name */}
      <div className="flex items-center gap-2 mb-2">
        {canDrag && (
          <button
            {...attributes}
            {...listeners}
            className="touch-none p-1 -ml-1 text-text-muted hover:text-text-secondary cursor-grab active:cursor-grabbing"
            aria-label="Drag to move"
          >
            <GripVertical className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={onClick}
          className="flex-1 text-left"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-accent-blue hover:underline">
              {orderName || rmaNumber || `#${item.id}`}
            </span>
            {item.is_pos && (
              <span className="text-[9px] px-1.5 py-0.5 bg-purple-500/30 text-purple-300 rounded font-medium">
                POS
              </span>
            )}
          </div>
        </button>
      </div>

      {/* Days + Magnet */}
      <button onClick={onClick} className="w-full text-left">
        <div className="flex items-center justify-between text-xs">
          <span className={`font-bold tabular-nums ${daysColor}`}>
            {daysInStatus}d
            {isOverdue && <span className="ml-1 text-red-400">!</span>}
          </span>
          {magnetNumber && (
            <span className="text-text-tertiary font-medium">{magnetNumber}</span>
          )}
        </div>
      </button>
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
    <div className="flex flex-col min-w-[260px] max-w-[320px] flex-1">
      {/* Column Header */}
      <div className={`rounded-t-lg px-4 py-3 ${config.headerBg} border-b ${config.borderColor}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold uppercase tracking-wider ${config.color}`}>
              {config.shortLabel}
            </span>
            <span className="text-xs text-text-tertiary font-medium">
              ({items.length})
            </span>
          </div>
          {overdueCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded font-semibold">
              {overdueCount} late
            </span>
          )}
        </div>
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

      {/* Action Button */}
      {config.action && items.length > 0 && onAction && (
        <button
          onClick={onAction}
          title={config.actionHint}
          className={`mt-2 w-full py-2.5 text-xs font-semibold uppercase tracking-wider rounded-lg
            ${config.bgColor} ${config.color} border ${config.borderColor}
            hover:bg-opacity-30 transition-colors`}
        >
          {config.action} ({items.length})
        </button>
      )}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function RestorationOperations({ data, loading, onRefresh }: RestorationOperationsProps) {
  const { lastRefresh } = useDashboard();
  const [searchTerm, setSearchTerm] = useState("");
  const [activeItem, setActiveItem] = useState<RestorationRecord | null>(null);
  const [activeStage, setActiveStage] = useState<PipelineStage | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

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

  // Filter to active pipeline items only
  const pipelineItems = useMemo(() => {
    if (!data?.restorations) return [];
    return data.restorations.filter((r) =>
      PIPELINE_STAGES.includes(r.status as PipelineStage)
    );
  }, [data?.restorations]);

  // Apply search filter
  const filteredItems = useMemo(() => {
    if (!searchTerm) return pipelineItems;
    const term = searchTerm.toLowerCase();
    return pipelineItems.filter(
      (r) =>
        r.order_name?.toLowerCase().includes(term) ||
        r.rma_number?.toLowerCase().includes(term) ||
        r.magnet_number?.toLowerCase().includes(term)
    );
  }, [pipelineItems, searchTerm]);

  // Group by stage
  const itemsByStage = useMemo(() => {
    const grouped: Record<PipelineStage, RestorationRecord[]> = {
      delivered_warehouse: [],
      received: [],
      at_restoration: [],
      ready_to_ship: [],
    };
    for (const item of filteredItems) {
      const stage = item.status as PipelineStage;
      if (grouped[stage]) {
        grouped[stage].push(item);
      }
    }
    return grouped;
  }, [filteredItems]);

  // Totals
  const totalActive = pipelineItems.length;
  const totalOverdue = pipelineItems.filter((r) => {
    const stage = r.status as PipelineStage;
    const config = STAGE_CONFIG[stage];
    return config && r.days_in_status > config.thresholds.amber;
  }).length;

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

    // Update via API
    setIsUpdating(true);
    try {
      const res = await fetch(`/api/restorations/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: toStage }),
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

        {/* ============================================================ */}
        {/* KANBAN BOARD */}
        {/* ============================================================ */}
        <div className="flex gap-4 overflow-x-auto pb-4">
          <DroppableColumn
            stage="delivered_warehouse"
            items={itemsByStage.delivered_warehouse}
            onAction={() => setShowCheckIn(true)}
            onCardClick={setSelectedRestoration}
            isDropTarget={getDropTarget("delivered_warehouse")}
          />
          <DroppableColumn
            stage="received"
            items={itemsByStage.received}
            onAction={() => setShowToRestoration(true)}
            onCardClick={setSelectedRestoration}
            isDropTarget={getDropTarget("received")}
          />
          <DroppableColumn
            stage="at_restoration"
            items={itemsByStage.at_restoration}
            onAction={() => setShowFromRestoration(true)}
            onCardClick={setSelectedRestoration}
            isDropTarget={getDropTarget("at_restoration")}
          />
          <DroppableColumn
            stage="ready_to_ship"
            items={itemsByStage.ready_to_ship}
            onCardClick={setSelectedRestoration}
            isDropTarget={getDropTarget("ready_to_ship")}
          />
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
