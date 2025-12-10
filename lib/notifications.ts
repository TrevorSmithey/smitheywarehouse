/**
 * Notification utilities for sync failure alerts
 *
 * Uses Resend for email delivery.
 * Set RESEND_API_KEY in environment to enable.
 */

import { Resend } from "resend";

const ALERT_EMAIL = "trevor@smithey.com";

// Initialize Resend if API key is available
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

interface SyncFailureAlert {
  syncType: string;
  error: string;
  recordsExpected?: number;
  recordsSynced?: number;
  timestamp: string;
}

/**
 * Send an email alert when a sync fails
 * Silently fails if Resend is not configured
 */
export async function sendSyncFailureAlert(alert: SyncFailureAlert): Promise<void> {
  if (!resend) {
    console.log("[ALERT] Resend not configured, skipping email notification");
    return;
  }

  const subject = `[Smithey Ops] ${alert.syncType} Sync Failed`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; max-width: 600px;">
      <h2 style="color: #dc2626; margin-bottom: 20px;">Sync Failure Alert</h2>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Sync Type</td>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; font-weight: 600;">${alert.syncType}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Time</td>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${new Date(alert.timestamp).toLocaleString("en-US", { timeZone: "America/New_York" })} EST</td>
        </tr>
        ${alert.recordsExpected !== undefined ? `
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Records Expected</td>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${alert.recordsExpected.toLocaleString()}</td>
        </tr>
        ` : ""}
        ${alert.recordsSynced !== undefined ? `
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Records Synced</td>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${alert.recordsSynced.toLocaleString()}</td>
        </tr>
        ` : ""}
      </table>

      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <strong style="color: #dc2626;">Error:</strong>
        <pre style="margin: 8px 0 0 0; white-space: pre-wrap; font-size: 13px; color: #7f1d1d;">${alert.error}</pre>
      </div>

      <p style="color: #6b7280; font-size: 14px;">
        Dashboard data may be stale. Check
        <a href="https://smitheywarehouse.vercel.app" style="color: #2563eb;">Smithey Operations</a>
        for details.
      </p>

      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
      <p style="color: #9ca3af; font-size: 12px;">
        This is an automated alert from Smithey Operations Dashboard.
      </p>
    </div>
  `;

  try {
    const { error } = await resend.emails.send({
      from: "Smithey Ops <alerts@smithey.com>",
      to: ALERT_EMAIL,
      subject,
      html,
    });

    if (error) {
      console.error("[ALERT] Failed to send email:", error);
    } else {
      console.log(`[ALERT] Email sent to ${ALERT_EMAIL}`);
    }
  } catch (err) {
    console.error("[ALERT] Email send error:", err);
  }
}

/**
 * Send a recovery notification when sync succeeds after previous failure
 */
export async function sendSyncRecoveryAlert(syncType: string): Promise<void> {
  if (!resend) return;

  try {
    await resend.emails.send({
      from: "Smithey Ops <alerts@smithey.com>",
      to: ALERT_EMAIL,
      subject: `[Smithey Ops] ${syncType} Sync Recovered`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px;">
          <h2 style="color: #16a34a;">Sync Recovered</h2>
          <p><strong>${syncType}</strong> sync is now working normally.</p>
          <p style="color: #6b7280; font-size: 14px;">
            Time: ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })} EST
          </p>
        </div>
      `,
    });
  } catch (err) {
    // Log but don't throw - recovery alerts are non-critical
    console.error("[ALERT] Recovery email send error:", err);
  }
}
