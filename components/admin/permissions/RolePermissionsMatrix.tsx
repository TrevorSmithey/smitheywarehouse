"use client";

import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { GripVertical, RefreshCw, Copy, Shield, Check, ChevronDown } from "lucide-react";
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
  ALL_TABS,
} from "@/lib/auth/permissions";

// Roles that can be edited (excludes admin)
const EDITABLE_ROLES = ALL_ROLES.filter((r) => r !== "admin");

// ============================================================================
// SORTABLE ROW
// ============================================================================

interface SortableRowProps {
  tab: DashboardTab;
  index: number;
  isHidden: boolean;
  rolePermissions: Record<DashboardRole, Set<DashboardTab>>;
  onToggle: (role: DashboardRole, tab: DashboardTab) => void;
}

function SortableRow({
  tab,
  index,
  isHidden,
  rolePermissions,
  onToggle,
}: SortableRowProps) {
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
    zIndex: isDragging ? 10 : 0,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`
        border-b border-border-subtle transition-all
        ${isDragging ? "bg-accent-blue/10 shadow-lg" : "hover:bg-white/[0.02]"}
        ${isHidden ? "opacity-40" : ""}
      `}
    >
      {/* Drag Handle + Index */}
      <td className="py-2.5 px-2 w-16">
        <div className="flex items-center gap-1">
          <button
            {...attributes}
            {...listeners}
            aria-label={`Drag to reorder ${TAB_CONFIG[tab]?.label || tab}`}
            className="p-1 text-text-muted hover:text-text-secondary cursor-grab active:cursor-grabbing rounded transition-colors"
          >
            <GripVertical className="w-4 h-4" />
          </button>
          <span className="text-text-muted text-[10px] font-mono">
            {String(index + 1).padStart(2, "0")}
          </span>
        </div>
      </td>

      {/* Tab Name */}
      <td className="py-2.5 px-3">
        <div className="flex items-center gap-2">
          <span className={`text-sm ${isHidden ? "text-text-muted line-through" : "text-text-primary"}`}>
            {TAB_CONFIG[tab]?.label || tab}
          </span>
          {isHidden && (
            <span className="text-[9px] text-status-warning px-1.5 py-0.5 rounded bg-status-warning/10">
              hidden
            </span>
          )}
        </div>
      </td>

      {/* Role Checkboxes */}
      {EDITABLE_ROLES.map((role) => {
        const hasAccess = rolePermissions[role]?.has(tab) ?? false;
        const tabLabel = TAB_CONFIG[tab]?.label || tab;
        const roleLabel = ROLE_CONFIG[role].label;

        return (
          <td key={role} className="py-2.5 px-2 text-center">
            <button
              onClick={() => onToggle(role, tab)}
              disabled={isHidden}
              role="checkbox"
              aria-checked={hasAccess}
              aria-disabled={isHidden}
              aria-label={`${tabLabel} access for ${roleLabel}`}
              className={`
                w-5 h-5 rounded border-2 flex items-center justify-center mx-auto
                transition-all duration-150
                ${isHidden
                  ? "cursor-not-allowed opacity-30 border-border bg-transparent"
                  : hasAccess
                    ? "bg-accent-blue border-accent-blue hover:bg-accent-blue/80"
                    : "bg-transparent border-border hover:border-text-muted"
                }
              `}
              title={isHidden ? "Tab is globally hidden" : hasAccess ? "Remove access" : "Grant access"}
            >
              {hasAccess && <Check className="w-3 h-3 text-white" />}
            </button>
          </td>
        );
      })}
    </tr>
  );
}

// ============================================================================
// ROLE PERMISSIONS MATRIX
// ============================================================================

export default function RolePermissionsMatrix() {
  const { config, configLoading, configSaving, saveConfig, users } = useAdmin();
  const [copyingForRole, setCopyingForRole] = useState<DashboardRole | null>(null);
  const [orderForRole, setOrderForRole] = useState<DashboardRole | "global">("global");
  const [showOrderDropdown, setShowOrderDropdown] = useState(false);

  // Refs for click-outside detection
  const orderDropdownRef = useRef<HTMLDivElement>(null);

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

  // Build role permissions map from config (memoized to prevent unnecessary re-computation)
  const rolePermissions = useMemo((): Record<DashboardRole, Set<DashboardTab>> => {
    if (!config) return {} as Record<DashboardRole, Set<DashboardTab>>;

    const result: Record<DashboardRole, Set<DashboardTab>> = {} as Record<DashboardRole, Set<DashboardTab>>;

    for (const role of ALL_ROLES) {
      const perms = config.role_permissions[role] || [];
      if (perms.includes("*")) {
        result[role] = new Set(ALL_TABS);
      } else {
        result[role] = new Set(perms as DashboardTab[]);
      }
    }

    return result;
  }, [config]);

  // Toggle a single permission (memoized to prevent stale closures and unnecessary re-renders)
  const handleToggle = useCallback((role: DashboardRole, tab: DashboardTab) => {
    if (!config) return;

    const currentPerms = config.role_permissions[role] || [];
    let newPerms: string[];

    // Expand "*" to all tabs if needed
    if (currentPerms.includes("*")) {
      newPerms = [...ALL_TABS];
    } else {
      newPerms = [...currentPerms];
    }

    // Toggle
    const tabIndex = newPerms.indexOf(tab);
    if (tabIndex >= 0) {
      newPerms.splice(tabIndex, 1);
    } else {
      newPerms.push(tab);
    }

    // Save
    const newRolePerms = { ...config.role_permissions };
    newRolePerms[role] = newPerms;
    saveConfig({ role_permissions: newRolePerms });
  }, [config, saveConfig]);

  // Copy permissions from one role to another (memoized)
  const copyFromRole = useCallback((targetRole: DashboardRole, sourceRole: DashboardRole) => {
    if (!config) return;

    const sourcePerms = config.role_permissions[sourceRole] || [];
    const newRolePerms = { ...config.role_permissions };
    newRolePerms[targetRole] = [...sourcePerms];
    saveConfig({ role_permissions: newRolePerms });
    setCopyingForRole(null);
  }, [config, saveConfig]);

  // Get the current tab order based on selected role
  const getDisplayOrder = useCallback((): DashboardTab[] => {
    if (!config) return ALL_TABS;

    if (orderForRole === "global") {
      return config.tab_order;
    }

    // Per-role order: use role's custom order if set, otherwise fall back to global
    const roleOrder = config.role_tab_orders?.[orderForRole];
    return roleOrder && roleOrder.length > 0 ? roleOrder : config.tab_order;
  }, [config, orderForRole]);

  // Handle drag end for reordering (memoized to prevent stale closures)
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id && config) {
      const currentOrder = getDisplayOrder();
      const oldIndex = currentOrder.indexOf(active.id as DashboardTab);
      const newIndex = currentOrder.indexOf(over.id as DashboardTab);
      const newOrder = arrayMove(currentOrder, oldIndex, newIndex);

      if (orderForRole === "global") {
        // Save to global tab_order
        saveConfig({ tab_order: newOrder });
      } else {
        // Save to role-specific order
        const newRoleOrders = { ...config.role_tab_orders };
        newRoleOrders[orderForRole] = newOrder;
        saveConfig({ role_tab_orders: newRoleOrders });
      }
    }
  }, [config, orderForRole, getDisplayOrder, saveConfig]);

  // Get user count for a role (memoized for performance)
  const getUserCount = useCallback((role: DashboardRole): number => {
    return users.filter((u) => u.role === role && u.is_active).length;
  }, [users]);

  // Get tab count for a role (excluding hidden) (memoized)
  const getTabCount = useCallback((role: DashboardRole): number => {
    const perms = rolePermissions[role];
    if (!perms || !config) return 0;
    return Array.from(perms).filter((t) => !config.hidden_tabs.includes(t)).length;
  }, [rolePermissions, config]);

  // Close order dropdown when clicking outside
  useEffect(() => {
    if (!showOrderDropdown) return;

    function handleClickOutside(event: MouseEvent) {
      if (orderDropdownRef.current && !orderDropdownRef.current.contains(event.target as Node)) {
        setShowOrderDropdown(false);
      }
    }

    // Use mousedown to fire before click events bubble
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showOrderDropdown]);

  // Close copy dropdown when clicking outside (handled per-role via stopPropagation)
  useEffect(() => {
    if (!copyingForRole) return;

    function handleClickOutside() {
      setCopyingForRole(null);
    }

    // Delay to avoid closing immediately on the same click that opened it
    const timer = setTimeout(() => {
      document.addEventListener("click", handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleClickOutside);
    };
  }, [copyingForRole]);

  if (configLoading) {
    return (
      <div className="flex justify-center py-16">
        <RefreshCw className="w-6 h-6 animate-spin text-accent-blue" />
      </div>
    );
  }

  if (!config) return null;

  const tabOrder = getDisplayOrder();

  // Determine if showing role-specific order that differs from global
  const hasCustomOrder = orderForRole !== "global" &&
    config.role_tab_orders?.[orderForRole]?.length > 0;

  return (
    <div className="space-y-4">
      {/* Header with admin notice, order selector, and saving indicator */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Shield className="w-4 h-4 text-purple-400" />
            <span>
              <strong className="text-purple-400">Admin</strong> has full access.
            </span>
          </div>

          {/* Order Role Selector */}
          <div className="relative" ref={orderDropdownRef}>
            <button
              onClick={() => setShowOrderDropdown(!showOrderDropdown)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-tertiary text-sm text-text-secondary hover:text-text-primary transition-colors border border-border/30"
            >
              <span className="text-text-muted text-xs">Tab order for:</span>
              <span className="font-medium">
                {orderForRole === "global" ? "Global" : ROLE_CONFIG[orderForRole].label}
              </span>
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {showOrderDropdown && (
              <div className="absolute top-full mt-1 left-0 bg-bg-secondary border border-border rounded-lg shadow-xl py-1 z-20 min-w-[140px]">
                <button
                  onClick={() => { setOrderForRole("global"); setShowOrderDropdown(false); }}
                  className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                    orderForRole === "global"
                      ? "text-accent-blue bg-accent-blue/10"
                      : "text-text-secondary hover:text-text-primary hover:bg-white/5"
                  }`}
                >
                  Global (default)
                </button>
                {EDITABLE_ROLES.map((role) => (
                  <button
                    key={role}
                    onClick={() => { setOrderForRole(role); setShowOrderDropdown(false); }}
                    className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                      orderForRole === role
                        ? "text-accent-blue bg-accent-blue/10"
                        : "text-text-secondary hover:text-text-primary hover:bg-white/5"
                    }`}
                  >
                    {ROLE_CONFIG[role].label}
                    {config.role_tab_orders?.[role]?.length > 0 && (
                      <span className="ml-2 text-[9px] text-status-good">•</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          {hasCustomOrder && (
            <button
              onClick={() => {
                // Note: orderForRole cannot be "global" here because hasCustomOrder
                // already guarantees orderForRole !== "global"
                if (!config) return;
                const newRoleOrders = { ...config.role_tab_orders };
                delete newRoleOrders[orderForRole];
                saveConfig({ role_tab_orders: newRoleOrders });
              }}
              className="text-[10px] text-status-good hover:text-status-warning transition-colors"
              title="Click to reset to global order"
            >
              custom order set (click to reset)
            </button>
          )}
        </div>
        {configSaving && (
          <span className="text-xs text-text-tertiary flex items-center gap-2">
            <RefreshCw className="w-3 h-3 animate-spin" />
            Saving...
          </span>
        )}
      </div>

      {/* Matrix Table */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <div className="bg-bg-secondary rounded-xl border border-border/30 overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full">
              {/* Header */}
              <thead className="bg-bg-tertiary/80 sticky top-0 z-10">
                <tr className="border-b border-border/30">
                  <th className="py-3 px-2 text-left text-[10px] uppercase tracking-wider text-text-muted font-semibold w-16">
                    #
                  </th>
                  <th className="py-3 px-3 text-left text-[10px] uppercase tracking-wider text-text-muted font-semibold min-w-[140px]">
                    Tab
                  </th>
                  {EDITABLE_ROLES.map((role) => (
                    <th key={role} className="py-2 px-2 text-center min-w-[70px]">
                      <div className="flex flex-col items-center gap-1">
                        <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium ${ROLE_CONFIG[role].color}`}>
                          {ROLE_CONFIG[role].label.length > 6
                            ? ROLE_CONFIG[role].label.slice(0, 5)
                            : ROLE_CONFIG[role].label}
                        </span>
                        <div className="text-[9px] text-text-muted">
                          {getTabCount(role)}/{getUserCount(role)}
                        </div>
                        {/* Copy dropdown */}
                        <div className="relative" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => setCopyingForRole(copyingForRole === role ? null : role)}
                            className="flex items-center gap-0.5 text-[9px] text-text-muted hover:text-accent-blue transition-colors"
                          >
                            <Copy className="w-2.5 h-2.5" />
                          </button>
                          {copyingForRole === role && (
                            <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 bg-bg-secondary border border-border rounded-lg shadow-xl py-1 z-20 min-w-[90px]">
                              <div className="px-2 py-1 text-[9px] text-text-muted border-b border-border/30">
                                Copy from:
                              </div>
                              {EDITABLE_ROLES.filter((r) => r !== role).map((sourceRole) => (
                                <button
                                  key={sourceRole}
                                  onClick={() => copyFromRole(role, sourceRole)}
                                  className="w-full px-3 py-1.5 text-left text-xs text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors"
                                >
                                  {ROLE_CONFIG[sourceRole].label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>

              {/* Body with drag-and-drop */}
              <SortableContext items={tabOrder} strategy={verticalListSortingStrategy}>
                <tbody>
                  {tabOrder.map((tab, index) => (
                    <SortableRow
                      key={tab}
                      tab={tab}
                      index={index}
                      isHidden={config.hidden_tabs.includes(tab)}
                      rolePermissions={rolePermissions}
                      onToggle={handleToggle}
                    />
                  ))}
                </tbody>
              </SortableContext>
            </table>
          </div>
        </div>
      </DndContext>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] text-text-muted flex-wrap">
        <span>Column headers: tabs / users</span>
        <span>•</span>
        <span>Click checkbox to toggle access</span>
        <span>•</span>
        <span>Drag rows to reorder for selected role</span>
        <span>•</span>
        <span>Click <Copy className="w-2.5 h-2.5 inline" /> to copy permissions</span>
      </div>
    </div>
  );
}
