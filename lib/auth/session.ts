/**
 * Session Management for Dashboard Auth
 *
 * Handles localStorage-based sessions with 30-day expiration.
 * No server-side sessions - purely client-side for simplicity.
 */

import { type DashboardRole, isValidRole } from "./permissions";

/**
 * Auth session stored in localStorage
 */
export interface AuthSession {
  userId: string;
  name: string;
  role: DashboardRole;
  authenticatedAt: number; // Unix timestamp (ms)
  expiresAt: number; // Unix timestamp (ms)
}

const AUTH_STORAGE_KEY = "smithey_warehouse_auth";
const IMPERSONATION_STORAGE_KEY = "smithey_warehouse_impersonating";
const AUTH_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Get current auth session from localStorage
 * Returns null if not authenticated, session expired, or session is invalid
 */
export function getAuthSession(): AuthSession | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!stored) return null;

    const parsed = JSON.parse(stored);

    // Validate session structure - must have all required fields
    if (
      typeof parsed.userId !== "string" ||
      typeof parsed.name !== "string" ||
      typeof parsed.role !== "string" ||
      typeof parsed.authenticatedAt !== "number" ||
      typeof parsed.expiresAt !== "number"
    ) {
      console.error("[Session] Invalid session structure - missing required fields:", {
        hasUserId: typeof parsed.userId === "string",
        hasName: typeof parsed.name === "string",
        hasRole: typeof parsed.role === "string",
        hasAuthenticatedAt: typeof parsed.authenticatedAt === "number",
        hasExpiresAt: typeof parsed.expiresAt === "number",
      });
      clearAuthSession();
      return null;
    }

    // Validate role is a valid DashboardRole (uses type guard with logging)
    if (!isValidRole(parsed.role)) {
      console.error(`[Session] Token contains invalid role: "${parsed.role}". Clearing session.`);
      clearAuthSession();
      return null;
    }

    const session = parsed as AuthSession;

    // Check expiration
    if (Date.now() > session.expiresAt) {
      console.error("[Session] Session expired. Clearing.");
      clearAuthSession();
      return null;
    }

    return session;
  } catch (error) {
    console.error("[Session] Failed to parse auth session from localStorage:", error);
    clearAuthSession();
    return null;
  }
}

/**
 * Create and store a new auth session
 */
export function setAuthSession(user: {
  id: string;
  name: string;
  role: DashboardRole;
}): AuthSession {
  const now = Date.now();
  const session: AuthSession = {
    userId: user.id,
    name: user.name,
    role: user.role,
    authenticatedAt: now,
    expiresAt: now + AUTH_DURATION_MS,
  };

  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  return session;
}

/**
 * Clear auth session (logout)
 */
export function clearAuthSession(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  return getAuthSession() !== null;
}

/**
 * Get days remaining until session expires
 */
export function getDaysRemaining(): number | null {
  const session = getAuthSession();
  if (!session) return null;

  const msRemaining = session.expiresAt - Date.now();
  return Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
}

/**
 * Create Authorization header value for API calls
 * Server uses this to verify admin access
 */
export function getAuthHeader(): string | null {
  const session = getAuthSession();
  if (!session) return null;

  // Encode userId and role for server verification
  const payload = JSON.stringify({
    userId: session.userId,
    role: session.role,
  });
  // Use btoa() for browser compatibility (Buffer.from not available in browser)
  return `Bearer ${btoa(payload)}`;
}

/**
 * Get headers object with Authorization for fetch calls
 */
export function getAuthHeaders(): HeadersInit {
  const authHeader = getAuthHeader();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };
  if (authHeader) {
    headers["Authorization"] = authHeader;
  }
  return headers;
}

// ============================================
// IMPERSONATION FUNCTIONS
// ============================================

/**
 * Check if currently impersonating another user
 */
export function isImpersonating(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(IMPERSONATION_STORAGE_KEY) !== null;
}

/**
 * Get the original admin session (only exists when impersonating)
 */
export function getOriginalSession(): AuthSession | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = localStorage.getItem(IMPERSONATION_STORAGE_KEY);
    if (!stored) return null;

    const session = JSON.parse(stored) as AuthSession;

    // Validate expiration of original session
    if (Date.now() > session.expiresAt) {
      stopImpersonation();
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

/**
 * Start impersonating another user
 * Saves current admin session and creates new session for impersonated user
 * SECURITY: Only admin users can start impersonation
 */
export function startImpersonation(targetUser: {
  id: string;
  name: string;
  role: DashboardRole;
}): AuthSession | null {
  // CRITICAL: Verify current user is admin before allowing impersonation
  const currentSession = getAuthSession();
  if (!currentSession || currentSession.role !== "admin") {
    console.error("Impersonation requires admin role");
    return null;
  }

  // Save current admin session
  localStorage.setItem(
    IMPERSONATION_STORAGE_KEY,
    JSON.stringify(currentSession)
  );

  // Create session for impersonated user
  return setAuthSession(targetUser);
}

/**
 * Stop impersonating and restore admin session
 */
export function stopImpersonation(): AuthSession | null {
  const originalSession = getOriginalSession();

  // Clear impersonation marker
  localStorage.removeItem(IMPERSONATION_STORAGE_KEY);

  if (originalSession) {
    // Restore original admin session
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(originalSession));
    return originalSession;
  }

  return null;
}
