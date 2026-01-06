"use client";

import { X, AlertTriangle, AlertCircle, Info } from "lucide-react";
import { useAnnouncements, type Announcement } from "@/lib/announcements";

/**
 * AnnouncementBanner
 *
 * Full-width system banner at the top of the dashboard.
 * Displays active announcements with dismiss capability.
 *
 * Design:
 *   - Edge-to-edge, no rounded corners (matches ImpersonationBanner)
 *   - Severity-based colors: info (blue), warning (amber), critical (red)
 *   - Stacks multiple announcements vertically
 *   - Instant dismiss with optimistic UI
 */
export function AnnouncementBanner() {
  const { active, isLoading, dismiss } = useAnnouncements();

  // Don't render anything until first load completes
  // Prevents layout shift from empty -> populated
  if (isLoading || active.length === 0) {
    return null;
  }

  return (
    <div
      className="-mx-4 sm:-mx-6 -mt-4 sm:-mt-6 mb-6"
      role="region"
      aria-label="System announcements"
    >
      {active.map((announcement) => (
        <AnnouncementItem
          key={announcement.id}
          announcement={announcement}
          onDismiss={() => dismiss(announcement.id)}
        />
      ))}
    </div>
  );
}

/**
 * Severity configuration
 */
const SEVERITY_CONFIG = {
  info: {
    bg: "bg-accent-blue/15",
    text: "text-accent-blue",
    icon: Info,
    label: "Information",
  },
  warning: {
    bg: "bg-status-warning/15",
    text: "text-status-warning",
    icon: AlertTriangle,
    label: "Warning",
  },
  critical: {
    bg: "bg-status-bad/15",
    text: "text-status-bad",
    icon: AlertCircle,
    label: "Critical",
  },
} as const;

/**
 * Single announcement item
 */
function AnnouncementItem({
  announcement,
  onDismiss,
}: {
  announcement: Announcement;
  onDismiss: () => void;
}) {
  const config = SEVERITY_CONFIG[announcement.severity] || SEVERITY_CONFIG.info;
  const Icon = config.icon;

  return (
    <div
      className={`${config.bg} transition-opacity duration-200`}
      role="alert"
      aria-live={announcement.severity === "critical" ? "assertive" : "polite"}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex items-center gap-3">
        <Icon
          className={`w-4 h-4 ${config.text} flex-shrink-0`}
          aria-hidden="true"
        />

        <div className="flex-1 min-w-0">
          <span className="sr-only">{config.label}: </span>
          <span className={`font-medium text-sm ${config.text}`}>
            {announcement.title}
          </span>
          {announcement.message && (
            <span className="text-sm text-text-secondary ml-2">
              — {announcement.message}
            </span>
          )}
        </div>

        <button
          onClick={onDismiss}
          className={`
            p-1 rounded transition-colors
            hover:bg-white/10 focus:bg-white/10
            focus:outline-none focus:ring-2 focus:ring-white/30
            ${config.text}
          `}
          aria-label={`Dismiss: ${announcement.title}`}
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
