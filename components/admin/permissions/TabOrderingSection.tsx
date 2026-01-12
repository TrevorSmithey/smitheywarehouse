"use client";

import { useState } from "react";
import { GripVertical, RefreshCw, RotateCcw } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAdmin } from "@/app/admin/layout";
import {
  DashboardRole,
  DashboardTab,
  ROLE_CONFIG,
  TAB_CONFIG,
  ALL_ROLES,
} from "@/lib/auth/permissions";

// ============================================================================
// SORTABLE TAB ITEM
// ============================================================================

interface SortableTabItemProps {
  tab: DashboardTab;
  index: number;
  isHidden: boolean;
}

function SortableTabItem({ tab, index, isHidden }: SortableTabItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1 : 0,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        flex items-center gap-3 px-4 py-3 rounded-lg bg-bg-tertiary
        transition-all
        ${isDragging ? "shadow-lg ring-2 ring-accent-blue/30" : ""}
        ${isHidden ? "opacity-40" : ""}
      `}
    >
      <button
        {...attributes}
        {...listeners}
        className="p-1 text-text-muted hover:text-text-secondary cursor-grab active:cursor-grabbing rounded transition-colors"
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <span className="text-text-muted text-xs font-mono w-6">
        {String(index + 1).padStart(2, "0")}
      </span>
      <span className={`text-sm font-medium flex-1 ${isHidden ? "text-text-muted line-through" : "text-text-primary"}`}>
        {TAB_CONFIG[tab]?.label || tab}
      </span>
      <span className="px-2 py-0.5 rounded-full bg-bg-secondary text-text-muted text-[10px] uppercase tracking-wider">
        {TAB_CONFIG[tab]?.group || "unknown"}
      </span>
      {isHidden && (
        <span className="text-[10px] text-status-warning">(hidden)</span>
      )}
    </div>
  );
}

// ============================================================================
// TAB ORDERING SECTION
// ============================================================================

export default function TabOrderingSection() {
  const { config, configLoading, configSaving, saveConfig } = useAdmin();
  const [selectedRole, setSelectedRole] = useState<DashboardRole | "global">("global");

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function getCurrentTabOrder(): DashboardTab[] {
    if (!config) return [];
    if (selectedRole === "global") {
      return config.tab_order;
    }
    return config.role_tab_orders[selectedRole] || config.tab_order;
  }

  function hasCustomOrder(): boolean {
    if (!config || selectedRole === "global") return false;
    return !!config.role_tab_orders[selectedRole];
  }

  function resetToGlobal() {
    if (!config || selectedRole === "global") return;
    const newRoleTabOrders = { ...config.role_tab_orders };
    delete newRoleTabOrders[selectedRole];
    saveConfig({ role_tab_orders: newRoleTabOrders });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (over && active.id !== over.id && config) {
      const currentOrder = getCurrentTabOrder();
      const oldIndex = currentOrder.indexOf(active.id as DashboardTab);
      const newIndex = currentOrder.indexOf(over.id as DashboardTab);
      const newOrder = arrayMove(currentOrder, oldIndex, newIndex);

      if (selectedRole === "global") {
        saveConfig({ tab_order: newOrder });
      } else {
        const newRoleTabOrders: Record<DashboardRole, DashboardTab[]> = {
          ...config.role_tab_orders,
          [selectedRole]: newOrder,
        };
        saveConfig({ role_tab_orders: newRoleTabOrders });
      }
    }
  }

  if (configLoading) {
    return (
      <div className="flex justify-center py-16">
        <RefreshCw className="w-6 h-6 animate-spin text-accent-blue" />
      </div>
    );
  }

  if (!config) return null;

  const tabOrder = getCurrentTabOrder();
  const isCustomOrder = hasCustomOrder();

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-sm text-text-secondary">Order for:</span>
          <select
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value as DashboardRole | "global")}
            className="px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary focus:border-accent-blue focus:outline-none transition-all"
          >
            <option value="global">Global (default)</option>
            {ALL_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_CONFIG[role].label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3">
          {isCustomOrder && (
            <button
              onClick={resetToGlobal}
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-status-warning border border-status-warning/30 rounded-lg hover:bg-status-warning/10 transition-all"
            >
              <RotateCcw className="w-3 h-3" />
              Reset to Global
            </button>
          )}
          {configSaving && (
            <span className="text-xs text-text-tertiary flex items-center gap-2">
              <RefreshCw className="w-3 h-3 animate-spin" />
              Saving...
            </span>
          )}
        </div>
      </div>

      {/* Info banner */}
      {selectedRole !== "global" && (
        <div className={`px-4 py-3 rounded-lg text-sm flex items-center gap-3 ${
          isCustomOrder
            ? "bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20"
            : "bg-status-warning/10 text-status-warning border border-status-warning/20"
        }`}>
          <div className="w-2 h-2 rounded-full bg-current flex-shrink-0" />
          {isCustomOrder
            ? `${ROLE_CONFIG[selectedRole].label} has a custom tab order. Drag to reorder or reset to global.`
            : `${ROLE_CONFIG[selectedRole].label} uses the global order. Drag any tab to create a custom order.`
          }
        </div>
      )}

      {/* Sortable List */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <div className="bg-bg-secondary rounded-xl border border-border/30 p-4">
          <SortableContext items={tabOrder} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {tabOrder.map((tab, index) => (
                <SortableTabItem
                  key={tab}
                  tab={tab}
                  index={index}
                  isHidden={config.hidden_tabs.includes(tab)}
                />
              ))}
            </div>
          </SortableContext>
        </div>
      </DndContext>

      {/* Help text */}
      <p className="text-xs text-text-muted">
        Drag tabs to reorder. {selectedRole === "global"
          ? "This sets the default order for all roles without custom ordering."
          : "Custom order will override the global default for this role."
        }
      </p>
    </div>
  );
}
