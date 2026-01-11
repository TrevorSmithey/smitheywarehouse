"use client";

import { useState } from "react";
import {
  GripVertical,
  Eye,
  EyeOff,
  Check,
  RefreshCw,
} from "lucide-react";
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
import {
  DashboardRole,
  DashboardTab,
  ROLE_CONFIG,
  TAB_CONFIG,
  ALL_ROLES,
} from "@/lib/auth/permissions";
import type { DashboardConfig } from "@/lib/types";
import { useAdmin } from "@/app/admin/layout";

// ============================================================================
// SORTABLE TAB ROW COMPONENT
// ============================================================================

interface SortableTabRowProps {
  tab: DashboardTab;
  index: number;
  isHidden: boolean;
  config: DashboardConfig;
  selectedTabOrderRole: DashboardRole | "global";
  toggleGlobalHidden: (tab: DashboardTab) => void;
  toggleRolePermission: (role: DashboardRole, tab: DashboardTab) => void;
  roleHasPermission: (role: DashboardRole, tab: DashboardTab) => boolean;
}

function SortableTabRow({
  tab,
  index,
  isHidden,
  selectedTabOrderRole,
  toggleGlobalHidden,
  toggleRolePermission,
  roleHasPermission,
}: SortableTabRowProps) {
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
    <tr
      ref={setNodeRef}
      style={style}
      className={`
        border-b border-border/50 transition-all
        ${isDragging ? "bg-bg-tertiary" : "hover:bg-white/[0.02]"}
        ${isHidden ? "opacity-40" : ""}
      `}
    >
      <td className="py-3.5 px-3">
        <button
          {...attributes}
          {...listeners}
          className="p-1.5 text-text-muted hover:text-text-secondary cursor-grab active:cursor-grabbing rounded transition-colors"
          title="Drag to reorder"
        >
          <GripVertical className="w-4 h-4" />
        </button>
      </td>
      <td className="py-3.5 px-2">
        <span className="text-text-muted text-xs font-mono">{String(index + 1).padStart(2, "0")}</span>
      </td>
      <td className="py-3.5 px-4">
        <div className="flex items-center gap-3">
          <span className="text-text-primary font-medium text-sm">
            {TAB_CONFIG[tab]?.label || tab}
          </span>
          <span className="px-2 py-0.5 rounded-full bg-bg-tertiary text-text-muted text-[10px] uppercase tracking-wider">
            {TAB_CONFIG[tab]?.group || "unknown"}
          </span>
        </div>
      </td>
      <td className="py-3.5 px-4 text-center">
        <button
          onClick={() => toggleGlobalHidden(tab)}
          disabled={selectedTabOrderRole !== "global"}
          className={`
            p-1.5 rounded-md transition-all duration-200
            ${isHidden
              ? "text-text-muted hover:text-status-warning hover:bg-status-warning/10"
              : "text-status-good hover:bg-status-good/10"
            }
            ${selectedTabOrderRole !== "global" ? "opacity-30 cursor-not-allowed" : ""}
          `}
          title={selectedTabOrderRole !== "global" ? "Switch to Global to change visibility" : (isHidden ? "Hidden" : "Visible")}
        >
          {isHidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </td>
      {ALL_ROLES.filter((r) => r !== "admin").map((role) => (
        <td key={role} className="py-3.5 px-2 text-center">
          <button
            onClick={() => toggleRolePermission(role, tab)}
            disabled={isHidden || selectedTabOrderRole !== "global"}
            className={`
              w-5 h-5 rounded-md border-2 transition-all duration-200 flex items-center justify-center
              ${roleHasPermission(role, tab)
                ? "bg-accent-blue border-accent-blue shadow-sm shadow-accent-blue/30"
                : "bg-transparent border-border hover:border-text-muted"
              }
              ${isHidden || selectedTabOrderRole !== "global" ? "opacity-30 cursor-not-allowed" : ""}
            `}
            title={selectedTabOrderRole !== "global" ? "Switch to Global to change permissions" : undefined}
          >
            {roleHasPermission(role, tab) && (
              <Check className="w-3 h-3 text-white" />
            )}
          </button>
        </td>
      ))}
    </tr>
  );
}

// ============================================================================
// PERMISSIONS VIEW COMPONENT
// ============================================================================

export default function PermissionsView() {
  const {
    config,
    configLoading,
    configSaving,
    saveConfig,
  } = useAdmin();

  const [selectedTabOrderRole, setSelectedTabOrderRole] = useState<DashboardRole | "global">("global");

  // Drag and drop sensors
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

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

  function getCurrentTabOrder(): DashboardTab[] {
    if (!config) return [];
    if (selectedTabOrderRole === "global") {
      return config.tab_order;
    }
    return config.role_tab_orders[selectedTabOrderRole] || config.tab_order;
  }

  function hasCustomTabOrder(): boolean {
    if (!config || selectedTabOrderRole === "global") return false;
    return !!config.role_tab_orders[selectedTabOrderRole];
  }

  function resetRoleTabOrder() {
    if (!config || selectedTabOrderRole === "global") return;
    const newRoleTabOrders = { ...config.role_tab_orders };
    delete newRoleTabOrders[selectedTabOrderRole];
    saveConfig({ role_tab_orders: newRoleTabOrders });
  }

  function toggleGlobalHidden(tab: DashboardTab) {
    if (!config) return;
    const hidden = new Set(config.hidden_tabs);
    if (hidden.has(tab)) {
      hidden.delete(tab);
    } else {
      hidden.add(tab);
    }
    saveConfig({ hidden_tabs: Array.from(hidden) });
  }

  function toggleRolePermission(role: DashboardRole, tab: DashboardTab) {
    if (!config) return;
    const perms = { ...config.role_permissions };
    const rolePerms = new Set(perms[role] || []);

    if (role === "admin") return;

    if (rolePerms.has(tab)) {
      rolePerms.delete(tab);
    } else {
      rolePerms.add(tab);
    }
    perms[role] = Array.from(rolePerms);
    saveConfig({ role_permissions: perms });
  }

  function roleHasPermission(role: DashboardRole, tab: DashboardTab): boolean {
    if (!config) return false;
    const perms = config.role_permissions[role];
    if (!perms) return false;
    return perms.includes("*") || perms.includes(tab);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (over && active.id !== over.id && config) {
      const currentOrder = getCurrentTabOrder();
      const oldIndex = currentOrder.indexOf(active.id as DashboardTab);
      const newIndex = currentOrder.indexOf(over.id as DashboardTab);
      const newOrder = arrayMove(currentOrder, oldIndex, newIndex);

      if (selectedTabOrderRole === "global") {
        saveConfig({ tab_order: newOrder });
      } else {
        const newRoleTabOrders: Record<DashboardRole, DashboardTab[]> = {
          ...config.role_tab_orders,
          [selectedTabOrderRole]: newOrder,
        };
        saveConfig({ role_tab_orders: newRoleTabOrders });
      }
    }
  }

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div>
          <h2 className="text-lg font-medium text-text-primary">Tab Permissions</h2>
          <p className="text-sm text-text-tertiary mt-1">Control which tabs each role can access</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-bg-secondary rounded-lg p-1 border border-border">
            <span className="text-xs text-text-tertiary px-2">Order for:</span>
            <select
              value={selectedTabOrderRole}
              onChange={(e) => setSelectedTabOrderRole(e.target.value as DashboardRole | "global")}
              className="px-3 py-1.5 bg-bg-tertiary border border-border rounded-md text-sm text-text-primary focus:border-accent-blue focus:outline-none transition-all"
            >
              <option value="global">Global</option>
              {ALL_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_CONFIG[role].label}
                </option>
              ))}
            </select>
          </div>
          {hasCustomTabOrder() && (
            <button
              onClick={resetRoleTabOrder}
              className="px-3 py-1.5 text-xs text-status-warning border border-status-warning/30 rounded-lg hover:bg-status-warning/10 transition-all"
            >
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
      {selectedTabOrderRole !== "global" && (
        <div className={`px-4 py-3 rounded-lg text-sm flex items-center gap-3 ${
          hasCustomTabOrder()
            ? "bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20"
            : "bg-status-warning/10 text-status-warning border border-status-warning/20"
        }`}>
          <div className="w-2 h-2 rounded-full bg-current" />
          {hasCustomTabOrder()
            ? `${ROLE_CONFIG[selectedTabOrderRole].label} has a custom tab order. Reorder below or reset to global.`
            : `${ROLE_CONFIG[selectedTabOrderRole].label} uses the global tab order. Reorder to create a custom order.`
          }
        </div>
      )}

      {/* Table */}
      {configLoading ? (
        <div className="flex justify-center py-16">
          <RefreshCw className="w-6 h-6 animate-spin text-accent-blue" />
        </div>
      ) : config ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <div className="bg-bg-secondary rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-bg-tertiary/30">
                    <th className="text-left py-3.5 px-3 text-[11px] uppercase tracking-wider text-text-tertiary font-medium w-12" />
                    <th className="text-left py-3.5 px-2 text-[11px] uppercase tracking-wider text-text-tertiary font-medium w-10">#</th>
                    <th className="text-left py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Tab</th>
                    <th className="text-center py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Visible</th>
                    {ALL_ROLES.filter((r) => r !== "admin").map((role) => (
                      <th key={role} className="text-center py-3.5 px-2 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">
                        {ROLE_CONFIG[role].label.slice(0, 4)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <SortableContext items={getCurrentTabOrder()} strategy={verticalListSortingStrategy}>
                  <tbody>
                    {getCurrentTabOrder().map((tab, index) => (
                      <SortableTabRow
                        key={tab}
                        tab={tab}
                        index={index}
                        isHidden={config.hidden_tabs.includes(tab)}
                        config={config}
                        selectedTabOrderRole={selectedTabOrderRole}
                        toggleGlobalHidden={toggleGlobalHidden}
                        toggleRolePermission={toggleRolePermission}
                        roleHasPermission={roleHasPermission}
                      />
                    ))}
                  </tbody>
                </SortableContext>
              </table>
            </div>
          </div>
        </DndContext>
      ) : null}

      <p className="text-xs text-text-muted">
        Admin always has access to all visible tabs. Hidden tabs are invisible to everyone.
      </p>
    </div>
  );
}
