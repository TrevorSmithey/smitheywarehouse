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
  tooltip: string;
  className?: string;
}

export function MetricLabel({ label, tooltip, className = "" }: MetricLabelProps) {
  return (
    <span className={`inline-flex items-center gap-1 relative group cursor-help ${className}`}>
      {/* Info icon - on the LEFT of label */}
      <svg
        className="w-3 h-3 text-text-muted/50 group-hover:text-text-muted transition-colors flex-shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" />
      </svg>
      {label}
      {/* Tooltip */}
      <span className="
        absolute bottom-full left-1/2 -translate-x-1/2 mb-2
        px-2.5 py-1.5 rounded-md
        bg-[#151515] text-[11px] text-white font-normal
        opacity-0 group-hover:opacity-100
        scale-95 group-hover:scale-100
        transition-all duration-150
        pointer-events-none whitespace-nowrap z-50
        shadow-lg
      ">
        {tooltip}
        {/* Arrow pointing down */}
        <svg
          className="absolute top-full left-1/2 -translate-x-1/2 -mt-px"
          width="10"
          height="5"
          viewBox="0 0 10 5"
        >
          <polygon points="0,0 10,0 5,5" fill="#151515" />
        </svg>
      </span>
    </span>
  );
}
