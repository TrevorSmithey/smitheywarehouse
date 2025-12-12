import { NextResponse } from "next/server";
import { sendSyncFailureAlert } from "@/lib/notifications";

export const dynamic = "force-dynamic";

/**
 * Test endpoint to verify email alerts are working
 * GET /api/test-alert
 *
 * Requires CRON_SECRET for authentication
 * Only works when RESEND_API_KEY is configured
 */
export async function GET(request: Request) {
  // Require authentication
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hasResendKey = !!process.env.RESEND_API_KEY;

  if (!hasResendKey) {
    return NextResponse.json({
      success: false,
      error: "RESEND_API_KEY not configured",
      instructions: [
        "1. Go to https://resend.com and create an account",
        "2. Create an API key at https://resend.com/api-keys",
        "3. Add RESEND_API_KEY to your Vercel environment variables",
        "4. Redeploy or run locally with the key in .env.local",
      ],
    }, { status: 400 });
  }

  // Send test alert
  await sendSyncFailureAlert({
    syncType: "Test Alert",
    error: "This is a test alert to verify email delivery is working. If you received this email, your alert system is configured correctly!",
    timestamp: new Date().toISOString(),
  });

  return NextResponse.json({
    success: true,
    message: "Test alert sent! Check your email at trevor@smithey.com",
    sentAt: new Date().toISOString(),
  });
}
