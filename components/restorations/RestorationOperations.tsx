"use client";

import { useState, useMemo } from "react";
import {
  RefreshCw,
  Search,
  CheckCircle,
  ExternalLink,
  Wrench,
  Package,
  Truck,
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
}> = {
  delivered_warehouse: {
    label: "Delivered",
    shortLabel: "DELIVERED",
    color: "text-orange-400",
    bgColor: "bg-orange-500/10",
    borderColor: "border-orange-500/30",
    headerBg: "bg-orange-500/20",
    thresholds: { green: 2, amber: 5 },
    action: "Check In",
  },
  received: {
    label: "Received",
    shortLabel: "RECEIVED",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/30",
    headerBg: "bg-emerald-500/20",
    thresholds: { green: 3, amber: 7 },
    action: "Send Out",
  },
  at_restoration: {
    label: "At Restoration",
    shortLabel: "AT RESTORATION",
    color: "text-purple-400",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/30",
    headerBg: "bg-purple-500/20",
    thresholds: { green: 7, amber: 14 },
    action: "Mark Ready",
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
// KANBAN CARD
// ============================================================================

interface KanbanCardProps {
  item: RestorationRecord;
  stage: PipelineStage;
  onClick: () => void;
}

function KanbanCard({ item, stage, onClick }: KanbanCardProps) {
  const config = STAGE_CONFIG[stage];
  const daysColor = getDaysColor(item.days_in_status, stage);
  const isOverdue = item.days_in_status > config.thresholds.amber;

  return (
    <button
      onClick={onClick}
      className={`group w-full text-left p-3 rounded-lg border transition-all hover:border-opacity-80 hover:scale-[1.01] cursor-pointer ${
        isOverdue
          ? "bg-red-500/5 border-red-500/40 hover:bg-red-500/10"
          : `${config.bgColor} ${config.borderColor} hover:bg-opacity-20`
      }`}
    >
      {/* Order Name + POS badge */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-accent-blue group-hover:underline">
          {item.order_name || item.rma_number || `#${item.id}`}
        </span>
        {item.is_pos && (
          <span className="text-[9px] px-1.5 py-0.5 bg-purple-500/30 text-purple-300 rounded font-medium">
            POS
          </span>
        )}
      </div>

      {/* Days + Magnet */}
      <div className="flex items-center justify-between text-xs">
        <span className={`font-bold tabular-nums ${daysColor}`}>
          {item.days_in_status}d
          {isOverdue && <span className="ml-1 text-red-400">!</span>}
        </span>
        {item.magnet_number && (
          <span className="text-text-tertiary font-medium">{item.magnet_number}</span>
        )}
      </div>
    </button>
  );
}

// ============================================================================
// KANBAN COLUMN
// ============================================================================

interface KanbanColumnProps {
  stage: PipelineStage;
  items: RestorationRecord[];
  onAction?: () => void;
  onCardClick: (item: RestorationRecord) => void;
}

function KanbanColumn({ stage, items, onAction, onCardClick }: KanbanColumnProps) {
  const config = STAGE_CONFIG[stage];
  const overdueCount = items.filter((i) => i.days_in_status > config.thresholds.amber).length;

  // Sort by days_in_status descending (longest waiting at top)
  const sortedItems = [...items].sort((a, b) => b.days_in_status - a.days_in_status);

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

      {/* Column Body - Scrollable */}
      <div
        className={`flex-1 p-2 space-y-2 overflow-y-auto border-x border-b rounded-b-lg ${config.borderColor} ${config.bgColor}`}
        style={{ maxHeight: "calc(100vh - 320px)", minHeight: "200px" }}
      >
        {sortedItems.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-text-muted text-xs">
            Empty
          </div>
        ) : (
          sortedItems.map((item) => (
            <KanbanCard
              key={item.id}
              item={item}
              stage={stage}
              onClick={() => onCardClick(item)}
            />
          ))
        )}
      </div>

      {/* Action Button (if applicable) */}
      {config.action && items.length > 0 && onAction && (
        <button
          onClick={onAction}
          className={`mt-2 w-full py-2 text-xs font-semibold uppercase tracking-wider rounded-lg
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

  // Modal states
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [showToRestoration, setShowToRestoration] = useState(false);
  const [showFromRestoration, setShowFromRestoration] = useState(false);
  const [selectedRestoration, setSelectedRestoration] = useState<RestorationRecord | null>(null);

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
            disabled={loading}
            className="p-2 text-text-secondary hover:text-accent-blue transition-colors disabled:opacity-50"
            title="Refresh data"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* ============================================================ */}
      {/* KANBAN BOARD */}
      {/* ============================================================ */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        <KanbanColumn
          stage="delivered_warehouse"
          items={itemsByStage.delivered_warehouse}
          onAction={() => setShowCheckIn(true)}
          onCardClick={setSelectedRestoration}
        />
        <KanbanColumn
          stage="received"
          items={itemsByStage.received}
          onAction={() => setShowToRestoration(true)}
          onCardClick={setSelectedRestoration}
        />
        <KanbanColumn
          stage="at_restoration"
          items={itemsByStage.at_restoration}
          onAction={() => setShowFromRestoration(true)}
          onCardClick={setSelectedRestoration}
        />
        <KanbanColumn
          stage="ready_to_ship"
          items={itemsByStage.ready_to_ship}
          onCardClick={setSelectedRestoration}
        />
      </div>

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
  );
}
