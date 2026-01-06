"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  UserPlus,
  Edit2,
  Check,
  X,
  GripVertical,
  Eye,
  EyeOff,
  RefreshCw,
  LogOut,
  LogIn,
  Shuffle,
  Users,
  LayoutGrid,
  Settings2,
  Activity,
  Megaphone,
  Plus,
  Trash2,
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
import { useAuth, getAuthHeaders } from "@/lib/auth";
import {
  DashboardRole,
  DashboardTab,
  ROLE_CONFIG,
  TAB_CONFIG,
  ALL_ROLES,
  ALL_TABS,
} from "@/lib/auth/permissions";
import UserAvatar from "@/components/admin/UserAvatar";
import ActivitySparkline from "@/components/admin/ActivitySparkline";
import PinReveal from "@/components/admin/PinReveal";
import QuickStatsHeader from "@/components/admin/QuickStatsHeader";

// Types
interface DashboardUser {
  id: string;
  name: string;
  email: string | null;
  role: DashboardRole;
  pin: string;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
  last_active_at: string | null;
  notes: string | null;
  default_page_override: string | null;
  additional_tabs: string[] | null;
}

interface UserActivitySummary {
  userId: string;
  daysActive: number;
  dailyActivity: boolean[];
  lastActiveAt: string | null;
  isActiveNow: boolean;
}

interface AdminStats {
  totalUsers: number;
  activeThisWeek: number;
  activeToday: number;
  mostViewedTab: { tab: string; views: number } | null;
  failedLoginsToday: number;
  activitySummaries: Record<string, UserActivitySummary>;
}

interface DashboardConfig {
  tab_order: DashboardTab[];
  hidden_tabs: DashboardTab[];
  role_permissions: Record<DashboardRole, string[]>;
  role_defaults: Record<DashboardRole, DashboardTab>;
  role_tab_orders: Record<DashboardRole, DashboardTab[]>;
}

type AdminTab = "users" | "tabs" | "defaults" | "activity" | "health" | "announcements";

// Tab configuration for admin navigation
const ADMIN_TABS: { id: AdminTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "users", label: "Users", icon: Users },
  { id: "tabs", label: "Permissions", icon: LayoutGrid },
  { id: "defaults", label: "Defaults", icon: Settings2 },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "health", label: "Sync Health", icon: RefreshCw },
  { id: "announcements", label: "Announcements", icon: Megaphone },
];

// Activity log entry type
interface ActivityEntry {
  id: string;
  userId: string;
  userName: string;
  userRole: string | null;
  action: string;
  tab: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// Sync health types
interface SyncInfo {
  type: string;
  status: string;
  lastRun: string | null;
  recordsExpected: number | null;
  recordsSynced: number | null;
  successRate: number;
  durationMs: number | null;
  hoursSinceSuccess: number | null;
  error: string | null;
  isStale: boolean;
  staleThreshold: number;
}

interface SyncHealthResponse {
  status: "healthy" | "warning" | "critical";
  syncs: SyncInfo[];
  checkedAt: string;
}

// Announcement type
interface Announcement {
  id: string;
  title: string;
  message: string | null;
  severity: "info" | "warning" | "critical";
  starts_at: string;
  expires_at: string | null;
  created_by: string;
  created_at: string;
  is_archived: boolean;
}

// Sync type display names
const SYNC_TYPE_LABELS: Record<string, string> = {
  d2c: "D2C Orders",
  b2b: "B2B Orders",
  inventory: "Inventory",
  holiday: "Holiday Data",
  assembly: "Assembly",
  netsuite_customers: "NetSuite Customers",
  netsuite_transactions: "NetSuite Transactions",
  netsuite_lineitems: "NetSuite Line Items",
  klaviyo: "Klaviyo",
  reamaze: "Re:amaze",
  shopify_stats: "Shopify Stats",
};

// Sortable Tab Row Component
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
  config,
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
    zIndex: isDragging ? 1000 : undefined,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`
        border-b border-border/50 transition-all duration-200
        ${isHidden ? "opacity-40" : "hover:bg-white/[0.02]"}
        ${isDragging ? "bg-bg-tertiary shadow-lg" : ""}
      `}
    >
      {/* Drag Handle */}
      <td className="py-3.5 px-3">
        <button
          {...attributes}
          {...listeners}
          className="p-1.5 text-text-muted hover:text-text-tertiary cursor-grab active:cursor-grabbing rounded transition-colors hover:bg-white/5"
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

export default function AdminPage() {
  const { session, logout, isAdmin, isLoading: authLoading, startImpersonation } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>("users");

  // Users state
  const [users, setUsers] = useState<DashboardUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    role: "" as DashboardRole,
    pin: "",
    notes: "",
    default_page_override: "",
    additional_tabs: [] as string[],
  });
  const [showNewUserForm, setShowNewUserForm] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [newUser, setNewUser] = useState({
    name: "",
    role: "standard" as DashboardRole,
    pin: "",
    email: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  // Config state
  const [config, setConfig] = useState<DashboardConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configSaving, setConfigSaving] = useState(false);
  const [selectedTabOrderRole, setSelectedTabOrderRole] = useState<DashboardRole | "global">("global");

  // Stats state
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Activity log state
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activityFilter, setActivityFilter] = useState<{
    userId: string;
    action: string;
  }>({ userId: "", action: "" });

  // Sync health state
  const [syncHealth, setSyncHealth] = useState<SyncHealthResponse | null>(null);
  const [syncHealthLoading, setSyncHealthLoading] = useState(false);

  // Announcements state
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(false);
  const [showNewAnnouncementForm, setShowNewAnnouncementForm] = useState(false);
  const [newAnnouncement, setNewAnnouncement] = useState({
    title: "",
    message: "",
    severity: "info" as "info" | "warning" | "critical",
    expires_at: "",
  });
  const [announcementSaving, setAnnouncementSaving] = useState(false);

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

  // Handle drag end for tab reordering
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

  // Load stats
  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await fetch("/api/admin/stats", {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (error) {
      console.error("Failed to load stats:", error);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // Load sync health
  const loadSyncHealth = useCallback(async () => {
    setSyncHealthLoading(true);
    try {
      const res = await fetch("/api/sync-health");
      if (res.ok) {
        const data = await res.json();
        setSyncHealth(data);
      }
    } catch (error) {
      console.error("Failed to load sync health:", error);
    } finally {
      setSyncHealthLoading(false);
    }
  }, []);

  // Load announcements (all, including archived for admin view)
  const loadAnnouncements = useCallback(async () => {
    setAnnouncementsLoading(true);
    try {
      const supabase = await import("@/lib/supabase/client").then((m) => m.createClient());
      const { data, error } = await supabase
        .from("announcements")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setAnnouncements(data || []);
    } catch (error) {
      console.error("Failed to load announcements:", error);
    } finally {
      setAnnouncementsLoading(false);
    }
  }, []);

  // Create announcement
  const handleCreateAnnouncement = async () => {
    if (!newAnnouncement.title.trim()) {
      alert("Title is required");
      return;
    }
    setAnnouncementSaving(true);
    try {
      const res = await fetch("/api/announcements", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          title: newAnnouncement.title.trim(),
          message: newAnnouncement.message.trim() || null,
          severity: newAnnouncement.severity,
          expires_at: newAnnouncement.expires_at || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create announcement");
      }
      await loadAnnouncements();
      setNewAnnouncement({ title: "", message: "", severity: "info", expires_at: "" });
      setShowNewAnnouncementForm(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to create announcement");
    } finally {
      setAnnouncementSaving(false);
    }
  };

  // Archive announcement
  const handleArchiveAnnouncement = async (id: string) => {
    if (!confirm("Archive this announcement? It will no longer be visible to users.")) return;
    try {
      const res = await fetch(`/api/announcements/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to archive");
      await loadAnnouncements();
    } catch {
      alert("Failed to archive announcement");
    }
  };

  // Load activity log
  const loadActivities = useCallback(async (filters?: { userId?: string; action?: string }) => {
    setActivitiesLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", "100");
      if (filters?.userId) params.set("userId", filters.userId);
      if (filters?.action) params.set("action", filters.action);

      const res = await fetch(`/api/admin/activity?${params.toString()}`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setActivities(data.activities || []);
      }
    } catch (error) {
      console.error("Failed to load activities:", error);
    } finally {
      setActivitiesLoading(false);
    }
  }, []);

  // Load users
  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const res = await fetch("/api/admin/users", {
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        throw new Error("Failed to load users");
      }
      const data = await res.json();
      setUsers(data.users || []);
    } catch (error) {
      console.error("Failed to load users:", error);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  // Load config
  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      const res = await fetch("/api/admin/config");
      const data = await res.json();
      setConfig({
        tab_order: data.tab_order || ALL_TABS,
        hidden_tabs: data.hidden_tabs || [],
        role_permissions: data.role_permissions || {},
        role_defaults: data.role_defaults || {},
        role_tab_orders: data.role_tab_orders || {},
      });
    } catch (error) {
      console.error("Failed to load config:", error);
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) {
      loadUsers();
      loadConfig();
      loadStats();
    }
  }, [isAdmin, loadUsers, loadConfig, loadStats]);

  // Load activities when activity tab is selected
  useEffect(() => {
    if (activeTab === "activity" && activities.length === 0 && !activitiesLoading) {
      loadActivities();
    }
  }, [activeTab, activities.length, activitiesLoading, loadActivities]);

  // Load sync health when health tab is selected
  useEffect(() => {
    if (activeTab === "health" && !syncHealth && !syncHealthLoading) {
      loadSyncHealth();
    }
  }, [activeTab, syncHealth, syncHealthLoading, loadSyncHealth]);

  // Load announcements when announcements tab is selected
  useEffect(() => {
    if (activeTab === "announcements" && announcements.length === 0 && !announcementsLoading) {
      loadAnnouncements();
    }
  }, [activeTab, announcements.length, announcementsLoading, loadAnnouncements]);

  // Save config
  async function saveConfig(updates: Partial<DashboardConfig>) {
    setConfigSaving(true);
    try {
      const res = await fetch("/api/admin/config", {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          ...updates,
          updated_by: session?.userId,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      await loadConfig();
    } catch (error) {
      console.error("Failed to save config:", error);
      alert("Failed to save changes");
    } finally {
      setConfigSaving(false);
    }
  }

  // Generate random PIN
  function generateRandomPin(): string {
    return Math.floor(1000 + Math.random() * 9000).toString();
  }

  // User CRUD
  async function handleCreateUser() {
    if (!newUser.name || !newUser.pin) {
      alert("Name and PIN are required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(newUser),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create");
      }
      await loadUsers();
      await loadStats();
      setNewUser({ name: "", role: "standard", pin: "", email: "", notes: "" });
      setShowNewUserForm(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to create user");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveUser(userId: string) {
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {
        name: editForm.name,
        role: editForm.role,
        notes: editForm.notes,
        default_page_override: editForm.default_page_override || null,
        additional_tabs: editForm.additional_tabs,
      };
      if (editForm.pin && editForm.pin.length === 4) {
        updates.pin = editForm.pin;
      }
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update");
      await loadUsers();
      setEditingUserId(null);
    } catch {
      alert("Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(userId: string, currentStatus: boolean) {
    try {
      await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_active: !currentStatus }),
      });
      await loadUsers();
      await loadStats();
    } catch {
      alert("Failed to update status");
    }
  }

  function startEditUser(user: DashboardUser) {
    setEditingUserId(user.id);
    setEditForm({
      name: user.name,
      role: user.role,
      pin: "",
      notes: user.notes || "",
      default_page_override: user.default_page_override || "",
      additional_tabs: user.additional_tabs || [],
    });
    setShowEditModal(true);
  }

  function closeEditModal() {
    setShowEditModal(false);
    setEditingUserId(null);
  }

  // Get accessible tabs for current edit form role
  function getAccessibleTabsForRole(role: DashboardRole): DashboardTab[] {
    if (!config) return [];
    return config.tab_order.filter((tab) => {
      if (config.hidden_tabs.includes(tab)) return false;
      if (role === "admin") return true;
      const perms = config.role_permissions[role] || [];
      return perms.includes("*") || perms.includes(tab);
    });
  }

  // Get tabs that are NOT accessible for the role
  function getNonAccessibleTabsForRole(role: DashboardRole): DashboardTab[] {
    if (!config) return [];
    return config.tab_order.filter((tab) => {
      if (config.hidden_tabs.includes(tab)) return false;
      if (role === "admin") return false;
      const perms = config.role_permissions[role] || [];
      return !perms.includes("*") && !perms.includes(tab);
    });
  }

  // Get activity summary for a user
  function getActivitySummary(userId: string): UserActivitySummary | null {
    return stats?.activitySummaries?.[userId] || null;
  }

  // Format relative time
  function formatRelativeTime(dateStr: string | null): string {
    if (!dateStr) return "Never";
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  // Get the current tab order
  function getCurrentTabOrder(): DashboardTab[] {
    if (!config) return [];
    if (selectedTabOrderRole === "global") {
      return config.tab_order;
    }
    return config.role_tab_orders[selectedTabOrderRole] || config.tab_order;
  }

  // Check if the selected role has a custom tab order
  function hasCustomTabOrder(): boolean {
    if (!config || selectedTabOrderRole === "global") return false;
    return !!config.role_tab_orders[selectedTabOrderRole];
  }

  // Reset role's tab order to global
  function resetRoleTabOrder() {
    if (!config || selectedTabOrderRole === "global") return;
    const newRoleTabOrders = { ...config.role_tab_orders };
    delete newRoleTabOrders[selectedTabOrderRole];
    saveConfig({ role_tab_orders: newRoleTabOrders });
  }

  // Tab visibility
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

  // Role permissions
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

  // Role defaults
  function setRoleDefault(role: DashboardRole, tab: DashboardTab) {
    if (!config) return;
    const defaults = { ...config.role_defaults, [role]: tab };
    saveConfig({ role_defaults: defaults });
  }

  // Check role permission
  function roleHasPermission(role: DashboardRole, tab: DashboardTab): boolean {
    if (!config) return false;
    const perms = config.role_permissions[role];
    if (!perms) return false;
    return perms.includes("*") || perms.includes(tab);
  }

  // Auth loading
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="w-8 h-8 animate-spin text-accent-blue" />
          <span className="text-sm text-text-tertiary">Loading...</span>
        </div>
      </div>
    );
  }

  // Not admin
  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-status-bad/10 flex items-center justify-center mx-auto">
            <X className="w-8 h-8 text-status-bad" />
          </div>
          <p className="text-xl text-text-primary font-medium">Access Denied</p>
          <p className="text-sm text-text-tertiary">You don&apos;t have permission to view this page.</p>
          <Link
            href="/inventory"
            className="inline-flex items-center gap-2 text-accent-blue hover:text-accent-blue/80 transition-colors text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-bg-secondary/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Link
              href="/inventory"
              className="group flex items-center gap-2.5 text-text-tertiary hover:text-text-secondary transition-colors"
            >
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
              <span className="text-sm font-medium">Dashboard</span>
            </Link>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <UserAvatar name={session?.name || "Admin"} role="admin" size="sm" />
                <span className="text-sm text-text-secondary hidden sm:inline">{session?.name}</span>
              </div>
              <button
                onClick={logout}
                className="p-2 rounded-lg text-text-tertiary hover:text-status-warning hover:bg-status-warning/10 transition-all"
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Title & Logo */}
          <div className="flex items-center gap-4 mt-6">
            <div className="p-2 rounded-xl bg-bg-tertiary border border-border">
              <Image
                src="/smithey-logo-white.png"
                alt="Smithey"
                width={28}
                height={28}
                className="object-contain opacity-80"
              />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-text-primary tracking-tight">Admin Panel</h1>
              <p className="text-xs text-text-tertiary mt-0.5">Manage users, permissions, and settings</p>
            </div>
          </div>

          {/* Tab Navigation */}
          <nav className="flex gap-1 mt-6 -mb-px">
            {ADMIN_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    group relative flex items-center gap-2 px-4 py-3 text-sm font-medium
                    transition-all duration-200 rounded-t-lg
                    ${isActive
                      ? "text-text-primary"
                      : "text-text-tertiary hover:text-text-secondary"
                    }
                  `}
                >
                  <Icon className={`w-4 h-4 transition-colors ${isActive ? "text-accent-blue" : ""}`} />
                  <span className="hidden sm:inline">{tab.label}</span>

                  {/* Active indicator */}
                  {isActive && (
                    <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent-blue rounded-full" />
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Quick Stats Header */}
        {!statsLoading && stats && (
          <QuickStatsHeader
            totalUsers={stats.totalUsers}
            activeThisWeek={stats.activeThisWeek}
            activeToday={stats.activeToday}
            mostViewedTab={stats.mostViewedTab}
            syncHealthy={true}
            onStatClick={(stat) => {
              if (stat === "users") setActiveTab("users");
              if (stat === "tabs") setActiveTab("tabs");
              if (stat === "activity") setActiveTab("activity");
              if (stat === "health") setActiveTab("health");
            }}
          />
        )}

        {/* Users Tab */}
        {activeTab === "users" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="text-lg font-medium text-text-primary">Dashboard Users</h2>
                <p className="text-sm text-text-tertiary mt-1">Manage access and permissions for team members</p>
              </div>
              <button
                onClick={() => setShowNewUserForm(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-accent-blue text-white text-sm font-medium rounded-lg hover:bg-accent-blue/90 transition-all shadow-lg shadow-accent-blue/20"
              >
                <UserPlus className="w-4 h-4" />
                Add User
              </button>
            </div>

            {/* New User Form */}
            {showNewUserForm && (
              <div className="bg-bg-secondary rounded-xl border border-border p-5 space-y-4 animate-in slide-in-from-top-2 duration-200">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
                    Create New User
                  </h3>
                  <button
                    onClick={() => setShowNewUserForm(false)}
                    className="p-1.5 text-text-tertiary hover:text-text-primary hover:bg-white/5 rounded-md transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                  <input
                    type="text"
                    placeholder="Name *"
                    value={newUser.name}
                    onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                    className="px-4 py-2.5 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:outline-none focus:ring-2 focus:ring-accent-blue/20 transition-all"
                  />
                  <select
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value as DashboardRole })}
                    className="px-4 py-2.5 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary focus:border-accent-blue focus:outline-none focus:ring-2 focus:ring-accent-blue/20 transition-all"
                  >
                    {ALL_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_CONFIG[role].label}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="PIN *"
                      maxLength={4}
                      value={newUser.pin}
                      onChange={(e) => setNewUser({ ...newUser, pin: e.target.value.replace(/\D/g, "") })}
                      className="flex-1 px-4 py-2.5 bg-bg-tertiary border border-border rounded-lg text-sm text-center font-mono tracking-widest text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:outline-none focus:ring-2 focus:ring-accent-blue/20 transition-all"
                    />
                    <button
                      onClick={() => setNewUser({ ...newUser, pin: generateRandomPin() })}
                      className="px-3 py-2.5 bg-bg-tertiary border border-border rounded-lg text-text-tertiary hover:text-text-primary hover:border-text-tertiary transition-all"
                      title="Generate random PIN"
                    >
                      <Shuffle className="w-4 h-4" />
                    </button>
                  </div>
                  <input
                    type="email"
                    placeholder="Email (optional)"
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                    className="px-4 py-2.5 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:outline-none focus:ring-2 focus:ring-accent-blue/20 transition-all"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleCreateUser}
                      disabled={saving || !newUser.name || !newUser.pin}
                      className="flex-1 px-4 py-2.5 bg-status-good text-white rounded-lg text-sm font-medium hover:bg-status-good/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      {saving ? "Creating..." : "Create"}
                    </button>
                    <button
                      onClick={() => setShowNewUserForm(false)}
                      className="px-4 py-2.5 bg-bg-tertiary text-text-secondary rounded-lg text-sm hover:bg-border transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Users Table */}
            {usersLoading ? (
              <div className="flex justify-center py-16">
                <RefreshCw className="w-6 h-6 animate-spin text-accent-blue" />
              </div>
            ) : (
              <div className="bg-bg-secondary rounded-xl border border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-bg-tertiary/30">
                        <th className="text-left py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium w-14" />
                        <th className="text-left py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">
                          User
                        </th>
                        <th className="text-left py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">
                          Role
                        </th>
                        <th className="text-center py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">
                          Activity
                        </th>
                        <th className="text-center py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">
                          PIN
                        </th>
                        <th className="text-center py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">
                          Status
                        </th>
                        <th className="text-center py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">
                          Last Active
                        </th>
                        <th className="text-center py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium w-24">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {users.map((user) => {
                        const activity = getActivitySummary(user.id);
                        return (
                          <tr
                            key={user.id}
                            className={`
                              transition-all duration-200 hover:bg-white/[0.02]
                              ${!user.is_active ? "opacity-40" : ""}
                            `}
                          >
                            {/* Avatar */}
                            <td className="py-4 px-4">
                              <UserAvatar
                                name={user.name}
                                role={user.role}
                                showActiveIndicator
                                isActive={activity?.isActiveNow || false}
                              />
                            </td>

                            {/* Name */}
                            <td className="py-4 px-4">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-text-primary font-medium">{user.name}</span>
                                  {user.default_page_override && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-cyan/10 text-accent-cyan">
                                      {TAB_CONFIG[user.default_page_override as DashboardTab]?.label || user.default_page_override}
                                    </span>
                                  )}
                                  {user.additional_tabs && user.additional_tabs.length > 0 && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-status-warning/10 text-status-warning">
                                      +{user.additional_tabs.length}
                                    </span>
                                  )}
                                </div>
                                {user.notes && (
                                  <p className="text-xs text-text-muted truncate max-w-[200px]" title={user.notes}>
                                    {user.notes}
                                  </p>
                                )}
                              </div>
                            </td>

                            {/* Role */}
                            <td className="py-4 px-4">
                              <span className={`inline-flex px-2.5 py-1 rounded-md text-xs font-medium ${ROLE_CONFIG[user.role].color}`}>
                                {ROLE_CONFIG[user.role].label}
                              </span>
                            </td>

                            {/* Activity Sparkline */}
                            <td className="py-4 px-4">
                              <div className="flex justify-center">
                                {activity ? (
                                  <ActivitySparkline
                                    dailyActivity={activity.dailyActivity}
                                    daysActive={activity.daysActive}
                                  />
                                ) : (
                                  <span className="text-text-muted text-xs">No data</span>
                                )}
                              </div>
                            </td>

                            {/* PIN */}
                            <td className="py-4 px-4">
                              <div className="flex justify-center">
                                <PinReveal pin={user.pin} />
                              </div>
                            </td>

                            {/* Status */}
                            <td className="py-4 px-4 text-center">
                              <button
                                onClick={() => handleToggleActive(user.id, user.is_active)}
                                className={`
                                  inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all
                                  ${user.is_active
                                    ? "bg-status-good/10 text-status-good hover:bg-status-good/20"
                                    : "bg-text-muted/10 text-text-muted hover:bg-text-muted/20"
                                  }
                                `}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${user.is_active ? "bg-status-good" : "bg-text-muted"}`} />
                                {user.is_active ? "Active" : "Inactive"}
                              </button>
                            </td>

                            {/* Last Active */}
                            <td className="py-4 px-4 text-center">
                              <span className="text-xs text-text-tertiary">
                                {formatRelativeTime(user.last_active_at || user.last_login_at)}
                              </span>
                            </td>

                            {/* Actions */}
                            <td className="py-4 px-4">
                              <div className="flex justify-center gap-1">
                                <button
                                  onClick={() => startEditUser(user)}
                                  className="p-2 rounded-lg text-text-tertiary hover:text-accent-blue hover:bg-accent-blue/10 transition-all"
                                  title="Edit user"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                                {user.role !== "admin" && user.is_active && (
                                  <button
                                    onClick={() => startImpersonation({ id: user.id, name: user.name, role: user.role })}
                                    className="p-2 rounded-lg text-text-tertiary hover:text-purple-400 hover:bg-purple-400/10 transition-all"
                                    title={`Login as ${user.name}`}
                                  >
                                    <LogIn className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
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
        )}

        {/* Tabs & Permissions */}
        {activeTab === "tabs" && (
          <div className="space-y-6 animate-in fade-in duration-300">
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
        )}

        {/* Role Defaults */}
        {activeTab === "defaults" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-lg font-medium text-text-primary">Role Defaults</h2>
                <p className="text-sm text-text-tertiary mt-1">Set the default landing page for each role</p>
              </div>
              {configSaving && (
                <span className="text-xs text-text-tertiary flex items-center gap-2">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  Saving...
                </span>
              )}
            </div>

            {configLoading ? (
              <div className="flex justify-center py-16">
                <RefreshCw className="w-6 h-6 animate-spin text-accent-blue" />
              </div>
            ) : config ? (
              <div className="bg-bg-secondary rounded-xl border border-border overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-bg-tertiary/30">
                      <th className="text-left py-3.5 px-5 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Role</th>
                      <th className="text-left py-3.5 px-5 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Default Page</th>
                      <th className="text-center py-3.5 px-5 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Users</th>
                      <th className="text-center py-3.5 px-5 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Overrides</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {ALL_ROLES.map((role) => {
                      const accessibleTabs = config.tab_order.filter((tab) => {
                        if (config.hidden_tabs.includes(tab)) return false;
                        if (role === "admin") return true;
                        const perms = config.role_permissions[role] || [];
                        return perms.includes("*") || perms.includes(tab);
                      });

                      const roleUsers = users.filter((u) => u.role === role && u.is_active);
                      const usersWithOverride = roleUsers.filter((u) => u.default_page_override);

                      return (
                        <tr key={role} className="hover:bg-white/[0.02] transition-colors">
                          <td className="py-4 px-5">
                            <span className={`inline-flex px-2.5 py-1 rounded-md text-xs font-medium ${ROLE_CONFIG[role].color}`}>
                              {ROLE_CONFIG[role].label}
                            </span>
                          </td>
                          <td className="py-4 px-5">
                            <select
                              value={config.role_defaults[role] || accessibleTabs[0] || "inventory"}
                              onChange={(e) => setRoleDefault(role, e.target.value as DashboardTab)}
                              className="px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary focus:border-accent-blue focus:outline-none focus:ring-2 focus:ring-accent-blue/20 min-w-[200px] transition-all"
                            >
                              {accessibleTabs.map((tab) => (
                                <option key={tab} value={tab}>
                                  {TAB_CONFIG[tab]?.label || tab}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-4 px-5 text-center">
                            <span className="text-sm text-text-secondary font-medium">{roleUsers.length}</span>
                          </td>
                          <td className="py-4 px-5 text-center">
                            {usersWithOverride.length > 0 ? (
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-status-warning/10 text-status-warning text-xs font-medium">
                                {usersWithOverride.length}
                              </span>
                            ) : (
                              <span className="text-text-muted">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}

            <p className="text-xs text-text-muted">
              Users land on their role&apos;s default page after login. Individual overrides can be set in the Users tab.
            </p>
          </div>
        )}

        {/* Activity Log */}
        {activeTab === "activity" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="text-lg font-medium text-text-primary">Activity Log</h2>
                <p className="text-sm text-text-tertiary mt-1">Track user logins and page views</p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={activityFilter.userId}
                  onChange={(e) => {
                    const newFilter = { ...activityFilter, userId: e.target.value };
                    setActivityFilter(newFilter);
                    loadActivities({ userId: newFilter.userId || undefined, action: newFilter.action || undefined });
                  }}
                  className="px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm text-text-primary focus:border-accent-blue focus:outline-none transition-all"
                >
                  <option value="">All Users</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>{user.name}</option>
                  ))}
                </select>

                <select
                  value={activityFilter.action}
                  onChange={(e) => {
                    const newFilter = { ...activityFilter, action: e.target.value };
                    setActivityFilter(newFilter);
                    loadActivities({ userId: newFilter.userId || undefined, action: newFilter.action || undefined });
                  }}
                  className="px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm text-text-primary focus:border-accent-blue focus:outline-none transition-all"
                >
                  <option value="">All Actions</option>
                  <option value="login">Login</option>
                  <option value="page_view">Page View</option>
                  <option value="logout">Logout</option>
                </select>

                <button
                  onClick={() => loadActivities({ userId: activityFilter.userId || undefined, action: activityFilter.action || undefined })}
                  className="p-2 rounded-lg text-text-tertiary hover:text-accent-blue hover:bg-accent-blue/10 transition-all"
                  title="Refresh"
                >
                  <RefreshCw className={`w-4 h-4 ${activitiesLoading ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            {activitiesLoading ? (
              <div className="flex justify-center py-16">
                <RefreshCw className="w-6 h-6 animate-spin text-accent-blue" />
              </div>
            ) : activities.length === 0 ? (
              <div className="text-center py-16 text-text-tertiary">
                <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No activity recorded yet.</p>
              </div>
            ) : (
              <div className="bg-bg-secondary rounded-xl border border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-bg-tertiary/30">
                        <th className="text-left py-3.5 px-5 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">User</th>
                        <th className="text-left py-3.5 px-5 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Action</th>
                        <th className="text-left py-3.5 px-5 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Tab</th>
                        <th className="text-right py-3.5 px-5 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {activities.map((activity) => (
                        <tr key={activity.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="py-3.5 px-5">
                            <div className="flex items-center gap-3">
                              <UserAvatar
                                name={activity.userName}
                                role={activity.userRole as DashboardRole}
                                size="sm"
                              />
                              <div>
                                <span className="text-sm text-text-primary font-medium">{activity.userName}</span>
                                {activity.userRole && (
                                  <span className="ml-2 text-xs text-text-muted">
                                    {ROLE_CONFIG[activity.userRole as DashboardRole]?.label || activity.userRole}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="py-3.5 px-5">
                            <span className={`
                              inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium
                              ${activity.action === "login"
                                ? "bg-status-good/10 text-status-good"
                                : activity.action === "logout"
                                ? "bg-status-bad/10 text-status-bad"
                                : "bg-accent-blue/10 text-accent-blue"
                              }
                            `}>
                              {activity.action === "page_view" ? "viewed" : activity.action}
                            </span>
                          </td>
                          <td className="py-3.5 px-5">
                            {activity.tab ? (
                              <span className="text-sm text-text-secondary">
                                {TAB_CONFIG[activity.tab as DashboardTab]?.label || activity.tab}
                              </span>
                            ) : (
                              <span className="text-text-muted">—</span>
                            )}
                          </td>
                          <td className="py-3.5 px-5 text-right">
                            <span className="text-xs text-text-tertiary">
                              {formatRelativeTime(activity.createdAt)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <p className="text-xs text-text-muted">
              Showing the last 100 activity entries.
            </p>
          </div>
        )}

        {/* Sync Health Tab */}
        {activeTab === "health" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="text-lg font-medium text-text-primary">Data Sync Health</h2>
                <p className="text-sm text-text-tertiary mt-1">Monitor data pipeline status and freshness</p>
              </div>

              <div className="flex items-center gap-3">
                {syncHealth && (
                  <div className={`
                    flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium
                    ${syncHealth.status === "healthy"
                      ? "bg-status-good/10 text-status-good"
                      : syncHealth.status === "warning"
                      ? "bg-status-warning/10 text-status-warning"
                      : "bg-status-bad/10 text-status-bad"
                    }
                  `}>
                    <span className={`w-2 h-2 rounded-full ${
                      syncHealth.status === "healthy" ? "bg-status-good" :
                      syncHealth.status === "warning" ? "bg-status-warning animate-pulse" :
                      "bg-status-bad animate-pulse"
                    }`} />
                    {syncHealth.status === "healthy" ? "All Systems Healthy" :
                     syncHealth.status === "warning" ? "Some Syncs Stale" :
                     "Critical Issues"}
                  </div>
                )}
                <button
                  onClick={() => {
                    setSyncHealth(null);
                    loadSyncHealth();
                  }}
                  className="p-2 rounded-lg text-text-tertiary hover:text-accent-blue hover:bg-accent-blue/10 transition-all"
                  title="Refresh"
                >
                  <RefreshCw className={`w-4 h-4 ${syncHealthLoading ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            {syncHealthLoading && !syncHealth ? (
              <div className="flex justify-center py-16">
                <RefreshCw className="w-6 h-6 animate-spin text-accent-blue" />
              </div>
            ) : syncHealth ? (
              <div className="bg-bg-secondary rounded-xl border border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-bg-tertiary/30">
                        <th className="text-left py-3.5 px-5 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Data Source</th>
                        <th className="text-center py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Status</th>
                        <th className="text-right py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Records</th>
                        <th className="text-right py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Duration</th>
                        <th className="text-right py-3.5 px-5 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Last Sync</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {syncHealth.syncs
                        .sort((a, b) => {
                          // Sort: critical first, then warning, then healthy
                          const statusOrder = { failed: 0, partial: 1, success: 2 };
                          const aOrder = a.isStale ? 0.5 : (statusOrder[a.status as keyof typeof statusOrder] ?? 2);
                          const bOrder = b.isStale ? 0.5 : (statusOrder[b.status as keyof typeof statusOrder] ?? 2);
                          return aOrder - bOrder;
                        })
                        .map((sync) => {
                          const isHealthy = sync.status === "success" && !sync.isStale;
                          const isWarning = sync.isStale || sync.status === "partial";
                          const isCritical = sync.status === "failed";

                          return (
                            <tr
                              key={sync.type}
                              className={`
                                transition-all duration-200 hover:bg-white/[0.02]
                                ${isCritical ? "bg-status-bad/5" : isWarning ? "bg-status-warning/5" : ""}
                              `}
                            >
                              {/* Data Source */}
                              <td className="py-4 px-5">
                                <div className="space-y-1">
                                  <span className="text-text-primary font-medium">
                                    {SYNC_TYPE_LABELS[sync.type] || sync.type}
                                  </span>
                                  {sync.error && (
                                    <p className="text-xs text-status-bad truncate max-w-[300px]" title={sync.error}>
                                      {sync.error}
                                    </p>
                                  )}
                                </div>
                              </td>

                              {/* Status */}
                              <td className="py-4 px-4 text-center">
                                <span className={`
                                  inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
                                  ${isCritical
                                    ? "bg-status-bad/10 text-status-bad"
                                    : isWarning
                                    ? "bg-status-warning/10 text-status-warning"
                                    : "bg-status-good/10 text-status-good"
                                  }
                                `}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${
                                    isCritical ? "bg-status-bad" :
                                    isWarning ? "bg-status-warning" :
                                    "bg-status-good"
                                  }`} />
                                  {isCritical ? "Failed" : isWarning ? (sync.isStale ? "Stale" : "Partial") : "Healthy"}
                                </span>
                              </td>

                              {/* Records */}
                              <td className="py-4 px-4 text-right">
                                {sync.recordsSynced !== null ? (
                                  <div className="space-y-0.5">
                                    <span className="text-sm text-text-primary font-medium">
                                      {sync.recordsSynced.toLocaleString()}
                                    </span>
                                    {sync.recordsExpected !== null && sync.recordsExpected !== sync.recordsSynced && (
                                      <div className="text-[10px] text-text-muted">
                                        of {sync.recordsExpected.toLocaleString()}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-text-muted">—</span>
                                )}
                              </td>

                              {/* Duration */}
                              <td className="py-4 px-4 text-right">
                                {sync.durationMs !== null ? (
                                  <span className="text-sm text-text-secondary">
                                    {sync.durationMs < 1000
                                      ? `${sync.durationMs}ms`
                                      : sync.durationMs < 60000
                                      ? `${(sync.durationMs / 1000).toFixed(1)}s`
                                      : `${Math.floor(sync.durationMs / 60000)}m ${Math.round((sync.durationMs % 60000) / 1000)}s`
                                    }
                                  </span>
                                ) : (
                                  <span className="text-text-muted">—</span>
                                )}
                              </td>

                              {/* Last Sync */}
                              <td className="py-4 px-5 text-right">
                                <div className="space-y-0.5">
                                  <span className="text-xs text-text-tertiary">
                                    {sync.lastRun ? formatRelativeTime(sync.lastRun) : "Never"}
                                  </span>
                                  {sync.hoursSinceSuccess !== null && sync.hoursSinceSuccess > 0 && (
                                    <div className={`text-[10px] ${
                                      sync.isStale ? "text-status-warning" : "text-text-muted"
                                    }`}>
                                      {sync.hoursSinceSuccess < 1
                                        ? "< 1 hour ago"
                                        : sync.hoursSinceSuccess < 24
                                        ? `${Math.round(sync.hoursSinceSuccess)}h ago`
                                        : `${Math.round(sync.hoursSinceSuccess / 24)}d ago`
                                      }
                                      {sync.isStale && ` (threshold: ${sync.staleThreshold}h)`}
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="text-center py-16 text-text-tertiary">
                <RefreshCw className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Unable to load sync health data.</p>
              </div>
            )}

            {syncHealth && (
              <p className="text-xs text-text-muted">
                Last checked: {new Date(syncHealth.checkedAt).toLocaleString()}
              </p>
            )}
          </div>
        )}

        {/* Announcements Tab */}
        {activeTab === "announcements" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="text-lg font-medium text-text-primary">System Announcements</h2>
                <p className="text-sm text-text-tertiary mt-1">Create alerts visible to all dashboard users</p>
              </div>
              <button
                onClick={() => setShowNewAnnouncementForm(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-accent-blue text-white text-sm font-medium rounded-lg hover:bg-accent-blue/90 transition-all shadow-lg shadow-accent-blue/20"
              >
                <Plus className="w-4 h-4" />
                New Announcement
              </button>
            </div>

            {/* New Announcement Form */}
            {showNewAnnouncementForm && (
              <div className="bg-bg-secondary rounded-xl border border-border p-5 space-y-4 animate-in slide-in-from-top-2 duration-200">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
                    Create Announcement
                  </h3>
                  <button
                    onClick={() => setShowNewAnnouncementForm(false)}
                    className="p-1.5 text-text-tertiary hover:text-text-primary hover:bg-white/5 rounded-md transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="block text-sm text-text-secondary mb-2">Title *</label>
                    <input
                      type="text"
                      placeholder="e.g., Product X out of stock until Jan 15"
                      value={newAnnouncement.title}
                      onChange={(e) => setNewAnnouncement({ ...newAnnouncement, title: e.target.value })}
                      className="w-full px-4 py-2.5 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:outline-none focus:ring-2 focus:ring-accent-blue/20 transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-text-secondary mb-2">Message (optional)</label>
                    <textarea
                      placeholder="Additional details..."
                      rows={2}
                      value={newAnnouncement.message}
                      onChange={(e) => setNewAnnouncement({ ...newAnnouncement, message: e.target.value })}
                      className="w-full px-4 py-2.5 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:outline-none focus:ring-2 focus:ring-accent-blue/20 resize-none transition-all"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-text-secondary mb-2">Severity</label>
                      <select
                        value={newAnnouncement.severity}
                        onChange={(e) => setNewAnnouncement({ ...newAnnouncement, severity: e.target.value as "info" | "warning" | "critical" })}
                        className="w-full px-4 py-2.5 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary focus:border-accent-blue focus:outline-none focus:ring-2 focus:ring-accent-blue/20 transition-all"
                      >
                        <option value="info">Info (Blue)</option>
                        <option value="warning">Warning (Amber)</option>
                        <option value="critical">Critical (Red)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm text-text-secondary mb-2">Expires (optional)</label>
                      <input
                        type="date"
                        value={newAnnouncement.expires_at}
                        onChange={(e) => setNewAnnouncement({ ...newAnnouncement, expires_at: e.target.value })}
                        className="w-full px-4 py-2.5 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary focus:border-accent-blue focus:outline-none focus:ring-2 focus:ring-accent-blue/20 transition-all"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={handleCreateAnnouncement}
                      disabled={announcementSaving || !newAnnouncement.title.trim()}
                      className="flex-1 px-4 py-2.5 bg-status-good text-white rounded-lg text-sm font-medium hover:bg-status-good/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      {announcementSaving ? "Creating..." : "Create Announcement"}
                    </button>
                    <button
                      onClick={() => setShowNewAnnouncementForm(false)}
                      className="px-4 py-2.5 bg-bg-tertiary text-text-secondary rounded-lg text-sm hover:bg-border transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Announcements List */}
            {announcementsLoading ? (
              <div className="flex justify-center py-16">
                <RefreshCw className="w-6 h-6 animate-spin text-accent-blue" />
              </div>
            ) : announcements.length === 0 ? (
              <div className="text-center py-16 text-text-tertiary">
                <Megaphone className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No announcements yet.</p>
                <p className="text-sm mt-1">Create one to alert all dashboard users.</p>
              </div>
            ) : (
              <div className="bg-bg-secondary rounded-xl border border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-bg-tertiary/30">
                        <th className="text-left py-3.5 px-5 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Announcement</th>
                        <th className="text-center py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Severity</th>
                        <th className="text-center py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Status</th>
                        <th className="text-right py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Created</th>
                        <th className="text-right py-3.5 px-5 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Expires</th>
                        <th className="text-center py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium w-20">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {announcements.map((announcement) => {
                        const isExpired = announcement.expires_at && new Date(announcement.expires_at) < new Date();
                        const isActive = !announcement.is_archived && !isExpired;

                        return (
                          <tr
                            key={announcement.id}
                            className={`
                              transition-all duration-200 hover:bg-white/[0.02]
                              ${announcement.is_archived || isExpired ? "opacity-40" : ""}
                            `}
                          >
                            {/* Title & Message */}
                            <td className="py-4 px-5">
                              <div className="space-y-1">
                                <span className="text-text-primary font-medium">{announcement.title}</span>
                                {announcement.message && (
                                  <p className="text-xs text-text-muted truncate max-w-[300px]" title={announcement.message}>
                                    {announcement.message}
                                  </p>
                                )}
                                <p className="text-[10px] text-text-muted">by {announcement.created_by}</p>
                              </div>
                            </td>

                            {/* Severity */}
                            <td className="py-4 px-4 text-center">
                              <span className={`
                                inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium
                                ${announcement.severity === "critical"
                                  ? "bg-status-bad/10 text-status-bad"
                                  : announcement.severity === "warning"
                                  ? "bg-status-warning/10 text-status-warning"
                                  : "bg-accent-blue/10 text-accent-blue"
                                }
                              `}>
                                {announcement.severity}
                              </span>
                            </td>

                            {/* Status */}
                            <td className="py-4 px-4 text-center">
                              <span className={`
                                inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
                                ${isActive
                                  ? "bg-status-good/10 text-status-good"
                                  : "bg-text-muted/10 text-text-muted"
                                }
                              `}>
                                <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-status-good" : "bg-text-muted"}`} />
                                {announcement.is_archived ? "Archived" : isExpired ? "Expired" : "Active"}
                              </span>
                            </td>

                            {/* Created */}
                            <td className="py-4 px-4 text-right">
                              <span className="text-xs text-text-tertiary">
                                {formatRelativeTime(announcement.created_at)}
                              </span>
                            </td>

                            {/* Expires */}
                            <td className="py-4 px-5 text-right">
                              <span className={`text-xs ${isExpired ? "text-status-warning" : "text-text-tertiary"}`}>
                                {announcement.expires_at
                                  ? new Date(announcement.expires_at).toLocaleDateString()
                                  : "Never"}
                              </span>
                            </td>

                            {/* Actions */}
                            <td className="py-4 px-4">
                              <div className="flex justify-center">
                                {!announcement.is_archived && (
                                  <button
                                    onClick={() => handleArchiveAnnouncement(announcement.id)}
                                    className="p-2 rounded-lg text-text-tertiary hover:text-status-bad hover:bg-status-bad/10 transition-all"
                                    title="Archive"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <p className="text-xs text-text-muted">
              Active announcements appear on all dashboard pages until dismissed by each user.
            </p>
          </div>
        )}
      </main>

      {/* Edit User Modal */}
      {showEditModal && editingUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={closeEditModal}
          />

          {/* Modal */}
          <div className="relative bg-bg-secondary border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
            {/* Header */}
            <div className="sticky top-0 bg-bg-secondary/95 backdrop-blur-xl border-b border-border px-6 py-5 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <UserAvatar
                  name={editForm.name || "User"}
                  role={editForm.role}
                  size="lg"
                />
                <div>
                  <h3 className="text-lg font-semibold text-text-primary">Edit User</h3>
                  <p className="text-sm text-text-tertiary mt-0.5">
                    {ROLE_CONFIG[editForm.role]?.label || editForm.role}
                  </p>
                </div>
              </div>
              <button
                onClick={closeEditModal}
                className="p-2 text-text-tertiary hover:text-text-primary hover:bg-white/5 rounded-lg transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <div className="p-6 space-y-6 overflow-y-auto max-h-[60vh]">
              {/* Basic Info */}
              <div className="space-y-4">
                <h4 className="text-xs uppercase tracking-wider text-text-tertiary font-semibold">Basic Information</h4>

                <div>
                  <label className="block text-sm text-text-secondary mb-2">Name</label>
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="w-full px-4 py-2.5 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary focus:border-accent-blue focus:outline-none focus:ring-2 focus:ring-accent-blue/20 transition-all"
                    placeholder="Enter name"
                  />
                </div>

                <div>
                  <label className="block text-sm text-text-secondary mb-2">Role</label>
                  <select
                    value={editForm.role}
                    onChange={(e) => {
                      const newRole = e.target.value as DashboardRole;
                      setEditForm({
                        ...editForm,
                        role: newRole,
                        additional_tabs: editForm.additional_tabs.filter(
                          (tab) => getNonAccessibleTabsForRole(newRole).includes(tab as DashboardTab)
                        ),
                      });
                    }}
                    className="w-full px-4 py-2.5 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary focus:border-accent-blue focus:outline-none focus:ring-2 focus:ring-accent-blue/20 transition-all"
                  >
                    {ALL_ROLES.map((role) => (
                      <option key={role} value={role}>{ROLE_CONFIG[role].label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-text-secondary mb-2">PIN</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      maxLength={4}
                      value={editForm.pin}
                      onChange={(e) => setEditForm({ ...editForm, pin: e.target.value.replace(/\D/g, "") })}
                      className="flex-1 px-4 py-2.5 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary font-mono text-center tracking-widest focus:border-accent-blue focus:outline-none focus:ring-2 focus:ring-accent-blue/20 transition-all"
                      placeholder="Leave blank to keep"
                    />
                    <button
                      onClick={() => setEditForm({ ...editForm, pin: generateRandomPin() })}
                      className="px-4 py-2.5 bg-bg-tertiary border border-border rounded-lg text-text-tertiary hover:text-text-primary hover:border-text-tertiary transition-all"
                      title="Generate random PIN"
                    >
                      <Shuffle className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs text-text-muted mt-2">4 digits only. Leave blank to keep existing.</p>
                </div>
              </div>

              {/* Customization */}
              <div className="space-y-4 pt-4 border-t border-border">
                <h4 className="text-xs uppercase tracking-wider text-text-tertiary font-semibold">Customization</h4>

                <div>
                  <label className="block text-sm text-text-secondary mb-2">Default Page</label>
                  <select
                    value={editForm.default_page_override || ""}
                    onChange={(e) => setEditForm({ ...editForm, default_page_override: e.target.value })}
                    className="w-full px-4 py-2.5 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary focus:border-accent-blue focus:outline-none focus:ring-2 focus:ring-accent-blue/20 transition-all"
                  >
                    <option value="">Use Role Default ({config?.role_defaults[editForm.role] ? TAB_CONFIG[config.role_defaults[editForm.role]]?.label : "Inventory"})</option>
                    {getAccessibleTabsForRole(editForm.role).map((tab) => (
                      <option key={tab} value={tab}>{TAB_CONFIG[tab]?.label || tab}</option>
                    ))}
                  </select>
                </div>

                {editForm.role !== "admin" && getNonAccessibleTabsForRole(editForm.role).length > 0 && (
                  <div>
                    <label className="block text-sm text-text-secondary mb-2">Additional Tab Access</label>
                    <p className="text-xs text-text-muted mb-3">
                      Grant access to tabs beyond {ROLE_CONFIG[editForm.role]?.label} defaults:
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {getNonAccessibleTabsForRole(editForm.role).map((tab) => (
                        <label
                          key={tab}
                          className={`
                            flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-all
                            ${editForm.additional_tabs.includes(tab)
                              ? "bg-accent-blue/10 border border-accent-blue/30"
                              : "bg-bg-tertiary border border-border hover:border-text-muted"
                            }
                          `}
                        >
                          <input
                            type="checkbox"
                            checked={editForm.additional_tabs.includes(tab)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setEditForm({ ...editForm, additional_tabs: [...editForm.additional_tabs, tab] });
                              } else {
                                setEditForm({ ...editForm, additional_tabs: editForm.additional_tabs.filter((t) => t !== tab) });
                              }
                            }}
                            className="w-4 h-4 rounded border-border bg-bg-tertiary text-accent-blue focus:ring-accent-blue focus:ring-offset-0"
                          />
                          <span className="text-sm text-text-secondary">{TAB_CONFIG[tab]?.label || tab}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Notes */}
              <div className="space-y-4 pt-4 border-t border-border">
                <h4 className="text-xs uppercase tracking-wider text-text-tertiary font-semibold">Notes</h4>
                <textarea
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2.5 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary focus:border-accent-blue focus:outline-none focus:ring-2 focus:ring-accent-blue/20 resize-none transition-all"
                  placeholder="Internal notes about this user..."
                />
                <p className="text-xs text-text-muted">Only visible to admins.</p>
              </div>
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 bg-bg-secondary/95 backdrop-blur-xl border-t border-border px-6 py-4 flex items-center justify-end gap-3">
              <button
                onClick={closeEditModal}
                className="px-4 py-2.5 text-sm text-text-secondary hover:text-text-primary border border-border rounded-lg hover:bg-white/5 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await handleSaveUser(editingUserId);
                  closeEditModal();
                }}
                disabled={saving || !editForm.name}
                className="px-5 py-2.5 text-sm bg-accent-blue text-white rounded-lg hover:bg-accent-blue/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2 shadow-lg shadow-accent-blue/20"
              >
                {saving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Save Changes
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
