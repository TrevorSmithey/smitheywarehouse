"use client";

import { useState, useMemo } from "react";
import { RefreshCw } from "lucide-react";
import type { RestorationResponse, RestorationRecord } from "@/app/api/restorations/route";
import { RestorationDetailModal } from "./RestorationDetailModal";
import { useDashboard } from "@/app/(dashboard)/layout";

interface RestorationOperationsProps {
  data: RestorationResponse | null;
  loading: boolean;
  onRefresh: () => void;
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

function Card({ item, stage, onClick }: CardProps) {
  const config = STAGE_CONFIG[stage];
  const days = typeof item.days_in_status === "number" ? item.days_in_status : 0;
  const isLate = days > config.thresholds.amber;
  const isWarning = days > config.thresholds.green && !isLate;

  const orderName = item.order_name || item.rma_number || `#${item.id}`;
  const magnetNumber = item.magnet_number;

  // Sub-status for HERE column
  const isInbound = item.status === "in_transit_inbound";
  const isArrived = item.status === "delivered_warehouse";

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
      // Still in transit - muted
      return `${base} bg-slate-800/30 border-slate-600/30 opacity-50`;
    }
    return `${base} ${config.bgColor} ${config.borderColor}`;
  };

  return (
    <button onClick={onClick} className={getCardClasses()}>
      <div className="px-4 py-3 flex items-center justify-between gap-3">
        {/* Left side: Order + Status */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-white truncate">
              {orderName}
            </span>
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
            {isArrived && !isLate && (
              <span className="shrink-0 text-xs font-bold px-2 py-0.5 bg-amber-500/80 text-black rounded">
                Dock
              </span>
            )}
            {isInbound && (
              <span className="shrink-0 text-xs px-2 py-0.5 bg-slate-600/50 text-slate-300 rounded">
                Inbound
              </span>
            )}
          </div>
          {/* Magnet number or needs ID */}
          <div className="mt-1">
            {magnetNumber ? (
              <span className="text-sm text-text-secondary">{magnetNumber}</span>
            ) : (
              <span className="text-sm text-amber-400 font-medium">Needs ID</span>
            )}
          </div>
        </div>

        {/* Right side: Days counter - BIG */}
        <div className={`text-right shrink-0 ${isLate ? "text-red-300" : isWarning ? "text-amber-400" : "text-text-secondary"}`}>
          <span className="text-2xl font-black tabular-nums">{days}</span>
          <span className="text-sm font-medium ml-0.5">d</span>
        </div>
      </div>
    </button>
  );
}

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

  // Sort: late items first, then by days descending
  const sortedItems = [...items].sort((a, b) => {
    const aDays = typeof a.days_in_status === "number" ? a.days_in_status : 0;
    const bDays = typeof b.days_in_status === "number" ? b.days_in_status : 0;
    const aLate = aDays > config.thresholds.amber;
    const bLate = bDays > config.thresholds.amber;

    if (aLate && !bLate) return -1;
    if (!aLate && bLate) return 1;
    return bDays - aDays;
  });

  const lateCount = items.filter(i => {
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
        className={`flex-1 p-3 space-y-3 overflow-y-auto border-x-2 border-b-2 rounded-b-xl ${config.borderColor} ${config.bgColor}`}
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

export function RestorationOperations({ data, loading, onRefresh }: RestorationOperationsProps) {
  const { lastRefresh } = useDashboard();
  const [selectedRestoration, setSelectedRestoration] = useState<RestorationRecord | null>(null);

  // Filter to active pipeline items
  const pipelineItems = useMemo(() => {
    if (!data?.restorations) return [];
    return data.restorations.filter((r) => ALL_PIPELINE_STATUSES.includes(r.status));
  }, [data?.restorations]);

  // Group by visual stage
  const itemsByStage = useMemo(() => {
    const grouped: Record<PipelineStage, RestorationRecord[]> = {
      here: [],
      out: [],
      ship: [],
    };
    for (const item of pipelineItems) {
      const stage = getStageForStatus(item.status);
      if (stage) grouped[stage].push(item);
    }
    return grouped;
  }, [pipelineItems]);

  // Counts
  const totalActive = pipelineItems.length;
  const totalLate = pipelineItems.filter((r) => {
    const stage = getStageForStatus(r.status);
    const config = stage ? STAGE_CONFIG[stage] : null;
    return config && r.days_in_status > config.thresholds.amber;
  }).length;

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
      {/* Minimal Header */}
      <div className="flex items-center justify-between px-2">
        <div className="flex items-baseline gap-4">
          <h1 className="text-2xl font-black text-white tracking-tight">
            RESTORATIONS
          </h1>
          <span className="text-lg text-text-secondary">
            {totalActive} active
            {totalLate > 0 && (
              <span className="text-red-400 ml-2">• {totalLate} late</span>
            )}
          </span>
        </div>

        <button
          onClick={onRefresh}
          disabled={loading}
          className="p-3 rounded-xl bg-bg-secondary hover:bg-border transition-colors disabled:opacity-50"
          aria-label="Refresh"
        >
          <RefreshCw className={`w-6 h-6 text-text-secondary ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Three Column Board - flex on mobile/iPad, grid on desktop */}
      <div className="flex gap-4 overflow-x-auto pb-4 px-2 lg:grid lg:grid-cols-3 lg:overflow-visible">
        <Column
          stage="here"
          items={itemsByStage.here}
          onCardClick={setSelectedRestoration}
        />
        <Column
          stage="out"
          items={itemsByStage.out}
          onCardClick={setSelectedRestoration}
        />
        <Column
          stage="ship"
          items={itemsByStage.ship}
          onCardClick={setSelectedRestoration}
        />
      </div>

      {/* Detail Modal - This is where all the action happens */}
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
