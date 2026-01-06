"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from "react";
import { useAuth } from "@/lib/auth";
import { getAuthHeaders } from "@/lib/auth/session";

/**
 * Announcement Types
 */
export interface Announcement {
  id: string;
  title: string;
  message: string | null;
  severity: "info" | "warning" | "critical";
  created_at: string;
  expires_at: string | null;
}

export interface DismissedAnnouncement extends Announcement {
  dismissed_at: string;
}

/**
 * Context State & Actions
 */
interface AnnouncementContextType {
  // State
  active: Announcement[];
  dismissed: DismissedAnnouncement[];
  isLoading: boolean;
  error: string | null;

  // Actions
  dismiss: (id: string) => Promise<void>;
  restore: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const AnnouncementContext = createContext<AnnouncementContextType | null>(null);

/**
 * useAnnouncements Hook
 *
 * Access announcement state and actions from any component.
 * Must be used within AnnouncementProvider.
 */
export function useAnnouncements() {
  const ctx = useContext(AnnouncementContext);
  if (!ctx) {
    throw new Error("useAnnouncements must be used within AnnouncementProvider");
  }
  return ctx;
}

/**
 * AnnouncementProvider
 *
 * Single source of truth for all announcement state.
 * Handles fetching, polling, dismiss/restore operations.
 *
 * Architecture:
 *   - One fetch for active announcements
 *   - One fetch for dismissed announcements
 *   - Optimistic updates for instant UI feedback
 *   - Automatic rollback on API failure
 *   - Single polling interval for both
 */
export function AnnouncementProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();

  // Core state
  const [active, setActive] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<DismissedAnnouncement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Track in-flight operations to prevent duplicates
  const pendingOps = useRef<Set<string>>(new Set());

  /**
   * Fetch all announcements (active + dismissed)
   */
  const fetchAll = useCallback(async () => {
    try {
      const headers = getAuthHeaders();

      const [activeRes, dismissedRes] = await Promise.all([
        fetch("/api/announcements", { headers }),
        session ? fetch("/api/announcements/dismissed", { headers }) : Promise.resolve(null),
      ]);

      if (activeRes.ok) {
        const data = await activeRes.json();
        setActive(data.announcements || []);
      }

      if (dismissedRes?.ok) {
        const data = await dismissedRes.json();
        setDismissed(data.dismissed || []);
      }

      setError(null);
    } catch (err) {
      console.error("Failed to fetch announcements:", err);
      // Don't set error on network issues - announcements are non-critical
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  /**
   * Initial fetch + polling
   *
   * - 500ms delay on initial to not block page render
   * - 3 minute polling interval (balanced between freshness and server load)
   */
  useEffect(() => {
    const initialTimer = setTimeout(fetchAll, 500);
    const pollInterval = setInterval(fetchAll, 3 * 60 * 1000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(pollInterval);
    };
  }, [fetchAll]);

  /**
   * Dismiss an announcement
   *
   * Optimistic update: immediately move from active to dismissed,
   * rollback if API call fails.
   */
  const dismiss = useCallback(
    async (id: string) => {
      if (!session) return;
      if (pendingOps.current.has(id)) return; // Prevent duplicate calls

      pendingOps.current.add(id);

      // Find the announcement to move
      const announcement = active.find((a) => a.id === id);
      if (!announcement) {
        pendingOps.current.delete(id);
        return;
      }

      // Optimistic update
      const dismissedAt = new Date().toISOString();
      setActive((prev) => prev.filter((a) => a.id !== id));
      setDismissed((prev) => [
        { ...announcement, dismissed_at: dismissedAt },
        ...prev,
      ]);

      try {
        const res = await fetch(`/api/announcements/${id}/dismiss`, {
          method: "POST",
          headers: getAuthHeaders(),
        });

        if (!res.ok) {
          throw new Error("Failed to dismiss");
        }
      } catch (err) {
        // Rollback on failure
        console.error("Failed to dismiss announcement:", err);
        setActive((prev) => [...prev, announcement].sort(sortBySeverity));
        setDismissed((prev) => prev.filter((a) => a.id !== id));
        setError("Failed to dismiss announcement. Please try again.");

        // Clear error after 3 seconds
        setTimeout(() => setError(null), 3000);
      } finally {
        pendingOps.current.delete(id);
      }
    },
    [session, active]
  );

  /**
   * Restore a dismissed announcement
   *
   * Optimistic update: immediately move from dismissed to active,
   * rollback if API call fails.
   */
  const restore = useCallback(
    async (id: string) => {
      if (!session) return;
      if (pendingOps.current.has(id)) return; // Prevent duplicate calls

      pendingOps.current.add(id);

      // Find the dismissed announcement
      const announcement = dismissed.find((a) => a.id === id);
      if (!announcement) {
        pendingOps.current.delete(id);
        return;
      }

      // Extract base announcement (without dismissed_at)
      const { dismissed_at, ...baseAnnouncement } = announcement;

      // Optimistic update
      setDismissed((prev) => prev.filter((a) => a.id !== id));
      setActive((prev) => [...prev, baseAnnouncement].sort(sortBySeverity));

      try {
        const res = await fetch(`/api/announcements/${id}/dismiss`, {
          method: "DELETE",
          headers: getAuthHeaders(),
        });

        if (!res.ok) {
          throw new Error("Failed to restore");
        }
      } catch (err) {
        // Rollback on failure
        console.error("Failed to restore announcement:", err);
        setDismissed((prev) =>
          [announcement, ...prev].sort(
            (a, b) => new Date(b.dismissed_at).getTime() - new Date(a.dismissed_at).getTime()
          )
        );
        setActive((prev) => prev.filter((a) => a.id !== id));
        setError("Failed to restore announcement. Please try again.");

        // Clear error after 3 seconds
        setTimeout(() => setError(null), 3000);
      } finally {
        pendingOps.current.delete(id);
      }
    },
    [session, dismissed]
  );

  /**
   * Manual refresh (for admin actions, etc.)
   */
  const refresh = useCallback(async () => {
    setIsLoading(true);
    await fetchAll();
  }, [fetchAll]);

  return (
    <AnnouncementContext.Provider
      value={{
        active,
        dismissed,
        isLoading,
        error,
        dismiss,
        restore,
        refresh,
      }}
    >
      {children}
    </AnnouncementContext.Provider>
  );
}

/**
 * Sort announcements by severity (critical > warning > info)
 */
function sortBySeverity(a: Announcement, b: Announcement): number {
  const order = { critical: 0, warning: 1, info: 2 };
  const aOrder = order[a.severity] ?? 2;
  const bOrder = order[b.severity] ?? 2;

  if (aOrder !== bOrder) return aOrder - bOrder;

  // Same severity: newer first
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

/**
 * Format timestamp as relative time
 *
 * Examples: "just now", "5m ago", "2h ago", "3d ago", "Jan 15"
 */
export function formatTimeAgo(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;

  const minutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
