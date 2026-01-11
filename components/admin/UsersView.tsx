"use client";

import { useState } from "react";
import {
  UserPlus,
  Edit2,
  Check,
  X,
  RefreshCw,
  LogIn,
  Shuffle,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  DashboardRole,
  DashboardTab,
  ROLE_CONFIG,
  TAB_CONFIG,
  ALL_ROLES,
} from "@/lib/auth/permissions";
import type { DashboardUser, UserActivitySummary } from "@/lib/types";
import { useAdmin } from "@/app/admin/layout";
import UserAvatar from "./UserAvatar";
import ActivitySparkline from "./ActivitySparkline";
import PinReveal from "./PinReveal";

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateRandomPin(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

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
// USERS VIEW COMPONENT
// ============================================================================

export default function UsersView() {
  const { startImpersonation } = useAuth();
  const {
    users,
    usersLoading,
    config,
    stats,
    createUser,
    updateUser,
    toggleUserActive,
  } = useAdmin();

  // Form states
  const [showNewUserForm, setShowNewUserForm] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [newUser, setNewUser] = useState({
    name: "",
    role: "standard" as DashboardRole,
    pin: "",
    email: "",
    notes: "",
  });

  const [editForm, setEditForm] = useState({
    name: "",
    role: "" as DashboardRole,
    pin: "",
    notes: "",
    default_page_override: "",
    additional_tabs: [] as string[],
  });

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

  function getActivitySummary(userId: string): UserActivitySummary | null {
    return stats?.activitySummaries?.[userId] || null;
  }

  function getAccessibleTabsForRole(role: DashboardRole): DashboardTab[] {
    if (!config) return [];
    return config.tab_order.filter((tab) => {
      if (config.hidden_tabs.includes(tab)) return false;
      if (role === "admin") return true;
      const perms = config.role_permissions[role] || [];
      return perms.includes("*") || perms.includes(tab);
    });
  }

  function getNonAccessibleTabsForRole(role: DashboardRole): DashboardTab[] {
    if (!config) return [];
    return config.tab_order.filter((tab) => {
      if (config.hidden_tabs.includes(tab)) return false;
      if (role === "admin") return false;
      const perms = config.role_permissions[role] || [];
      return !perms.includes("*") && !perms.includes(tab);
    });
  }

  // ============================================================================
  // HANDLERS
  // ============================================================================

  async function handleCreateUser() {
    if (!newUser.name || !newUser.pin) {
      alert("Name and PIN are required");
      return;
    }
    setSaving(true);
    try {
      await createUser({
        name: newUser.name,
        role: newUser.role,
        pin: newUser.pin,
        email: newUser.email || undefined,
        notes: newUser.notes || undefined,
      });
      setNewUser({ name: "", role: "standard", pin: "", email: "", notes: "" });
      setShowNewUserForm(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to create user");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveUser(userId: string) {
    setSaving(true);
    try {
      const updates: Partial<DashboardUser> = {
        name: editForm.name,
        role: editForm.role,
        notes: editForm.notes || null,
        default_page_override: editForm.default_page_override || null,
        additional_tabs: editForm.additional_tabs,
      };
      if (editForm.pin && editForm.pin.length === 4) {
        updates.pin = editForm.pin;
      }
      await updateUser(userId, updates);
      closeEditModal();
    } catch {
      alert("Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(userId: string) {
    try {
      await toggleUserActive(userId);
    } catch {
      alert("Failed to update status");
    }
  }

  function startEditUser(user: DashboardUser) {
    setEditingUserId(user.id);
    setEditForm({
      name: user.name,
      role: user.role,
      pin: "",
      notes: user.notes || "",
      default_page_override: user.default_page_override || "",
      additional_tabs: user.additional_tabs || [],
    });
    setShowEditModal(true);
  }

  function closeEditModal() {
    setShowEditModal(false);
    setEditingUserId(null);
  }

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-lg font-medium text-text-primary">Dashboard Users</h2>
          <p className="text-sm text-text-tertiary mt-1">Manage access and permissions for team members</p>
        </div>
        <button
          onClick={() => setShowNewUserForm(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-accent-blue text-white text-sm font-medium rounded-lg hover:bg-accent-blue/90 transition-all shadow-lg shadow-accent-blue/20"
        >
          <UserPlus className="w-4 h-4" />
          Add User
        </button>
      </div>

      {/* New User Form */}
      {showNewUserForm && (
        <div className="bg-bg-secondary rounded-xl border border-border p-5 space-y-4 animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
              Create New User
            </h3>
            <button
              onClick={() => setShowNewUserForm(false)}
              className="p-1.5 text-text-tertiary hover:text-text-primary hover:bg-white/5 rounded-md transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <input
              type="text"
              placeholder="Name *"
              value={newUser.name}
              onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
              className="px-4 py-2.5 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:outline-none focus:ring-2 focus:ring-accent-blue/20 transition-all"
            />
            <select
              value={newUser.role}
              onChange={(e) => setNewUser({ ...newUser, role: e.target.value as DashboardRole })}
              className="px-4 py-2.5 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary focus:border-accent-blue focus:outline-none focus:ring-2 focus:ring-accent-blue/20 transition-all"
            >
              {ALL_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_CONFIG[role].label}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="PIN *"
                maxLength={4}
                value={newUser.pin}
                onChange={(e) => setNewUser({ ...newUser, pin: e.target.value.replace(/\D/g, "") })}
                className="flex-1 px-4 py-2.5 bg-bg-tertiary border border-border rounded-lg text-sm text-center font-mono tracking-widest text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:outline-none focus:ring-2 focus:ring-accent-blue/20 transition-all"
              />
              <button
                onClick={() => setNewUser({ ...newUser, pin: generateRandomPin() })}
                className="px-3 py-2.5 bg-bg-tertiary border border-border rounded-lg text-text-tertiary hover:text-text-primary hover:border-text-tertiary transition-all"
                title="Generate random PIN"
              >
                <Shuffle className="w-4 h-4" />
              </button>
            </div>
            <input
              type="email"
              placeholder="Email (optional)"
              value={newUser.email}
              onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
              className="px-4 py-2.5 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:outline-none focus:ring-2 focus:ring-accent-blue/20 transition-all"
            />
            <div className="flex gap-2">
              <button
                onClick={handleCreateUser}
                disabled={saving || !newUser.name || !newUser.pin}
                className="flex-1 px-4 py-2.5 bg-status-good text-white rounded-lg text-sm font-medium hover:bg-status-good/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {saving ? "Creating..." : "Create"}
              </button>
              <button
                onClick={() => setShowNewUserForm(false)}
                className="px-4 py-2.5 bg-bg-tertiary text-text-secondary rounded-lg text-sm hover:bg-border transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Users Table */}
      {usersLoading ? (
        <div className="flex justify-center py-16">
          <RefreshCw className="w-6 h-6 animate-spin text-accent-blue" />
        </div>
      ) : (
        <div className="bg-bg-secondary rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-bg-tertiary/30">
                  <th className="text-left py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium w-14" />
                  <th className="text-left py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">
                    User
                  </th>
                  <th className="text-left py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">
                    Role
                  </th>
                  <th className="text-center py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">
                    Activity
                  </th>
                  <th className="text-center py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">
                    PIN
                  </th>
                  <th className="text-center py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">
                    Status
                  </th>
                  <th className="text-center py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">
                    Last Active
                  </th>
                  <th className="text-center py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium w-24">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {users.map((user) => {
                  const activity = getActivitySummary(user.id);
                  return (
                    <tr
                      key={user.id}
                      className={`
                        transition-all duration-200 hover:bg-white/[0.02]
                        ${!user.is_active ? "opacity-40" : ""}
                      `}
                    >
                      {/* Avatar */}
                      <td className="py-4 px-4">
                        <UserAvatar
                          name={user.name}
                          role={user.role}
                          showActiveIndicator
                          isActive={activity?.isActiveNow || false}
                        />
                      </td>

                      {/* Name */}
                      <td className="py-4 px-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-text-primary font-medium">{user.name}</span>
                            {user.default_page_override && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-cyan/10 text-accent-cyan">
                                {TAB_CONFIG[user.default_page_override as DashboardTab]?.label || user.default_page_override}
                              </span>
                            )}
                            {user.additional_tabs && user.additional_tabs.length > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400">
                                +{user.additional_tabs.length}
                              </span>
                            )}
                          </div>
                          {user.notes && (
                            <p className="text-xs text-text-muted truncate max-w-[200px]" title={user.notes}>
                              {user.notes}
                            </p>
                          )}
                        </div>
                      </td>

                      {/* Role */}
                      <td className="py-4 px-4">
                        <span className={`inline-flex px-2.5 py-1 rounded-md text-xs font-medium ${ROLE_CONFIG[user.role].color}`}>
                          {ROLE_CONFIG[user.role].label}
                        </span>
                      </td>

                      {/* Activity Sparkline */}
                      <td className="py-4 px-4">
                        <div className="flex justify-center">
                          {activity ? (
                            <ActivitySparkline
                              dailyActivity={activity.dailyActivity}
                              daysActive={activity.daysActive}
                            />
                          ) : (
                            <span className="text-text-muted text-xs">No data</span>
                          )}
                        </div>
                      </td>

                      {/* PIN */}
                      <td className="py-4 px-4">
                        <div className="flex justify-center">
                          <PinReveal pin={user.pin} />
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-4 px-4 text-center">
                        <button
                          onClick={() => handleToggleActive(user.id)}
                          className={`
                            inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all
                            ${user.is_active
                              ? "bg-status-good/10 text-status-good hover:bg-status-good/20"
                              : "bg-text-muted/10 text-text-muted hover:bg-text-muted/20"
                            }
                          `}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${user.is_active ? "bg-status-good" : "bg-text-muted"}`} />
                          {user.is_active ? "Active" : "Inactive"}
                        </button>
                      </td>

                      {/* Last Active */}
                      <td className="py-4 px-4 text-center">
                        <span className="text-xs text-text-tertiary">
                          {formatRelativeTime(user.last_active_at || user.last_login_at)}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-4 px-4">
                        <div className="flex justify-center gap-1">
                          <button
                            onClick={() => startEditUser(user)}
                            className="p-2 rounded-lg text-text-tertiary hover:text-accent-blue hover:bg-accent-blue/10 transition-all"
                            title="Edit user"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          {user.role !== "admin" && user.is_active && (
                            <button
                              onClick={() => startImpersonation({ id: user.id, name: user.name, role: user.role })}
                              className="p-2 rounded-lg text-text-tertiary hover:text-purple-400 hover:bg-purple-400/10 transition-all"
                              title={`Login as ${user.name}`}
                            >
                              <LogIn className="w-4 h-4" />
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

      {/* Edit User Modal */}
      {showEditModal && editingUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={closeEditModal}
          />

          {/* Modal */}
          <div className="relative bg-bg-secondary border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
            {/* Header */}
            <div className="sticky top-0 bg-bg-secondary/95 backdrop-blur-xl border-b border-border px-6 py-5 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <UserAvatar
                  name={editForm.name || "User"}
                  role={editForm.role}
                  size="lg"
                />
                <div>
                  <h3 className="text-lg font-semibold text-text-primary">Edit User</h3>
                  <p className="text-sm text-text-tertiary mt-0.5">
                    {ROLE_CONFIG[editForm.role]?.label || editForm.role}
                  </p>
                </div>
              </div>
              <button
                onClick={closeEditModal}
                className="p-2 text-text-tertiary hover:text-text-primary hover:bg-white/5 rounded-lg transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <div className="p-6 space-y-6 overflow-y-auto max-h-[60vh]">
              {/* Basic Info */}
              <div className="space-y-4">
                <h4 className="text-xs uppercase tracking-wider text-text-tertiary font-semibold">Basic Information</h4>

                <div>
                  <label className="block text-sm text-text-secondary mb-2">Name</label>
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="w-full px-4 py-2.5 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary focus:border-accent-blue focus:outline-none focus:ring-2 focus:ring-accent-blue/20 transition-all"
                    placeholder="Enter name"
                  />
                </div>

                <div>
                  <label className="block text-sm text-text-secondary mb-2">Role</label>
                  <select
                    value={editForm.role}
                    onChange={(e) => {
                      const newRole = e.target.value as DashboardRole;
                      setEditForm({
                        ...editForm,
                        role: newRole,
                        additional_tabs: editForm.additional_tabs.filter(
                          (tab) => getNonAccessibleTabsForRole(newRole).includes(tab as DashboardTab)
                        ),
                      });
                    }}
                    className="w-full px-4 py-2.5 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary focus:border-accent-blue focus:outline-none focus:ring-2 focus:ring-accent-blue/20 transition-all"
                  >
                    {ALL_ROLES.map((role) => (
                      <option key={role} value={role}>{ROLE_CONFIG[role].label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-text-secondary mb-2">PIN</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      maxLength={4}
                      value={editForm.pin}
                      onChange={(e) => setEditForm({ ...editForm, pin: e.target.value.replace(/\D/g, "") })}
                      className="flex-1 px-4 py-2.5 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary font-mono text-center tracking-widest focus:border-accent-blue focus:outline-none focus:ring-2 focus:ring-accent-blue/20 transition-all"
                      placeholder="Leave blank to keep"
                    />
                    <button
                      onClick={() => setEditForm({ ...editForm, pin: generateRandomPin() })}
                      className="px-4 py-2.5 bg-bg-tertiary border border-border rounded-lg text-text-tertiary hover:text-text-primary hover:border-text-tertiary transition-all"
                      title="Generate random PIN"
                    >
                      <Shuffle className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs text-text-muted mt-2">4 digits only. Leave blank to keep existing.</p>
                </div>
              </div>

              {/* Customization */}
              <div className="space-y-4 pt-4 border-t border-border">
                <h4 className="text-xs uppercase tracking-wider text-text-tertiary font-semibold">Customization</h4>

                <div>
                  <label className="block text-sm text-text-secondary mb-2">Default Page</label>
                  <select
                    value={editForm.default_page_override || ""}
                    onChange={(e) => setEditForm({ ...editForm, default_page_override: e.target.value })}
                    className="w-full px-4 py-2.5 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary focus:border-accent-blue focus:outline-none focus:ring-2 focus:ring-accent-blue/20 transition-all"
                  >
                    <option value="">Use Role Default ({config?.role_defaults[editForm.role] ? TAB_CONFIG[config.role_defaults[editForm.role]]?.label : "Inventory"})</option>
                    {getAccessibleTabsForRole(editForm.role).map((tab) => (
                      <option key={tab} value={tab}>{TAB_CONFIG[tab]?.label || tab}</option>
                    ))}
                  </select>
                </div>

                {editForm.role !== "admin" && getNonAccessibleTabsForRole(editForm.role).length > 0 && (
                  <div>
                    <label className="block text-sm text-text-secondary mb-2">Additional Tab Access</label>
                    <p className="text-xs text-text-muted mb-3">
                      Grant access to tabs beyond {ROLE_CONFIG[editForm.role]?.label} defaults:
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {getNonAccessibleTabsForRole(editForm.role).map((tab) => (
                        <label
                          key={tab}
                          className={`
                            flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-all
                            ${editForm.additional_tabs.includes(tab)
                              ? "bg-accent-blue/10 border border-accent-blue/30"
                              : "bg-bg-tertiary border border-border hover:border-text-muted"
                            }
                          `}
                        >
                          <input
                            type="checkbox"
                            checked={editForm.additional_tabs.includes(tab)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setEditForm({ ...editForm, additional_tabs: [...editForm.additional_tabs, tab] });
                              } else {
                                setEditForm({ ...editForm, additional_tabs: editForm.additional_tabs.filter((t) => t !== tab) });
                              }
                            }}
                            className="w-4 h-4 rounded border-border bg-bg-tertiary text-accent-blue focus:ring-accent-blue focus:ring-offset-0"
                          />
                          <span className="text-sm text-text-secondary">{TAB_CONFIG[tab]?.label || tab}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Notes */}
              <div className="space-y-4 pt-4 border-t border-border">
                <h4 className="text-xs uppercase tracking-wider text-text-tertiary font-semibold">Notes</h4>
                <textarea
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2.5 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary focus:border-accent-blue focus:outline-none focus:ring-2 focus:ring-accent-blue/20 resize-none transition-all"
                  placeholder="Internal notes about this user..."
                />
                <p className="text-xs text-text-muted">Only visible to admins.</p>
              </div>
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 bg-bg-secondary/95 backdrop-blur-xl border-t border-border px-6 py-4 flex items-center justify-end gap-3">
              <button
                onClick={closeEditModal}
                className="px-4 py-2.5 text-sm text-text-secondary hover:text-text-primary border border-border rounded-lg hover:bg-white/5 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSaveUser(editingUserId)}
                disabled={saving || !editForm.name}
                className="px-5 py-2.5 text-sm bg-accent-blue text-white rounded-lg hover:bg-accent-blue/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2 shadow-lg shadow-accent-blue/20"
              >
                {saving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Save Changes
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
