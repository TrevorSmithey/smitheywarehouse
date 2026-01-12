"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useCallback,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  AuthSession,
  getAuthSession,
  setAuthSession,
  clearAuthSession,
  isImpersonating as checkIsImpersonating,
  getOriginalSession,
  startImpersonation as startImpersonationSession,
  stopImpersonation as stopImpersonationSession,
  getAuthHeaders,
} from "./session";
import {
  DashboardRole,
  DashboardTab,
  canAccessTab,
  canAccessAdmin,
  getDefaultTab,
  getAccessibleTabs,
  DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_TAB_ORDER,
  DEFAULT_ROLE_DEFAULTS,
} from "./permissions";

/**
 * Dashboard configuration from database
 */
interface DashboardConfig {
  tabOrder: DashboardTab[];
  hiddenTabs: DashboardTab[];
  rolePermissions: Record<DashboardRole, string[]>;
  roleDefaults: Record<DashboardRole, string>;
  roleTabOrders: Record<DashboardRole, DashboardTab[]>;
}

interface AuthContextType {
  session: AuthSession | null;
  isLoading: boolean;
  config: DashboardConfig | null;
  login: (user: { id: string; name: string; role: DashboardRole }) => void;
  logout: () => void;
  canAccess: (tab: DashboardTab) => boolean;
  isAdmin: boolean;
  accessibleTabs: DashboardTab[];
  defaultTab: DashboardTab | null;
  refreshConfig: () => Promise<void>;
  // User tab ordering
  userTabOrder: DashboardTab[] | null;
  updateUserTabOrder: (order: DashboardTab[] | null) => Promise<void>;
  // Impersonation
  isImpersonating: boolean;
  originalSession: AuthSession | null;
  startImpersonation: (user: {
    id: string;
    name: string;
    role: DashboardRole;
  }) => void;
  stopImpersonation: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Public routes that don't require auth
const PUBLIC_ROUTES = ["/login"];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [config, setConfig] = useState<DashboardConfig | null>(null);
  const [userTabOrder, setUserTabOrder] = useState<DashboardTab[] | null>(null);
  const [isImpersonatingState, setIsImpersonatingState] = useState(false);
  const [originalSession, setOriginalSession] = useState<AuthSession | null>(
    null
  );
  const router = useRouter();
  const pathname = usePathname();

  // Fetch dashboard config from API
  // Accepts optional AbortSignal for cleanup on unmount/logout
  const fetchConfig = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/admin/config", { signal });
      if (res.ok) {
        const data = await res.json();
        setConfig({
          tabOrder: data.tab_order || DEFAULT_TAB_ORDER,
          hiddenTabs: data.hidden_tabs || [],
          rolePermissions: data.role_permissions || DEFAULT_ROLE_PERMISSIONS,
          roleDefaults: data.role_defaults || DEFAULT_ROLE_DEFAULTS,
          roleTabOrders: data.role_tab_orders || ({} as Record<DashboardRole, DashboardTab[]>),
        });
      }
    } catch (error) {
      // Ignore abort errors (expected on cleanup)
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      console.error("Failed to fetch dashboard config:", error);
      // Use defaults on error
      setConfig({
        tabOrder: DEFAULT_TAB_ORDER as DashboardTab[],
        hiddenTabs: [],
        rolePermissions: DEFAULT_ROLE_PERMISSIONS as Record<DashboardRole, string[]>,
        roleDefaults: DEFAULT_ROLE_DEFAULTS as Record<DashboardRole, string>,
        roleTabOrders: {} as Record<DashboardRole, DashboardTab[]>,
      });
    }
  }, []);

  // Fetch user preferences (including custom tab order)
  // Only called when user is authenticated
  const fetchUserPreferences = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/auth/preferences", {
        headers: getAuthHeaders(),
        signal,
      });
      if (res.ok) {
        const data = await res.json();
        setUserTabOrder(data.user_tab_order || null);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      console.error("Failed to fetch user preferences:", error);
    }
  }, []);

  // Update user's custom tab order
  const updateUserTabOrder = useCallback(async (order: DashboardTab[] | null) => {
    try {
      const res = await fetch("/api/auth/preferences", {
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify({ user_tab_order: order }),
      });
      if (res.ok) {
        setUserTabOrder(order);
      } else {
        const error = await res.json();
        console.error("Failed to update tab order:", error);
        throw new Error(error.error || "Failed to update tab order");
      }
    } catch (error) {
      console.error("Error updating user tab order:", error);
      throw error;
    }
  }, []);

  // Check for existing session on mount
  useEffect(() => {
    const abortController = new AbortController();

    const existingSession = getAuthSession();
    setSession(existingSession);

    // Check impersonation state
    setIsImpersonatingState(checkIsImpersonating());
    setOriginalSession(getOriginalSession());

    // Fetch config regardless of auth state (for login redirect)
    // Also fetch user preferences if authenticated
    const fetchAll = async () => {
      await fetchConfig(abortController.signal);
      if (existingSession) {
        await fetchUserPreferences(abortController.signal);
      }
    };

    fetchAll().finally(() => {
      // Only update loading state if not aborted
      if (!abortController.signal.aborted) {
        setIsLoading(false);
      }
    });

    // Cleanup: abort any in-flight requests on unmount
    return () => {
      abortController.abort();
    };
  }, [fetchConfig, fetchUserPreferences]);

  // Redirect logic based on auth state
  useEffect(() => {
    if (isLoading) return;

    const isPublicRoute = PUBLIC_ROUTES.some((route) => pathname === route);
    const isAdminRoute = pathname.startsWith("/admin");

    if (!session && !isPublicRoute) {
      // Not authenticated and not on public route - redirect to login
      router.push("/login");
    } else if (session && pathname === "/login") {
      // Authenticated on login page - redirect to default tab
      const defaultPath = getDefaultTab(
        session.role,
        config?.roleDefaults as Record<DashboardRole, string>
      );
      router.push(`/${defaultPath}`);
    } else if (session && isAdminRoute && !canAccessAdmin(session.role)) {
      // Non-admin trying to access admin page
      const defaultPath = getDefaultTab(
        session.role,
        config?.roleDefaults as Record<DashboardRole, string>
      );
      router.push(`/${defaultPath}`);
    }
  }, [session, isLoading, pathname, router, config]);

  const login = useCallback(
    (user: { id: string; name: string; role: DashboardRole }) => {
      const newSession = setAuthSession(user);
      setSession(newSession);

      // Fetch user preferences (tab order, etc.) after login
      fetchUserPreferences().catch((err) => {
        console.error("Failed to fetch user preferences after login:", err);
      });

      // Redirect to role's default tab
      const defaultPath = getDefaultTab(
        user.role,
        config?.roleDefaults as Record<DashboardRole, string>
      );
      router.push(`/${defaultPath}`);
    },
    [router, config, fetchUserPreferences]
  );

  const logout = useCallback(() => {
    // If impersonating, also clear that
    if (checkIsImpersonating()) {
      stopImpersonationSession();
    }
    clearAuthSession();
    setSession(null);
    setUserTabOrder(null);
    setIsImpersonatingState(false);
    setOriginalSession(null);
    router.push("/login");
  }, [router]);

  const startImpersonation = useCallback(
    (user: { id: string; name: string; role: DashboardRole }) => {
      const newSession = startImpersonationSession(user);
      setSession(newSession);
      setIsImpersonatingState(true);
      setOriginalSession(getOriginalSession());

      // Redirect to impersonated user's default tab
      const defaultPath = getDefaultTab(
        user.role,
        config?.roleDefaults as Record<DashboardRole, string>
      );
      router.push(`/${defaultPath}`);
    },
    [router, config]
  );

  const stopImpersonation = useCallback(() => {
    const restoredSession = stopImpersonationSession();
    if (restoredSession) {
      setSession(restoredSession);
      setIsImpersonatingState(false);
      setOriginalSession(null);

      // Go back to admin panel
      router.push("/admin");
    }
  }, [router]);

  const canAccess = useCallback(
    (tab: DashboardTab) => {
      if (!session) return false;

      // Check if globally hidden
      if (config?.hiddenTabs?.includes(tab)) return false;

      return canAccessTab(
        session.role,
        tab,
        config?.rolePermissions as Record<DashboardRole, string[]>
      );
    },
    [session, config]
  );

  const refreshConfig = useCallback(async () => {
    await fetchConfig();
  }, [fetchConfig]);

  const isAdmin = session ? canAccessAdmin(session.role) : false;

  // Tab order priority: user-specific → role-specific → global
  const effectiveTabOrder = userTabOrder  // User's custom order (highest priority)
    || (session && config?.roleTabOrders?.[session.role] ? config.roleTabOrders[session.role] : null)  // Role-specific order
    || config?.tabOrder;  // Global default order

  const accessibleTabs = session
    ? getAccessibleTabs(session.role, {
        permissions: config?.rolePermissions as Record<DashboardRole, string[]>,
        tabOrder: effectiveTabOrder,
        hiddenTabs: config?.hiddenTabs,
      })
    : [];

  const defaultTab = session
    ? getDefaultTab(
        session.role,
        config?.roleDefaults as Record<DashboardRole, string>
      )
    : null;

  return (
    <AuthContext.Provider
      value={{
        session,
        isLoading,
        config,
        login,
        logout,
        canAccess,
        isAdmin,
        accessibleTabs,
        defaultTab,
        refreshConfig,
        // User tab ordering
        userTabOrder,
        updateUserTabOrder,
        // Impersonation
        isImpersonating: isImpersonatingState,
        originalSession,
        startImpersonation,
        stopImpersonation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
