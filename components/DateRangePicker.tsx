"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import {
  format,
  startOfDay,
  endOfDay,
  subDays,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfQuarter,
  endOfQuarter,
  startOfYear,
  endOfYear,
  subMonths,
  subQuarters,
  subYears,
  isSameDay,
  isWithinInterval,
  eachDayOfInterval,
  addMonths,
  getDay,
  getDaysInMonth,
} from "date-fns";

// ============================================================================
// TYPES
// ============================================================================

export interface DateRange {
  start: Date;
  end: Date;
}

export interface CompareRange {
  start: Date;
  end: Date;
  label: string;
}

export type CompareOption = "previous_period" | "previous_year" | "none";

export interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  compareOption: CompareOption;
  onCompareChange: (option: CompareOption) => void;
  compareRange?: CompareRange | null;
}

// ============================================================================
// PRESETS
// ============================================================================

type PresetKey =
  | "today"
  | "yesterday"
  | "last_7_days"
  | "last_30_days"
  | "last_90_days"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "last_quarter"
  | "this_year"
  | "last_year"
  | "custom";

interface Preset {
  key: PresetKey;
  label: string;
  getRange: () => DateRange;
}

const presets: Preset[] = [
  {
    key: "today",
    label: "Today",
    getRange: () => ({ start: startOfDay(new Date()), end: endOfDay(new Date()) }),
  },
  {
    key: "yesterday",
    label: "Yesterday",
    getRange: () => {
      const yesterday = subDays(new Date(), 1);
      return { start: startOfDay(yesterday), end: endOfDay(yesterday) };
    },
  },
  {
    key: "last_7_days",
    label: "Last 7 days",
    getRange: () => ({ start: startOfDay(subDays(new Date(), 6)), end: endOfDay(new Date()) }),
  },
  {
    key: "last_30_days",
    label: "Last 30 days",
    getRange: () => ({ start: startOfDay(subDays(new Date(), 29)), end: endOfDay(new Date()) }),
  },
  {
    key: "last_90_days",
    label: "Last 90 days",
    getRange: () => ({ start: startOfDay(subDays(new Date(), 89)), end: endOfDay(new Date()) }),
  },
  {
    key: "this_month",
    label: "This month",
    getRange: () => ({ start: startOfMonth(new Date()), end: endOfDay(new Date()) }),
  },
  {
    key: "last_month",
    label: "Last month",
    getRange: () => {
      const lastMonth = subMonths(new Date(), 1);
      return { start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) };
    },
  },
  {
    key: "this_quarter",
    label: "This quarter",
    getRange: () => ({ start: startOfQuarter(new Date()), end: endOfDay(new Date()) }),
  },
  {
    key: "last_quarter",
    label: "Last quarter",
    getRange: () => {
      const lastQuarter = subQuarters(new Date(), 1);
      return { start: startOfQuarter(lastQuarter), end: endOfQuarter(lastQuarter) };
    },
  },
  {
    key: "this_year",
    label: "This year",
    getRange: () => ({ start: startOfYear(new Date()), end: endOfDay(new Date()) }),
  },
  {
    key: "last_year",
    label: "Last year",
    getRange: () => {
      const lastYear = subYears(new Date(), 1);
      return { start: startOfYear(lastYear), end: endOfYear(lastYear) };
    },
  },
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getCompareRange(range: DateRange, option: CompareOption): CompareRange | null {
  if (option === "none") return null;

  const days = Math.ceil((range.end.getTime() - range.start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  if (option === "previous_period") {
    const prevEnd = subDays(range.start, 1);
    const prevStart = subDays(prevEnd, days - 1);
    return {
      start: startOfDay(prevStart),
      end: endOfDay(prevEnd),
      label: `${format(prevStart, "MMM d")} - ${format(prevEnd, "MMM d, yyyy")}`,
    };
  }

  if (option === "previous_year") {
    return {
      start: subYears(range.start, 1),
      end: subYears(range.end, 1),
      label: `${format(subYears(range.start, 1), "MMM d")} - ${format(subYears(range.end, 1), "MMM d, yyyy")}`,
    };
  }

  return null;
}

function formatDateRange(range: DateRange): string {
  const sameMonth = range.start.getMonth() === range.end.getMonth();
  const sameYear = range.start.getFullYear() === range.end.getFullYear();
  const sameDay = isSameDay(range.start, range.end);

  if (sameDay) {
    return format(range.start, "MMM d, yyyy");
  }

  if (sameMonth && sameYear) {
    return `${format(range.start, "MMM d")}-${format(range.end, "d, yyyy")}`;
  }

  if (sameYear) {
    return `${format(range.start, "MMM d")} - ${format(range.end, "MMM d, yyyy")}`;
  }

  return `${format(range.start, "MMM d, yyyy")} - ${format(range.end, "MMM d, yyyy")}`;
}

function findMatchingPreset(range: DateRange): PresetKey {
  for (const preset of presets) {
    const presetRange = preset.getRange();
    if (isSameDay(range.start, presetRange.start) && isSameDay(range.end, presetRange.end)) {
      return preset.key;
    }
  }
  return "custom";
}

// ============================================================================
// CALENDAR COMPONENT
// ============================================================================

function MiniCalendar({
  month,
  selectedRange,
  hoverDate,
  onDateClick,
  onDateHover,
  onMonthChange,
}: {
  month: Date;
  selectedRange: DateRange | null;
  hoverDate: Date | null;
  onDateClick: (date: Date) => void;
  onDateHover: (date: Date | null) => void;
  onMonthChange: (delta: number) => void;
}) {
  const daysInMonth = getDaysInMonth(month);
  const firstDayOfMonth = startOfMonth(month);
  const startDay = getDay(firstDayOfMonth);
  const days: (Date | null)[] = [];

  // Add empty slots for days before the first day of the month
  for (let i = 0; i < startDay; i++) {
    days.push(null);
  }

  // Add all days of the month
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(new Date(month.getFullYear(), month.getMonth(), i));
  }

  const isInRange = (date: Date) => {
    if (!selectedRange) return false;
    return isWithinInterval(date, { start: selectedRange.start, end: selectedRange.end });
  };

  const isRangeStart = (date: Date) => selectedRange && isSameDay(date, selectedRange.start);
  const isRangeEnd = (date: Date) => selectedRange && isSameDay(date, selectedRange.end);

  return (
    <div className="w-[280px]">
      {/* Month header */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => onMonthChange(-1)}
          className="p-1 hover:bg-bg-tertiary rounded transition-colors"
        >
          <ChevronLeft className="w-4 h-4 text-text-secondary" />
        </button>
        <span className="text-sm font-semibold text-text-primary">
          {format(month, "MMMM yyyy")}
        </span>
        <button
          onClick={() => onMonthChange(1)}
          className="p-1 hover:bg-bg-tertiary rounded transition-colors"
        >
          <ChevronRight className="w-4 h-4 text-text-secondary" />
        </button>
      </div>

      {/* Day labels */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
          <div key={day} className="text-xs text-text-tertiary text-center py-1">
            {day}
          </div>
        ))}
      </div>

      {/* Days grid */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((date, i) => {
          if (!date) {
            return <div key={`empty-${i}`} className="h-8" />;
          }

          const inRange = isInRange(date);
          const isStart = isRangeStart(date);
          const isEnd = isRangeEnd(date);
          const isToday = isSameDay(date, new Date());

          return (
            <button
              key={date.toISOString()}
              onClick={() => onDateClick(date)}
              onMouseEnter={() => onDateHover(date)}
              onMouseLeave={() => onDateHover(null)}
              className={`
                h-8 text-sm rounded transition-colors relative
                ${inRange ? "bg-accent-blue/20" : "hover:bg-bg-tertiary"}
                ${isStart || isEnd ? "bg-accent-blue text-white" : "text-text-secondary"}
                ${isToday && !inRange ? "ring-1 ring-accent-blue/50" : ""}
              `}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function DateRangePicker({
  value,
  onChange,
  compareOption,
  onCompareChange,
}: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [tempRange, setTempRange] = useState<DateRange>(value);
  const [selectionStart, setSelectionStart] = useState<Date | null>(null);
  const [hoverDate, setHoverDate] = useState<Date | null>(null);
  const [leftMonth, setLeftMonth] = useState(subMonths(new Date(), 1));
  const [rightMonth, setRightMonth] = useState(new Date());
  const [activePreset, setActivePreset] = useState<PresetKey>(findMatchingPreset(value));

  const dropdownRef = useRef<HTMLDivElement>(null);
  const compareRange = getCompareRange(value, compareOption);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Sync temp range with value
  useEffect(() => {
    setTempRange(value);
    setActivePreset(findMatchingPreset(value));
  }, [value]);

  const handlePresetClick = (preset: Preset) => {
    const range = preset.getRange();
    setTempRange(range);
    setActivePreset(preset.key);
    onChange(range);
  };

  const handleDateClick = (date: Date) => {
    if (!selectionStart) {
      // First click - start selection
      setSelectionStart(date);
      setTempRange({ start: date, end: date });
    } else {
      // Second click - end selection
      const start = date < selectionStart ? date : selectionStart;
      const end = date < selectionStart ? selectionStart : date;
      const newRange = { start: startOfDay(start), end: endOfDay(end) };
      setTempRange(newRange);
      setSelectionStart(null);
      setActivePreset("custom");
      onChange(newRange);
    }
  };

  const handleLeftMonthChange = (delta: number) => {
    const newLeft = addMonths(leftMonth, delta);
    setLeftMonth(newLeft);
    if (newLeft >= rightMonth) {
      setRightMonth(addMonths(newLeft, 1));
    }
  };

  const handleRightMonthChange = (delta: number) => {
    const newRight = addMonths(rightMonth, delta);
    setRightMonth(newRight);
    if (newRight <= leftMonth) {
      setLeftMonth(addMonths(newRight, -1));
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2.5 bg-bg-secondary hover:bg-bg-tertiary border border-border rounded-lg transition-colors"
      >
        <Calendar className="w-4 h-4 text-text-tertiary" />
        <span className="text-sm font-medium text-text-primary">
          {formatDateRange(value)}
        </span>
        <ChevronDown className={`w-4 h-4 text-text-tertiary transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {/* Compare badge */}
      {compareOption !== "none" && compareRange && (
        <div className="mt-1 text-xs text-text-tertiary">
          vs {compareRange.label}
        </div>
      )}

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-2 z-50 bg-bg-secondary border border-border rounded-xl shadow-xl overflow-hidden min-w-[680px]">
          <div className="flex">
            {/* Presets sidebar */}
            <div className="w-[180px] border-r border-border p-3 bg-bg-tertiary/30">
              <div className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-3 px-2">
                Date Range
              </div>
              <div className="space-y-0.5">
                {presets.map((preset) => (
                  <button
                    key={preset.key}
                    onClick={() => handlePresetClick(preset)}
                    className={`
                      w-full text-left px-3 py-2 text-sm rounded-lg transition-colors
                      ${activePreset === preset.key
                        ? "bg-accent-blue text-white"
                        : "text-text-secondary hover:bg-bg-tertiary"
                      }
                    `}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Calendar area */}
            <div className="p-4">
              {/* Calendars */}
              <div className="flex gap-6 mb-4">
                <MiniCalendar
                  month={leftMonth}
                  selectedRange={tempRange}
                  hoverDate={hoverDate}
                  onDateClick={handleDateClick}
                  onDateHover={setHoverDate}
                  onMonthChange={handleLeftMonthChange}
                />
                <MiniCalendar
                  month={rightMonth}
                  selectedRange={tempRange}
                  hoverDate={hoverDate}
                  onDateClick={handleDateClick}
                  onDateHover={setHoverDate}
                  onMonthChange={handleRightMonthChange}
                />
              </div>

              {/* Compare options */}
              <div className="pt-4 border-t border-border">
                <div className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-3">
                  Compare to
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => onCompareChange("previous_period")}
                    className={`
                      px-3 py-1.5 text-sm rounded-lg transition-colors
                      ${compareOption === "previous_period"
                        ? "bg-accent-blue text-white"
                        : "bg-bg-tertiary text-text-secondary hover:bg-bg-tertiary/80"
                      }
                    `}
                  >
                    Previous period
                  </button>
                  <button
                    onClick={() => onCompareChange("previous_year")}
                    className={`
                      px-3 py-1.5 text-sm rounded-lg transition-colors
                      ${compareOption === "previous_year"
                        ? "bg-accent-blue text-white"
                        : "bg-bg-tertiary text-text-secondary hover:bg-bg-tertiary/80"
                      }
                    `}
                  >
                    Previous year
                  </button>
                  <button
                    onClick={() => onCompareChange("none")}
                    className={`
                      px-3 py-1.5 text-sm rounded-lg transition-colors
                      ${compareOption === "none"
                        ? "bg-bg-tertiary text-text-primary"
                        : "text-text-tertiary hover:bg-bg-tertiary/50"
                      }
                    `}
                  >
                    No comparison
                  </button>
                </div>
                {compareOption !== "none" && compareRange && (
                  <div className="mt-2 text-xs text-text-tertiary">
                    Comparing to: {compareRange.label}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SIMPLE PERIOD SELECTOR (for P&L which uses monthly data)
// ============================================================================

export type PLPeriod = "this_month" | "last_month" | "this_quarter" | "last_quarter" | "ytd" | "last_year" | "custom";
export type PLCompare = "previous_period" | "previous_year" | "none";

interface PLDateSelectorProps {
  year: number;
  onYearChange: (year: number) => void;
  period: PLPeriod;
  onPeriodChange: (period: PLPeriod) => void;
  compare: PLCompare;
  onCompareChange: (compare: PLCompare) => void;
}

const plPeriods: { key: PLPeriod; label: string }[] = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_quarter", label: "This quarter" },
  { key: "last_quarter", label: "Last quarter" },
  { key: "ytd", label: "Year to date" },
  { key: "last_year", label: "Last year" },
];

export function PLDateSelector({
  year,
  onYearChange,
  period,
  onPeriodChange,
  compare,
  onCompareChange,
}: PLDateSelectorProps) {
  const [isPeriodOpen, setIsPeriodOpen] = useState(false);
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const periodRef = useRef<HTMLDivElement>(null);
  const compareRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (periodRef.current && !periodRef.current.contains(event.target as Node)) {
        setIsPeriodOpen(false);
      }
      if (compareRef.current && !compareRef.current.contains(event.target as Node)) {
        setIsCompareOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const currentPeriodLabel = plPeriods.find(p => p.key === period)?.label || "Custom";
  const currentCompareLabel = compare === "previous_year"
    ? "Previous year"
    : compare === "previous_period"
      ? "Previous period"
      : "No comparison";

  return (
    <div className="flex items-center gap-3">
      {/* Year selector */}
      <div className="flex items-center gap-1 bg-bg-tertiary/50 rounded-lg p-1 border border-border/40">
        <button
          onClick={() => onYearChange(year - 1)}
          className="p-2 hover:bg-bg-tertiary rounded transition-colors"
          disabled={year <= 2023}
        >
          <ChevronLeft className="w-4 h-4 text-text-tertiary" />
        </button>
        <span className="px-4 py-1.5 text-sm font-semibold text-text-primary tabular-nums">{year}</span>
        <button
          onClick={() => onYearChange(year + 1)}
          className="p-2 hover:bg-bg-tertiary rounded transition-colors"
          disabled={year >= new Date().getFullYear()}
        >
          <ChevronRight className="w-4 h-4 text-text-tertiary" />
        </button>
      </div>

      {/* Period selector */}
      <div className="relative" ref={periodRef}>
        <button
          onClick={() => setIsPeriodOpen(!isPeriodOpen)}
          className="flex items-center gap-2 px-4 py-2.5 bg-bg-secondary hover:bg-bg-tertiary border border-border rounded-lg transition-colors"
        >
          <Calendar className="w-4 h-4 text-text-tertiary" />
          <span className="text-sm font-medium text-text-primary">{currentPeriodLabel}</span>
          <ChevronDown className={`w-4 h-4 text-text-tertiary transition-transform ${isPeriodOpen ? "rotate-180" : ""}`} />
        </button>

        {isPeriodOpen && (
          <div className="absolute top-full left-0 mt-2 z-50 bg-bg-secondary border border-border rounded-xl shadow-xl overflow-hidden min-w-[180px]">
            <div className="p-2">
              {plPeriods.map((p) => (
                <button
                  key={p.key}
                  onClick={() => {
                    onPeriodChange(p.key);
                    setIsPeriodOpen(false);
                  }}
                  className={`
                    w-full text-left px-3 py-2 text-sm rounded-lg transition-colors
                    ${period === p.key
                      ? "bg-accent-blue text-white"
                      : "text-text-secondary hover:bg-bg-tertiary"
                    }
                  `}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Compare selector */}
      <div className="relative" ref={compareRef}>
        <button
          onClick={() => setIsCompareOpen(!isCompareOpen)}
          className="flex items-center gap-2 px-4 py-2.5 bg-bg-secondary hover:bg-bg-tertiary border border-border rounded-lg transition-colors"
        >
          <span className="text-sm text-text-tertiary">vs</span>
          <span className="text-sm font-medium text-text-primary">{currentCompareLabel}</span>
          <ChevronDown className={`w-4 h-4 text-text-tertiary transition-transform ${isCompareOpen ? "rotate-180" : ""}`} />
        </button>

        {isCompareOpen && (
          <div className="absolute top-full left-0 mt-2 z-50 bg-bg-secondary border border-border rounded-xl shadow-xl overflow-hidden min-w-[180px]">
            <div className="p-2">
              <button
                onClick={() => {
                  onCompareChange("previous_year");
                  setIsCompareOpen(false);
                }}
                className={`
                  w-full text-left px-3 py-2 text-sm rounded-lg transition-colors
                  ${compare === "previous_year"
                    ? "bg-accent-blue text-white"
                    : "text-text-secondary hover:bg-bg-tertiary"
                  }
                `}
              >
                Previous year
              </button>
              <button
                onClick={() => {
                  onCompareChange("previous_period");
                  setIsCompareOpen(false);
                }}
                className={`
                  w-full text-left px-3 py-2 text-sm rounded-lg transition-colors
                  ${compare === "previous_period"
                    ? "bg-accent-blue text-white"
                    : "text-text-secondary hover:bg-bg-tertiary"
                  }
                `}
              >
                Previous period
              </button>
              <button
                onClick={() => {
                  onCompareChange("none");
                  setIsCompareOpen(false);
                }}
                className={`
                  w-full text-left px-3 py-2 text-sm rounded-lg transition-colors
                  ${compare === "none"
                    ? "bg-bg-tertiary text-text-primary"
                    : "text-text-tertiary hover:bg-bg-tertiary/50"
                  }
                `}
              >
                No comparison
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
