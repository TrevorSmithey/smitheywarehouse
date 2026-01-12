"use client";

import { useState } from "react";
import { Eye, Grid3X3 } from "lucide-react";
import TabVisibilitySection from "./TabVisibilitySection";
import RolePermissionsMatrix from "./RolePermissionsMatrix";

type PermissionTab = "visibility" | "permissions";

const TABS: { id: PermissionTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "visibility", label: "Tab Visibility", icon: Eye },
  { id: "permissions", label: "Role Permissions", icon: Grid3X3 },
];

export default function PermissionsContainer() {
  const [activeTab, setActiveTab] = useState<PermissionTab>("permissions");

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div>
        <h2 className="text-lg font-medium text-text-primary">Tab Management</h2>
        <p className="text-sm text-text-tertiary mt-1">
          Control visibility, access, and ordering of dashboard tabs
        </p>
      </div>

      {/* Sub-tab Navigation */}
      <div className="flex gap-1 border-b border-border/30">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all
                border-b-2 -mb-px
                ${isActive
                  ? "text-text-primary border-accent-blue"
                  : "text-text-muted hover:text-text-secondary border-transparent"
                }
              `}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Active Section */}
      <div className="min-h-[400px]">
        {activeTab === "visibility" && <TabVisibilitySection />}
        {activeTab === "permissions" && <RolePermissionsMatrix />}
      </div>
    </div>
  );
}
