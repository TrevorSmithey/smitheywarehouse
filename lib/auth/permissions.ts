/**
 * Role-Based Permissions for Dashboard
 *
 * Defines roles, tabs, and access control logic.
 * Default permissions are used as fallback when DB config unavailable.
 */

/**
 * Dashboard user roles
 * - admin: Full access + admin panel (Trevor)
 * - exec: All tabs, no admin panel
 * - ops1: Operations + production + VOC + budget (no marketing/ecomm/revenue)
 * - ops2: ops1 + revenue tracker
 * - standard: Everything except production, planning, exec revenue report
 * - sales: Same as standard, starts on sales tab
 * - fulfillment: Restoration (home) + inventory only - for warehouse team
 */
export type DashboardRole = "admin" | "exec" | "ops1" | "ops2" | "standard" | "sales" | "fulfillment";

/**
 * All possible dashboard tabs
 */
export type DashboardTab =
  | "inventory"
  | "production"
  | "fulfillment"
  | "production-planning"
  | "restoration"
  | "budget"
  | "revenue-tracker"
  | "holiday"
  | "pl"
  | "voc"
  | "marketing"
  | "sales"
  | "ecommerce";

/**
 * Default role permissions (fallback when DB unavailable)
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<DashboardRole, DashboardTab[] | ["*"]> = {
  admin: ["*"],
  exec: [
    "inventory",
    "production",
    "fulfillment",
    "production-planning",
    "budget",
    "revenue-tracker",
    "holiday",
    "pl",
    "voc",
    "marketing",
    "sales",
    "ecommerce",
  ],
  ops1: ["inventory", "production", "fulfillment", "production-planning", "restoration", "voc", "budget"],
  ops2: ["inventory", "production", "fulfillment", "production-planning", "restoration", "voc", "budget", "revenue-tracker"],
  standard: ["inventory", "fulfillment", "budget", "revenue-tracker", "holiday", "voc", "marketing", "sales", "ecommerce"],
  sales: ["inventory", "fulfillment", "budget", "revenue-tracker", "holiday", "voc", "marketing", "sales", "ecommerce"],
  fulfillment: ["restoration", "inventory"],
};

/**
 * Default starting pages per role
 */
export const DEFAULT_ROLE_DEFAULTS: Record<DashboardRole, DashboardTab> = {
  admin: "inventory",
  exec: "inventory",
  ops1: "inventory",
  ops2: "inventory",
  standard: "inventory",
  sales: "sales",
  fulfillment: "restoration",
};

/**
 * Default tab order
 */
export const DEFAULT_TAB_ORDER: DashboardTab[] = [
  "inventory",
  "production",
  "restoration",
  "budget",
  "revenue-tracker",
  "holiday",
  "voc",
  "marketing",
  "sales",
  "ecommerce",
  "pl",
  "production-planning",
  "fulfillment",
];

/**
 * Tab display configuration
 */
export const TAB_CONFIG: Record<
  DashboardTab,
  { label: string; group: "operations" | "analytics" | "engagement" }
> = {
  inventory: { label: "INVENTORY", group: "operations" },
  production: { label: "PRODUCTION", group: "operations" },
  fulfillment: { label: "FULFILLMENT", group: "operations" },
  "production-planning": { label: "PLANNING", group: "operations" },
  restoration: { label: "RESTORATION", group: "operations" },
  budget: { label: "BUDGET V ACTUAL", group: "analytics" },
  "revenue-tracker": { label: "REVENUE", group: "analytics" },
  holiday: { label: "Q4 PACE", group: "analytics" },
  pl: { label: "EXEC REVENUE REPORT", group: "analytics" },
  voc: { label: "CUSTOMER SERVICE", group: "engagement" },
  marketing: { label: "MARKETING", group: "engagement" },
  sales: { label: "SALES", group: "engagement" },
  ecommerce: { label: "ECOMMERCE", group: "engagement" },
};

/**
 * Role display configuration
 */
export const ROLE_CONFIG: Record<DashboardRole, { label: string; color: string }> = {
  admin: { label: "Admin", color: "bg-purple-600 text-white" },
  exec: { label: "Executive", color: "bg-amber-600 text-white" },
  ops1: { label: "Ops 1", color: "bg-orange-600 text-white" },
  ops2: { label: "Ops 2", color: "bg-sky-600 text-white" },
  standard: { label: "Standard", color: "bg-slate-600 text-white" },
  sales: { label: "Sales", color: "bg-blue-600 text-white" },
  fulfillment: { label: "Fulfillment", color: "bg-emerald-600 text-white" },
};

/**
 * Check if role can access a specific tab
 */
export function canAccessTab(
  role: DashboardRole,
  tab: DashboardTab,
  permissions?: Record<DashboardRole, string[]>
): boolean {
  const rolePerms = permissions?.[role] ?? DEFAULT_ROLE_PERMISSIONS[role];

  // Admin with wildcard has access to everything
  if (rolePerms.includes("*")) return true;

  return rolePerms.includes(tab);
}

/**
 * Check if role can access admin panel
 */
export function canAccessAdmin(role: DashboardRole): boolean {
  return role === "admin";
}

/**
 * Get default tab for a role
 */
export function getDefaultTab(
  role: DashboardRole,
  defaults?: Record<DashboardRole, string>
): DashboardTab {
  const defaultTab = defaults?.[role] ?? DEFAULT_ROLE_DEFAULTS[role];
  return defaultTab as DashboardTab;
}

/**
 * Get all tabs a role can access (respecting order and hidden)
 */
export function getAccessibleTabs(
  role: DashboardRole,
  options?: {
    permissions?: Record<DashboardRole, string[]>;
    tabOrder?: string[];
    hiddenTabs?: string[];
  }
): DashboardTab[] {
  const { permissions, tabOrder, hiddenTabs } = options ?? {};

  const order = (tabOrder ?? DEFAULT_TAB_ORDER) as DashboardTab[];
  const hidden = new Set(hiddenTabs ?? []);
  const rolePerms = permissions?.[role] ?? DEFAULT_ROLE_PERMISSIONS[role];
  const hasWildcard = rolePerms.includes("*");

  return order.filter((tab) => {
    // Globally hidden tabs are hidden from everyone
    if (hidden.has(tab)) return false;

    // Admin wildcard sees all non-hidden tabs
    if (hasWildcard) return true;

    // Check specific permission
    return rolePerms.includes(tab);
  });
}

/**
 * All dashboard roles
 */
export const ALL_ROLES: DashboardRole[] = ["admin", "exec", "ops1", "ops2", "standard", "sales", "fulfillment"];

/**
 * All dashboard tabs
 */
export const ALL_TABS: DashboardTab[] = [
  "inventory",
  "production",
  "fulfillment",
  "production-planning",
  "restoration",
  "budget",
  "revenue-tracker",
  "holiday",
  "pl",
  "voc",
  "marketing",
  "sales",
  "ecommerce",
];
