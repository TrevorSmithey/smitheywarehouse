"use client";

import { useAuth } from "@/lib/auth";
import { AlertTriangle, X } from "lucide-react";
import { ROLE_CONFIG } from "@/lib/auth/permissions";

/**
 * ImpersonationBanner
 *
 * Fixed banner shown at the top of the screen when admin is impersonating another user.
 * Shows who you're logged in as and provides an "Exit" button to return to admin.
 */
export default function ImpersonationBanner() {
  const { session, isImpersonating, originalSession, stopImpersonation } =
    useAuth();

  if (!isImpersonating || !session || !originalSession) {
    return null;
  }

  const roleConfig = ROLE_CONFIG[session.role];

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-accent-purple text-white">
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-4 h-4" />
          <span className="text-sm font-medium">
            Viewing as{" "}
            <span className="font-semibold">{session.name}</span>
            <span className="mx-1.5 opacity-60">·</span>
            <span
              className="px-1.5 py-0.5 rounded text-xs font-medium"
              style={{ backgroundColor: `${roleConfig.color}40` }}
            >
              {roleConfig.label}
            </span>
          </span>
        </div>

        <button
          onClick={stopImpersonation}
          className="flex items-center gap-1.5 px-3 py-1 bg-white/20 hover:bg-white/30 rounded-md text-sm font-medium transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          Exit to Admin
        </button>
      </div>
    </div>
  );
}
