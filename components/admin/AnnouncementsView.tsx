"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Plus, X, RefreshCw, Megaphone, Trash2 } from "lucide-react";
import { getAuthHeaders } from "@/lib/auth";
import type { Announcement } from "@/lib/types";

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// ============================================================================
// ANNOUNCEMENTS VIEW COMPONENT
// ============================================================================

export default function AnnouncementsView() {
  // Mounted ref for async safety
  const isMountedRef = useRef(true);

  // Announcements state (fetched here, not from context)
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(false);
  const [showNewAnnouncementForm, setShowNewAnnouncementForm] = useState(false);
  const [newAnnouncement, setNewAnnouncement] = useState({
    title: "",
    message: "",
    severity: "info" as "info" | "warning" | "critical",
    expires_at: "",
  });
  const [announcementSaving, setAnnouncementSaving] = useState(false);

  // Load announcements (all, including archived for admin view)
  const loadAnnouncements = useCallback(async () => {
    setAnnouncementsLoading(true);
    try {
      const supabase = await import("@/lib/supabase/client").then((m) => m.createClient());
      const { data, error } = await supabase
        .from("announcements")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      if (isMountedRef.current) {
        setAnnouncements(data || []);
      }
    } catch (error) {
      console.error("Failed to load announcements:", error);
    } finally {
      if (isMountedRef.current) {
        setAnnouncementsLoading(false);
      }
    }
  }, []);

  // Create announcement
  const handleCreateAnnouncement = async () => {
    if (!newAnnouncement.title.trim()) {
      alert("Title is required");
      return;
    }
    setAnnouncementSaving(true);
    try {
      const res = await fetch("/api/announcements", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          title: newAnnouncement.title.trim(),
          message: newAnnouncement.message.trim() || null,
          severity: newAnnouncement.severity,
          expires_at: newAnnouncement.expires_at || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create announcement");
      }
      await loadAnnouncements();
      setNewAnnouncement({ title: "", message: "", severity: "info", expires_at: "" });
      setShowNewAnnouncementForm(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to create announcement");
    } finally {
      setAnnouncementSaving(false);
    }
  };

  // Archive announcement
  const handleArchiveAnnouncement = async (id: string) => {
    if (!confirm("Archive this announcement? It will no longer be visible to users.")) return;
    try {
      const res = await fetch(`/api/announcements/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to archive");
      await loadAnnouncements();
    } catch {
      alert("Failed to archive announcement");
    }
  };

  // Initial load with cleanup
  useEffect(() => {
    isMountedRef.current = true;
    loadAnnouncements();

    return () => {
      isMountedRef.current = false;
    };
  }, [loadAnnouncements]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-lg font-medium text-text-primary">System Announcements</h2>
          <p className="text-sm text-text-tertiary mt-1">Create alerts visible to all dashboard users</p>
        </div>
        <button
          onClick={() => setShowNewAnnouncementForm(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-accent-blue text-white text-sm font-medium rounded-lg hover:bg-accent-blue/90 transition-all shadow-lg shadow-accent-blue/20"
        >
          <Plus className="w-4 h-4" />
          New Announcement
        </button>
      </div>

      {/* New Announcement Form */}
      {showNewAnnouncementForm && (
        <div className="bg-bg-secondary rounded-xl border border-border p-5 space-y-4 animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
              Create Announcement
            </h3>
            <button
              onClick={() => setShowNewAnnouncementForm(false)}
              className="p-1.5 text-text-tertiary hover:text-text-primary hover:bg-white/5 rounded-md transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="block text-sm text-text-secondary mb-2">Title *</label>
              <input
                type="text"
                placeholder="e.g., Product X out of stock until Jan 15"
                value={newAnnouncement.title}
                onChange={(e) => setNewAnnouncement({ ...newAnnouncement, title: e.target.value })}
                className="w-full px-4 py-2.5 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:outline-none focus:ring-2 focus:ring-accent-blue/20 transition-all"
              />
            </div>

            <div>
              <label className="block text-sm text-text-secondary mb-2">Message (optional)</label>
              <textarea
                placeholder="Additional details..."
                rows={2}
                value={newAnnouncement.message}
                onChange={(e) => setNewAnnouncement({ ...newAnnouncement, message: e.target.value })}
                className="w-full px-4 py-2.5 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:outline-none focus:ring-2 focus:ring-accent-blue/20 resize-none transition-all"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-text-secondary mb-2">Severity</label>
                <select
                  value={newAnnouncement.severity}
                  onChange={(e) => setNewAnnouncement({ ...newAnnouncement, severity: e.target.value as "info" | "warning" | "critical" })}
                  className="w-full px-4 py-2.5 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary focus:border-accent-blue focus:outline-none focus:ring-2 focus:ring-accent-blue/20 transition-all"
                >
                  <option value="info">Info (Blue)</option>
                  <option value="warning">Warning (Amber)</option>
                  <option value="critical">Critical (Red)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-text-secondary mb-2">Expires (optional)</label>
                <input
                  type="date"
                  value={newAnnouncement.expires_at}
                  onChange={(e) => setNewAnnouncement({ ...newAnnouncement, expires_at: e.target.value })}
                  className="w-full px-4 py-2.5 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary focus:border-accent-blue focus:outline-none focus:ring-2 focus:ring-accent-blue/20 transition-all"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleCreateAnnouncement}
                disabled={announcementSaving || !newAnnouncement.title.trim()}
                className="flex-1 px-4 py-2.5 bg-status-good text-white rounded-lg text-sm font-medium hover:bg-status-good/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {announcementSaving ? "Creating..." : "Create Announcement"}
              </button>
              <button
                onClick={() => setShowNewAnnouncementForm(false)}
                className="px-4 py-2.5 bg-bg-tertiary text-text-secondary rounded-lg text-sm hover:bg-border transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Announcements List */}
      {announcementsLoading ? (
        <div className="flex justify-center py-16">
          <RefreshCw className="w-6 h-6 animate-spin text-accent-blue" />
        </div>
      ) : announcements.length === 0 ? (
        <div className="text-center py-16 text-text-tertiary">
          <Megaphone className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No announcements yet.</p>
          <p className="text-sm mt-1">Create one to alert all dashboard users.</p>
        </div>
      ) : (
        <div className="bg-bg-secondary rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-bg-tertiary/30">
                  <th className="text-left py-3.5 px-5 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Announcement</th>
                  <th className="text-center py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Severity</th>
                  <th className="text-center py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Status</th>
                  <th className="text-right py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Created</th>
                  <th className="text-right py-3.5 px-5 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Expires</th>
                  <th className="text-center py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium w-20">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {announcements.map((announcement) => {
                  const isExpired = announcement.expires_at && new Date(announcement.expires_at) < new Date();
                  const isActive = !announcement.is_archived && !isExpired;

                  return (
                    <tr
                      key={announcement.id}
                      className={`
                        transition-all duration-200 hover:bg-white/[0.02]
                        ${announcement.is_archived || isExpired ? "opacity-40" : ""}
                      `}
                    >
                      {/* Title & Message */}
                      <td className="py-4 px-5">
                        <div className="space-y-1">
                          <span className="text-text-primary font-medium">{announcement.title}</span>
                          {announcement.message && (
                            <p className="text-xs text-text-muted truncate max-w-[300px]" title={announcement.message}>
                              {announcement.message}
                            </p>
                          )}
                          <p className="text-[10px] text-text-muted">by {announcement.created_by}</p>
                        </div>
                      </td>

                      {/* Severity */}
                      <td className="py-4 px-4 text-center">
                        <span className={`
                          inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium
                          ${announcement.severity === "critical"
                            ? "bg-status-bad/10 text-status-bad"
                            : announcement.severity === "warning"
                            ? "bg-status-warning/10 text-status-warning"
                            : "bg-accent-blue/10 text-accent-blue"
                          }
                        `}>
                          {announcement.severity}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-4 px-4 text-center">
                        <span className={`
                          inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
                          ${isActive
                            ? "bg-status-good/10 text-status-good"
                            : "bg-text-muted/10 text-text-muted"
                          }
                        `}>
                          <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-status-good" : "bg-text-muted"}`} />
                          {announcement.is_archived ? "Archived" : isExpired ? "Expired" : "Active"}
                        </span>
                      </td>

                      {/* Created */}
                      <td className="py-4 px-4 text-right">
                        <span className="text-xs text-text-tertiary">
                          {formatRelativeTime(announcement.created_at)}
                        </span>
                      </td>

                      {/* Expires */}
                      <td className="py-4 px-5 text-right">
                        <span className={`text-xs ${isExpired ? "text-status-warning" : "text-text-tertiary"}`}>
                          {announcement.expires_at
                            ? new Date(announcement.expires_at).toLocaleDateString()
                            : "Never"}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-4 px-4">
                        <div className="flex justify-center">
                          {!announcement.is_archived && (
                            <button
                              onClick={() => handleArchiveAnnouncement(announcement.id)}
                              className="p-2 rounded-lg text-text-tertiary hover:text-status-bad hover:bg-status-bad/10 transition-all"
                              title="Archive"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-xs text-text-muted">
        Active announcements appear on all dashboard pages until dismissed by each user.
      </p>
    </div>
  );
}
