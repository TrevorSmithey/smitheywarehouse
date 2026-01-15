"use client";

import { ReactNode, createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  RefreshCw,
  LogOut,
  X,
  Users,
  LayoutGrid,
  Settings2,
  Activity,
  Megaphone,
} from "lucide-react";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import {
  DashboardRole,
  DashboardTab,
  ALL_TABS,
} from "@/lib/auth/permissions";
import type {
  DashboardUser,
  AdminStats,
  DashboardConfig,
  SyncHealthResponse,
} from "@/lib/types";
import UserAvatar from "@/components/admin/UserAvatar";
import QuickStatsHeader from "@/components/admin/QuickStatsHeader";

// ============================================================================
// ADMIN TAB CONFIGURATION
// ============================================================================

type AdminTabId = "users" | "permissions" | "defaults" | "activity" | "sync-health" | "announcements";

const ADMIN_TABS: { id: AdminTabId; href: string; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "users", href: "/admin/users", label: "Users", icon: Users },
  { id: "permissions", href: "/admin/permissions", label: "Permissions", icon: LayoutGrid },
  { id: "defaults", href: "/admin/defaults", label: "Defaults", icon: Settings2 },
  { id: "activity", href: "/admin/activity", label: "Activity", icon: Activity },
  { id: "sync-health", href: "/admin/sync-health", label: "Sync Health", icon: RefreshCw },
  { id: "announcements", href: "/admin/announcements", label: "Announcements", icon: Megaphone },
];

// ============================================================================
// CONTEXT FOR SHARED STATE
// ============================================================================

interface AdminContextType {
  // Shared data (loaded on mount, cached)
  users: DashboardUser[];
  usersLoading: boolean;
  config: DashboardConfig | null;
  configLoading: boolean;
  configSaving: boolean;
  stats: AdminStats | null;
  statsLoading: boolean;
  syncHealth: SyncHealthResponse | null;
  syncHealthLoading: boolean;

  // Session info
  session: { userId: string; name: string } | null;

  // Actions
  refreshUsers: () => Promise<void>;
  refreshConfig: () => Promise<void>;
  refreshStats: () => Promise<void>;
  refreshSyncHealth: () => Promise<void>;
  saveConfig: (updates: Partial<DashboardConfig>) => void;

  // User CRUD
  createUser: (user: {
    name: string;
    role: DashboardRole;
    pin: string;
    email?: string;
    notes?: string;
  }) => Promise<void>;
  updateUser: (id: string, updates: Partial<DashboardUser>) => Promise<void>;
  toggleUserActive: (id: string) => Promise<void>;
  deleteUser: (id: string) => Promise<void>;
}

const AdminContext = createContext<AdminContextType | null>(null);

export function useAdmin() {
  const context = useContext(AdminContext);
  if (!context) {
    throw new Error("useAdmin must be used within AdminLayout");
  }
  return context;
}

// ============================================================================
// LAYOUT COMPONENT
// ============================================================================

export default function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, logout, isAdmin, isLoading: authLoading, refreshConfig: refreshAuthConfig } = useAuth();

  // Mounted ref for async safety
  const isMountedRef = useRef(true);

  // Session ref for accessing current session in async callbacks (avoids stale closures)
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // Users state
  const [users, setUsers] = useState<DashboardUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);

  // Config state
  const [config, setConfig] = useState<DashboardConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configSaving, setConfigSaving] = useState(false);

  // Debounce refs for config saves (prevents race conditions with rapid clicks)
  const pendingConfigUpdates = useRef<Partial<DashboardConfig>>({});
  const saveDebounceTimeout = useRef<NodeJS.Timeout | null>(null);

  // Stats state
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Sync health state
  const [syncHealth, setSyncHealth] = useState<SyncHealthResponse | null>(null);
  const [syncHealthLoading, setSyncHealthLoading] = useState(false);

  // Determine active tab from pathname
  const activeTab = ADMIN_TABS.find(tab => pathname === tab.href)?.id || "users";

  // ============================================================================
  // DATA FETCHING
  // ============================================================================

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const res = await fetch("/api/admin/users", {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to load users");
      const data = await res.json();
      if (isMountedRef.current) {
        setUsers(data.users || []);
      }
    } catch (error) {
      console.error("Failed to load users:", error);
    } finally {
      if (isMountedRef.current) {
        setUsersLoading(false);
      }
    }
  }, []);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      const res = await fetch("/api/admin/config", {
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        console.error("Failed to load config:", res.status, errorData);
        throw new Error(errorData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (isMountedRef.current) {
        setConfig({
          tab_order: data.tab_order || ALL_TABS,
          hidden_tabs: data.hidden_tabs || [],
          role_permissions: data.role_permissions || {},
          role_defaults: data.role_defaults || {},
          role_tab_orders: data.role_tab_orders || {},
        });
      }
    } catch (error) {
      console.error("Failed to load config:", error);
    } finally {
      if (isMountedRef.current) {
        setConfigLoading(false);
      }
    }
  }, []);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await fetch("/api/admin/stats", {
        headers: getAuthHeaders(),
      });
      if (res.ok && isMountedRef.current) {
        const data = await res.json();
        setStats(data);
      }
    } catch (error) {
      console.error("Failed to load stats:", error);
    } finally {
      if (isMountedRef.current) {
        setStatsLoading(false);
      }
    }
  }, []);

  const loadSyncHealth = useCallback(async () => {
    setSyncHealthLoading(true);
    try {
      const res = await fetch("/api/sync-health", {
        headers: getAuthHeaders(),
      });
      if (res.ok && isMountedRef.current) {
        const data = await res.json();
        setSyncHealth(data);
      }
    } catch (error) {
      console.error("Failed to load sync health:", error);
    } finally {
      if (isMountedRef.current) {
        setSyncHealthLoading(false);
      }
    }
  }, []);

  // Save config (debounced to prevent race conditions)
  // Rapid clicks are merged and sent as a single API call after 300ms of inactivity
  const saveConfig = useCallback((updates: Partial<DashboardConfig>) => {
    // Merge new updates with any pending updates
    pendingConfigUpdates.current = {
      ...pendingConfigUpdates.current,
      ...updates,
    };

    // Apply optimistic update to local state immediately for responsive UI
    setConfig((prev) => {
      if (!prev) return prev;
      return { ...prev, ...updates };
    });

    // Show saving indicator
    setConfigSaving(true);

    // Clear any existing timeout
    if (saveDebounceTimeout.current) {
      clearTimeout(saveDebounceTimeout.current);
    }

    // Set new debounced save
    saveDebounceTimeout.current = setTimeout(async () => {
      const updatesToSend = { ...pendingConfigUpdates.current };
      pendingConfigUpdates.current = {}; // Clear pending updates

      try {
        const payload = {
          ...updatesToSend,
          updated_by: sessionRef.current?.userId,
        };
        console.log("[Admin] Saving config payload:", JSON.stringify(payload, null, 2));
        const res = await fetch("/api/admin/config", {
          method: "PUT",
          headers: getAuthHeaders(),
          body: JSON.stringify({
            ...updatesToSend,
            // Use sessionRef.current to get the current session at execution time
            // (avoids stale closure if session changes while debounce timer is running)
            updated_by: sessionRef.current?.userId,
          }),
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          console.error("[Admin] Save config failed:", res.status);
          console.error("[Admin] Error response:", JSON.stringify(errorData, null, 2));
          if (errorData.details) {
            console.error("[Admin] Validation details:", JSON.stringify(errorData.details, null, 2));
          }
          // Reload config to restore server state on error
          await loadConfig();
          throw new Error(errorData.error || "Failed to save");
        }

        console.log("[Admin] Config saved successfully");
        // Reload to ensure we have the latest server state
        await loadConfig();
        // Sync AuthContext so main dashboard reflects changes immediately
        await refreshAuthConfig();
      } catch (error) {
        console.error("[Admin] Save config error:", error);
        // Don't throw - the optimistic update is already reverted by loadConfig
      } finally {
        if (isMountedRef.current) {
          setConfigSaving(false);
        }
      }
    }, 300); // 300ms debounce
  }, [loadConfig]); // sessionRef is a ref, doesn't need to be a dependency

  // ============================================================================
  // USER CRUD
  // ============================================================================

  const createUser = useCallback(async (user: {
    name: string;
    role: DashboardRole;
    pin: string;
    email?: string;
    notes?: string;
  }) => {
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(user),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to create user");
    }
    await loadUsers();
    await loadStats();
  }, [loadUsers, loadStats]);

  const updateUser = useCallback(async (id: string, updates: Partial<DashboardUser>) => {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: getAuthHeaders(),
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to update user");
    }
    await loadUsers();
  }, [loadUsers]);

  const toggleUserActive = useCallback(async (id: string) => {
    const user = users.find(u => u.id === id);
    if (!user) return;
    await updateUser(id, { is_active: !user.is_active });
    await loadStats();
  }, [users, updateUser, loadStats]);

  const deleteUser = useCallback(async (id: string) => {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error("Failed to delete user");
    await loadUsers();
    await loadStats();
  }, [loadUsers, loadStats]);

  // ============================================================================
  // INITIAL DATA LOAD
  // ============================================================================

  useEffect(() => {
    isMountedRef.current = true;

    if (isAdmin) {
      loadUsers();
      loadConfig();
      loadStats();
      loadSyncHealth();
    }

    return () => {
      isMountedRef.current = false;
      // Clean up debounce timeout on unmount
      if (saveDebounceTimeout.current) {
        clearTimeout(saveDebounceTimeout.current);
      }
    };
  }, [isAdmin, loadUsers, loadConfig, loadStats, loadSyncHealth]);

  // ============================================================================
  // AUTH GUARDS
  // ============================================================================

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

  // ============================================================================
  // CONTEXT VALUE
  // ============================================================================

  const contextValue: AdminContextType = {
    users,
    usersLoading,
    config,
    configLoading,
    configSaving,
    stats,
    statsLoading,
    syncHealth,
    syncHealthLoading,
    session: session ? { userId: session.userId, name: session.name || "Admin" } : null,
    refreshUsers: loadUsers,
    refreshConfig: loadConfig,
    refreshStats: loadStats,
    refreshSyncHealth: loadSyncHealth,
    saveConfig,
    createUser,
    updateUser,
    toggleUserActive,
    deleteUser,
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <AdminContext.Provider value={contextValue}>
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
                  <Link
                    key={tab.id}
                    href={tab.href}
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
                  </Link>
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
              syncHealthy={syncHealth?.status === "healthy"}
              syncIssues={syncHealth ? (
                syncHealth.syncs.filter(s => s.status === "failed" || s.isStale || s.status === "partial").length
              ) : 0}
              onStatClick={(stat) => {
                if (stat === "users") router.push("/admin/users");
                if (stat === "tabs") router.push("/admin/permissions");
                if (stat === "activity") router.push("/admin/activity");
                if (stat === "health") router.push("/admin/sync-health");
              }}
            />
          )}

          {children}
        </main>
      </div>
    </AdminContext.Provider>
  );
}
