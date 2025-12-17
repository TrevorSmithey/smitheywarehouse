/**
 * MetricLabel - Reusable tooltip wrapper for metric abbreviations
 *
 * Uses global tooltip classes from globals.css for consistent styling.
 * The "8th Grader Test": If they can't understand it, add a tooltip.
 *
 * Usage:
 *   <MetricLabel label="DOI" tooltip="How many days of stock we have left" />
 *   <MetricLabel label="TOR" tooltip="Tickets per 100 orders" className="text-purple-400" />
 */

import { Info } from "lucide-react";

interface MetricLabelProps {
  label: string;
  tooltip: string;
  className?: string;
}

export function MetricLabel({ label, tooltip, className = "" }: MetricLabelProps) {
  return (
    <span className={`info-tip gap-1 ${className}`}>
      <Info className="info-tip-icon" />
      {label}
      <span className="info-tip-popup info-tip-top">
        {tooltip}
        <span className="info-tip-arrow" />
      </span>
    </span>
  );
}
