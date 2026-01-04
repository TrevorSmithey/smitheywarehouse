/**
 * Server-Side Authentication Helpers
 *
 * Provides server-side verification of auth sessions.
 * Used to protect API routes from unauthorized access.
 *
 * NOTE: Since sessions are stored in localStorage (client-side),
 * we verify by checking the user exists in the database and is active.
 * The client sends userId in the request body or Authorization header.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import type { DashboardRole } from "./permissions";

export interface ServerSession {
  userId: string;
  name: string;
  role: DashboardRole;
}

/**
 * Extract and verify session from request
 *
 * Expects Authorization header with base64-encoded session JSON:
 * Authorization: Bearer <base64({userId, role})>
 *
 * Returns null if not authenticated or session invalid.
 */
export async function getServerSession(
  request: NextRequest
): Promise<ServerSession | null> {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return null;
    }

    const token = authHeader.slice(7); // Remove "Bearer "
    const decoded = Buffer.from(token, "base64").toString("utf-8");
    const { userId, role } = JSON.parse(decoded);

    if (!userId || !role) {
      return null;
    }

    // Verify user exists in database and is active
    const supabase = createServiceClient();
    const { data: user, error } = await supabase
      .from("dashboard_users")
      .select("id, name, role, is_active")
      .eq("id", userId)
      .single();

    if (error || !user || !user.is_active) {
      return null;
    }

    // CRITICAL: Use role from database, not from client
    // This prevents client-side role manipulation
    return {
      userId: user.id,
      name: user.name,
      role: user.role as DashboardRole,
    };
  } catch {
    return null;
  }
}

/**
 * Check if session has admin privileges
 */
export function isAdmin(session: ServerSession | null): boolean {
  return session?.role === "admin";
}

/**
 * Create unauthorized response
 */
export function unauthorizedResponse(message = "Unauthorized"): NextResponse {
  return NextResponse.json({ error: message }, { status: 401 });
}

/**
 * Create forbidden response
 */
export function forbiddenResponse(message = "Forbidden"): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 });
}

/**
 * Require admin access - returns error response or null if authorized
 */
export async function requireAdmin(
  request: NextRequest
): Promise<{ session: ServerSession; error: null } | { session: null; error: NextResponse }> {
  const session = await getServerSession(request);

  if (!session) {
    return { session: null, error: unauthorizedResponse() };
  }

  if (!isAdmin(session)) {
    return { session: null, error: forbiddenResponse("Admin access required") };
  }

  return { session, error: null };
}
