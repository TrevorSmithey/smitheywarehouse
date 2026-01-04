/**
 * Auth Module Exports
 */

export { AuthProvider, useAuth } from "./AuthContext";
export {
  getAuthSession,
  setAuthSession,
  clearAuthSession,
  isAuthenticated,
  getDaysRemaining,
  getAuthHeader,
  getAuthHeaders,
  type AuthSession,
} from "./session";
export {
  canAccessTab,
  canAccessAdmin,
  getDefaultTab,
  getAccessibleTabs,
  DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_TAB_ORDER,
  DEFAULT_ROLE_DEFAULTS,
  TAB_CONFIG,
  ROLE_CONFIG,
  ALL_ROLES,
  ALL_TABS,
  type DashboardRole,
  type DashboardTab,
} from "./permissions";
