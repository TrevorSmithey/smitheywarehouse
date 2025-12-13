/**
 * Cron Authentication Utility
 *
 * Provides consistent authentication for all cron endpoints.
 * Always verifies the CRON_SECRET - no production-only exceptions.
 */

/**
 * Verify the cron secret from the Authorization header
 * Returns true if the request is authenticated, false otherwise
 *
 * @param request - The incoming request
 * @returns true if authenticated, false if not
 */
export function verifyCronSecret(request: Request): boolean {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("[CRON AUTH] CRON_SECRET not configured - rejecting request");
    return false;
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn("[CRON AUTH] Invalid or missing authorization header");
    return false;
  }

  return true;
}

/**
 * Create a 401 Unauthorized response for failed cron auth
 */
export function unauthorizedResponse(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
