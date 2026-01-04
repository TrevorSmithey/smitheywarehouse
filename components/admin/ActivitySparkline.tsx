/**
 * ActivitySparkline Component
 *
 * Elegant 7-day activity visualization with smooth transitions
 * and refined visual hierarchy. Provides at-a-glance user engagement patterns.
 */

interface ActivitySparklineProps {
  /** Array of 7 booleans: [7 days ago, 6 days ago, ..., today] */
  dailyActivity: boolean[];
  /** Number of days active out of 7 */
  daysActive: number;
  /** Whether to show the "X/7" text label */
  showLabel?: boolean;
}

export default function ActivitySparkline({
  dailyActivity,
  daysActive,
  showLabel = true,
}: ActivitySparklineProps) {
  // Ensure we have exactly 7 days
  const days = dailyActivity.length === 7
    ? dailyActivity
    : [false, false, false, false, false, false, false];

  // Determine color based on activity level
  const getActivityColor = () => {
    if (daysActive >= 5) return { bar: "bg-status-good", text: "text-status-good" };
    if (daysActive >= 3) return { bar: "bg-accent-cyan", text: "text-accent-cyan" };
    if (daysActive >= 1) return { bar: "bg-status-warning", text: "text-status-warning" };
    return { bar: "bg-text-muted", text: "text-text-tertiary" };
  };

  const colors = getActivityColor();

  return (
    <div className="flex items-center gap-3">
      {/* Sparkline bars */}
      <div className="flex items-end gap-[3px] h-5">
        {days.map((active, index) => {
          const isToday = index === 6;
          return (
            <div
              key={index}
              className={`
                w-[5px] rounded-sm transition-all duration-300 ease-out
                ${active
                  ? `${colors.bar} ${isToday ? "h-5" : "h-4"}`
                  : "bg-border h-[6px]"
                }
                ${isToday && active ? "shadow-sm shadow-current" : ""}
              `}
              style={{
                transitionDelay: `${index * 30}ms`,
              }}
              title={getDayLabel(index)}
            />
          );
        })}
      </div>

      {/* Label */}
      {showLabel && (
        <div className="flex flex-col items-start">
          <span className={`text-xs font-semibold tabular-nums ${colors.text}`}>
            {daysActive}/7
          </span>
          <span className="text-[9px] text-text-muted uppercase tracking-wide">
            days
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Get day label for tooltip
 * Index 0 = 7 days ago, Index 6 = today
 */
function getDayLabel(index: number): string {
  const daysAgo = 6 - index;
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";

  // Get day name
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toLocaleDateString("en-US", { weekday: "short" });
}
