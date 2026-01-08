/**
 * UserAvatar Component
 *
 * Premium avatar with role-based gradient backgrounds and refined styling.
 * Features smooth transitions and an elegant online status indicator.
 */

import { DashboardRole } from "@/lib/auth/permissions";

interface UserAvatarProps {
  name: string;
  role: DashboardRole;
  size?: "sm" | "md" | "lg" | "xl";
  showActiveIndicator?: boolean;
  isActive?: boolean;
}

// Role-based gradient backgrounds for premium feel
const roleGradients: Record<DashboardRole, string> = {
  admin: "bg-gradient-to-br from-purple-500 to-purple-700",
  exec: "bg-gradient-to-br from-amber-500 to-amber-700",
  ops1: "bg-gradient-to-br from-orange-500 to-orange-700",
  ops2: "bg-gradient-to-br from-sky-500 to-sky-700",
  standard: "bg-gradient-to-br from-slate-500 to-slate-700",
  sales: "bg-gradient-to-br from-blue-500 to-blue-700",
  fulfillment: "bg-gradient-to-br from-emerald-500 to-emerald-700",
};

// Subtle ring color per role
const roleRings: Record<DashboardRole, string> = {
  admin: "ring-purple-500/20",
  exec: "ring-amber-500/20",
  ops1: "ring-orange-500/20",
  ops2: "ring-sky-500/20",
  standard: "ring-slate-500/20",
  sales: "ring-blue-500/20",
  fulfillment: "ring-emerald-500/20",
};

// Size classes with better proportions
const sizeClasses = {
  sm: "w-7 h-7 text-[10px]",
  md: "w-9 h-9 text-xs",
  lg: "w-11 h-11 text-sm",
  xl: "w-14 h-14 text-base",
};

// Status indicator sizes
const statusSizes = {
  sm: "w-2 h-2 -bottom-0 -right-0",
  md: "w-2.5 h-2.5 -bottom-0.5 -right-0.5",
  lg: "w-3 h-3 -bottom-0.5 -right-0.5",
  xl: "w-3.5 h-3.5 -bottom-0.5 -right-0.5",
};

/**
 * Extract initials from a name
 * "Trevor Funderburk" -> "TF"
 * "Isaac" -> "IS"
 */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export default function UserAvatar({
  name,
  role,
  size = "md",
  showActiveIndicator = false,
  isActive = false,
}: UserAvatarProps) {
  const initials = getInitials(name);
  const gradient = roleGradients[role] || roleGradients.standard;
  const ringColor = roleRings[role] || roleRings.standard;

  return (
    <div className="relative inline-flex">
      <div
        className={`
          ${sizeClasses[size]}
          ${gradient}
          rounded-full
          flex items-center justify-center
          text-white font-semibold
          ring-2 ${ringColor}
          shadow-lg shadow-black/20
          transition-transform duration-200
          hover:scale-105
        `}
        title={name}
      >
        {initials}
      </div>

      {/* Active status indicator */}
      {showActiveIndicator && (
        <span
          className={`
            absolute ${statusSizes[size]}
            rounded-full
            border-2 border-bg-secondary
            transition-colors duration-300
            ${isActive
              ? "bg-status-good shadow-lg shadow-status-good/30"
              : "bg-text-muted"
            }
          `}
          title={isActive ? "Online now" : "Offline"}
        >
          {isActive && (
            <span className="absolute inset-0 rounded-full bg-status-good animate-ping opacity-75" />
          )}
        </span>
      )}
    </div>
  );
}
