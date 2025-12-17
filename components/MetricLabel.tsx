/**
 * MetricLabel - Reusable tooltip wrapper for metric abbreviations
 *
 * The "8th Grader Test": If they can't understand it, add a tooltip.
 *
 * Usage:
 *   <MetricLabel label="DOI" tooltip="How many days of stock we have left" />
 *   <MetricLabel label="TOR" tooltip="Tickets per 100 orders" className="text-purple-400" />
 */

interface MetricLabelProps {
  label: string;
  tooltip?: string; // Kept for backwards compatibility, but not displayed
  className?: string;
}

export function MetricLabel({ label, className = "" }: MetricLabelProps) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {/* Info circle icon - visual indicator only, no tooltip */}
      <svg
        className="w-3 h-3 text-text-muted/50 flex-shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <circle cx="12" cy="12" r="10" />
      </svg>
      {label}
    </span>
  );
}
