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
 * - customer_service: Inventory, restoration, and customer service (VOC) - for CS team
 */
export type DashboardRole = "admin" | "exec" | "ops1" | "ops2" | "standard" | "sales" | "fulfillment" | "customer_service";

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
  customer_service: ["inventory", "restoration", "voc"],
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
  customer_service: "voc",
};

/**
 * Default tab order
 */
export const DEFAULT_TAB_ORDER: DashboardTab[] = [
  "inventory",
  "fulfillment",
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
  customer_service: { label: "Customer Service", color: "bg-pink-600 text-white" },
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
 * Get default tab for a role.
 * Validates the configured default and falls back to hardcoded default if invalid.
 */
export function getDefaultTab(
  role: DashboardRole,
  defaults?: Record<DashboardRole, string>
): DashboardTab {
  const configuredDefault = defaults?.[role];
  const hardcodedDefault = DEFAULT_ROLE_DEFAULTS[role];

  // If we have a configured default, validate it
  if (configuredDefault !== undefined) {
    if (ALL_TABS.includes(configuredDefault as DashboardTab)) {
      return configuredDefault as DashboardTab;
    }
    // Invalid configured default - log and fall back
    console.error(
      `[Permissions] Invalid default tab "${configuredDefault}" for role "${role}". ` +
      `Falling back to hardcoded default: "${hardcodedDefault}"`
    );
  }

  return hardcodedDefault;
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

  // Get tabs that are in the specified order
  const orderedTabs = order.filter((tab) => {
    if (hidden.has(tab)) return false;
    if (hasWildcard) return true;
    return rolePerms.includes(tab);
  });

  // Append any permitted tabs missing from the order (prevents silent hiding)
  // This ensures adding a tab to permissions always makes it visible
  const orderedSet = new Set(order);
  const missingPermittedTabs = (hasWildcard ? ALL_TABS : rolePerms)
    .filter((tab): tab is DashboardTab =>
      !orderedSet.has(tab as DashboardTab) &&
      !hidden.has(tab) &&
      ALL_TABS.includes(tab as DashboardTab)
    );

  return [...orderedTabs, ...missingPermittedTabs];
}

/**
 * All dashboard roles
 */
export const ALL_ROLES: DashboardRole[] = ["admin", "exec", "ops1", "ops2", "standard", "sales", "fulfillment", "customer_service"];

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

// ============================================================================
// TYPE GUARDS - Runtime validation with developer logging
// ============================================================================

/**
 * Type guard for validating role strings at runtime.
 * Logs invalid values for developer debugging.
 */
export function isValidRole(value: string): value is DashboardRole {
  const valid = ALL_ROLES.includes(value as DashboardRole);
  if (!valid) {
    console.error(`[Permissions] Invalid role: "${value}". Valid roles: ${ALL_ROLES.join(", ")}`);
  }
  return valid;
}

/**
 * Type guard for validating tab strings at runtime.
 * Logs invalid values for developer debugging.
 */
export function isValidTab(value: string): value is DashboardTab {
  const valid = ALL_TABS.includes(value as DashboardTab);
  if (!valid) {
    console.error(`[Permissions] Invalid tab: "${value}". Valid tabs: ${ALL_TABS.join(", ")}`);
  }
  return valid;
}
