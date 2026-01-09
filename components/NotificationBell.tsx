"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Bell, RotateCcw, AlertTriangle, AlertCircle, Info, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  useAnnouncements,
  formatTimeAgo,
  type DismissedAnnouncement,
} from "@/lib/announcements";

/**
 * NotificationBell
 *
 * Silent archive for dismissed announcements.
 * No badge - just a subtle icon to access history if needed.
 *
 * Accessibility:
 *   - Proper ARIA attributes (expanded, haspopup, controls)
 *   - Keyboard navigation (Escape to close, Tab trapping)
 *   - Focus management (returns to bell on close)
 */
export function NotificationBell() {
  const { session } = useAuth();
  const { dismissed, isLoading, error, restore } = useAnnouncements();

  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownId = "notification-dropdown";

  /**
   * Close dropdown and return focus to bell button
   */
  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    // Return focus to trigger button
    requestAnimationFrame(() => buttonRef.current?.focus());
  }, []);

  /**
   * Handle click outside to close
   */
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        closeDropdown();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, closeDropdown]);

  /**
   * Handle keyboard navigation
   */
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      switch (event.key) {
        case "Escape":
          event.preventDefault();
          closeDropdown();
          break;

        case "Tab":
          // Trap focus within dropdown
          if (dropdownRef.current) {
            const focusable = dropdownRef.current.querySelectorAll<HTMLElement>(
              'button, [href], [tabindex]:not([tabindex="-1"])'
            );
            const first = focusable[0];
            const last = focusable[focusable.length - 1];

            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
          break;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, closeDropdown]);

  /**
   * Focus first interactive element when dropdown opens
   */
  useEffect(() => {
    if (isOpen && dropdownRef.current) {
      const firstButton = dropdownRef.current.querySelector<HTMLElement>("button");
      requestAnimationFrame(() => firstButton?.focus());
    }
  }, [isOpen]);

  // Don't render if not logged in
  if (!session) return null;

  const count = dismissed.length;

  return (
    <div className="relative" ref={containerRef}>
      {/* Bell Button - silent archive, no badge */}
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className={`
          p-1.5 rounded-md transition-colors
          focus:outline-none focus:ring-2 focus:ring-accent-blue/50
          ${isOpen ? "bg-white/10 text-text-secondary" : "hover:bg-white/5 text-text-tertiary"}
        `}
        aria-label="Dismissed announcements"
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-controls={dropdownId}
      >
        <Bell className="w-4 h-4" aria-hidden="true" />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          ref={dropdownRef}
          id={dropdownId}
          className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] bg-bg-secondary border border-border rounded-lg shadow-xl z-50 overflow-hidden"
          role="dialog"
          aria-label="Dismissed announcements"
          aria-modal="true"
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
              Dismissed
            </h2>
            <button
              onClick={closeDropdown}
              className="p-1 hover:bg-white/10 rounded transition-colors text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-blue/50"
              aria-label="Close"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          {/* Error feedback */}
          {error && (
            <div
              className="px-4 py-2 bg-status-bad/15 text-status-bad text-xs flex items-center gap-2"
              role="alert"
            >
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {/* Content */}
          <div className="max-h-80 overflow-y-auto scrollbar-thin">
            {count === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-text-tertiary text-sm">All caught up</p>
                <p className="text-text-tertiary/60 text-xs mt-1">
                  No dismissed announcements
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border/50" role="list">
                {dismissed.map((announcement) => (
                  <DismissedItem
                    key={announcement.id}
                    announcement={announcement}
                    onRestore={() => restore(announcement.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Severity configuration
 */
const SEVERITY_CONFIG = {
  info: { text: "text-accent-blue", icon: Info },
  warning: { text: "text-status-warning", icon: AlertTriangle },
  critical: { text: "text-status-bad", icon: AlertCircle },
} as const;

/**
 * Single dismissed announcement item
 */
function DismissedItem({
  announcement,
  onRestore,
}: {
  announcement: DismissedAnnouncement;
  onRestore: () => void;
}) {
  const config = SEVERITY_CONFIG[announcement.severity] || SEVERITY_CONFIG.info;
  const Icon = config.icon;

  return (
    <li className="px-4 py-3 transition-colors hover:bg-white/5">
      <div className="flex items-start gap-3">
        <Icon
          className={`w-4 h-4 mt-0.5 flex-shrink-0 ${config.text}`}
          aria-hidden="true"
        />

        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${config.text}`}>
            {announcement.title}
          </p>
          {announcement.message && (
            <p className="text-xs text-text-tertiary mt-0.5 line-clamp-2">
              {announcement.message}
            </p>
          )}
          <p className="text-[10px] text-text-tertiary/70 mt-1">
            Dismissed {formatTimeAgo(announcement.dismissed_at)}
          </p>
        </div>

        <button
          onClick={onRestore}
          className="p-1.5 rounded transition-colors text-text-tertiary hover:bg-white/10 hover:text-accent-blue focus:outline-none focus:ring-2 focus:ring-accent-blue/50"
          aria-label={`Restore: ${announcement.title}`}
          title="Restore"
        >
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}
