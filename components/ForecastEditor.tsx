"use client";

import { useState, useEffect, useMemo } from "react";
import { X, Save, AlertCircle, Info, Users, Building2, Target, TrendingUp } from "lucide-react";
import type { WholesaleForecast, ForecastCreateInput } from "@/lib/types";
import {
  B2B_SEASONALITY,
  CORP_SEASONALITY,
  DOOR_BENCHMARKS,
  computeQuarterlyTargets,
} from "@/lib/forecasting";

// =============================================================================
// TYPES
// =============================================================================

interface ForecastEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: ForecastCreateInput) => Promise<void>;
  existingForecast?: WholesaleForecast | null;
  currentDoorCount: number; // This should be Jan 1 door count (start of year)
  fiscalYear: number;
  // Historical data for context
  historicalB2BQuarterly?: { q1: number; q2: number; q3: number; q4: number };
  segmentYields?: {
    major: number; // Avg first-year yield for Major segment
    mid: number;   // Avg first-year yield for Mid segment
    small: number; // Avg first-year yield for Small segment
  };
}

// Default segment yields based on historical analysis
const DEFAULT_SEGMENT_YIELDS = {
  major: 25000,  // Major accounts avg ~$25K first year
  mid: 8000,     // Mid accounts avg ~$8K first year
  small: 2500,   // Small accounts avg ~$2.5K first year
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function parseNumericInput(value: string): number {
  // Remove $ and commas, parse as float
  const cleaned = value.replace(/[$,]/g, "");
  return parseFloat(cleaned) || 0;
}

// Format value as currency while typing (strips non-numeric, adds $ and commas)
function formatCurrencyWhileTyping(value: string): string {
  const numericOnly = value.replace(/[^0-9]/g, "");
  if (numericOnly === "") return "";
  const num = parseInt(numericOnly, 10);
  return formatCurrency(num);
}

// Compute dynamic seasonality factor based on remaining months in year
// Accounts for the fact that new doors acquired throughout the remaining period
// will have varying amounts of time to generate revenue
function computeNewDoorSeasonalityFactor(): number {
  const currentMonth = new Date().getMonth() + 1; // 1-12
  const monthsRemaining = 12 - currentMonth + 1;
  // If doors acquired evenly over remaining months:
  // - Door acquired in month M contributes (12 - M + 1) months of revenue
  // - Average contribution = (monthsRemaining + 1) / 2 months out of 12
  return (monthsRemaining + 1) / 2 / 12;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function ForecastEditor({
  isOpen,
  onClose,
  onSave,
  existingForecast,
  currentDoorCount,
  fiscalYear,
  historicalB2BQuarterly,
  segmentYields = DEFAULT_SEGMENT_YIELDS,
}: ForecastEditorProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Revenue targets (annual - quarterly computed from seasonality)
  const [b2bAnnualTarget, setB2bAnnualTarget] = useState("");
  const [corpAnnualTarget, setCorpAnnualTarget] = useState("");

  // Door drivers - Starting doors is READ-ONLY (computed from Jan 1 data)
  const [expectedChurnPct, setExpectedChurnPct] = useState(""); // Stored as %, e.g., "17" = 17%
  const [organicGrowthPct, setOrganicGrowthPct] = useState("");

  // New doors by segment (Major/Mid/Small)
  const [newDoorsMajor, setNewDoorsMajor] = useState("");
  const [newDoorsMid, setNewDoorsMid] = useState("");
  const [newDoorsSmall, setNewDoorsSmall] = useState("");

  // Revision note (required for updates)
  const [revisionNote, setRevisionNote] = useState("");

  // Status
  const [status, setStatus] = useState<"draft" | "active">("draft");

  // Initialize form with existing data
  useEffect(() => {
    // Always reset revision note when forecast changes
    setRevisionNote("");

    if (existingForecast) {
      // Compute annual targets from quarterly
      const b2bTotal =
        (existingForecast.b2b_q1_target || 0) +
        (existingForecast.b2b_q2_target || 0) +
        (existingForecast.b2b_q3_target || 0) +
        (existingForecast.b2b_q4_target || 0);
      const corpTotal =
        (existingForecast.corp_q1_target || 0) +
        (existingForecast.corp_q2_target || 0) +
        (existingForecast.corp_q3_target || 0) +
        (existingForecast.corp_q4_target || 0);

      setB2bAnnualTarget(formatCurrency(b2bTotal));
      setCorpAnnualTarget(formatCurrency(corpTotal));

      // Convert churn doors to percentage
      const startDoors = existingForecast.existing_doors_start || currentDoorCount;
      const churnDoors = existingForecast.expected_churn_doors || 0;
      const churnPct = startDoors > 0 ? Math.round((churnDoors / startDoors) * 100) : DOOR_BENCHMARKS.avgChurnRate * 100;
      setExpectedChurnPct(churnPct.toString());

      setOrganicGrowthPct(
        ((existingForecast.organic_growth_pct || DOOR_BENCHMARKS.sameStoreGrowth) * 100).toString()
      );

      // TODO: Load segment breakdown from database when available
      // For now, distribute existing new_doors_target across segments
      const totalNewDoors = existingForecast.new_doors_target || 0;
      // Default distribution: 10% Major, 30% Mid, 60% Small
      setNewDoorsMajor(Math.round(totalNewDoors * 0.1).toString());
      setNewDoorsMid(Math.round(totalNewDoors * 0.3).toString());
      setNewDoorsSmall(Math.round(totalNewDoors * 0.6).toString());

      setStatus(existingForecast.status === "active" ? "active" : "draft");
    } else {
      // Initialize with defaults
      setExpectedChurnPct((DOOR_BENCHMARKS.avgChurnRate * 100).toString());
      setOrganicGrowthPct((DOOR_BENCHMARKS.sameStoreGrowth * 100).toString());
      setNewDoorsMajor("5");
      setNewDoorsMid("15");
      setNewDoorsSmall("40");
    }
  }, [existingForecast, currentDoorCount]);

  // Computed values
  const computedB2bQuarterly = computeQuarterlyTargets(parseNumericInput(b2bAnnualTarget), B2B_SEASONALITY);
  const computedCorpQuarterly = computeQuarterlyTargets(parseNumericInput(corpAnnualTarget), CORP_SEASONALITY);

  // Total new doors (sum of segments)
  const totalNewDoors = useMemo(() => {
    return (parseInt(newDoorsMajor) || 0) + (parseInt(newDoorsMid) || 0) + (parseInt(newDoorsSmall) || 0);
  }, [newDoorsMajor, newDoorsMid, newDoorsSmall]);

  // Expected churn in doors (computed from percentage)
  const expectedChurnDoors = useMemo(() => {
    const pct = parseFloat(expectedChurnPct) || 0;
    return Math.round(currentDoorCount * (pct / 100));
  }, [currentDoorCount, expectedChurnPct]);

  // Dynamic seasonality factor based on remaining months in year
  // January: ~54% (full year ahead), July: ~29%, December: ~8%
  const newDoorSeasonalityFactor = useMemo(() => computeNewDoorSeasonalityFactor(), []);

  // Implied new door revenue by segment (using dynamic factor)
  const newDoorRevenue = useMemo(() => {
    const major = (parseInt(newDoorsMajor) || 0) * segmentYields.major * newDoorSeasonalityFactor;
    const mid = (parseInt(newDoorsMid) || 0) * segmentYields.mid * newDoorSeasonalityFactor;
    const small = (parseInt(newDoorsSmall) || 0) * segmentYields.small * newDoorSeasonalityFactor;
    return { major, mid, small, total: major + mid + small };
  }, [newDoorsMajor, newDoorsMid, newDoorsSmall, segmentYields, newDoorSeasonalityFactor]);

  // Ending doors
  const endingDoors = currentDoorCount - expectedChurnDoors + totalNewDoors;

  // ==========================================================================
  // PROJECTED REVENUE CALCULATION (Bottom-up math for honesty)
  // ==========================================================================

  // Retained doors (after churn)
  const retainedDoors = currentDoorCount - expectedChurnDoors;

  // Existing door base revenue (retained × avg returning door yield)
  const existingDoorBaseRevenue = useMemo(() => {
    return retainedDoors * DOOR_BENCHMARKS.returningDoorAvgYield;
  }, [retainedDoors]);

  // Organic growth revenue (existing base × growth %)
  const organicGrowthRevenue = useMemo(() => {
    const growthPct = (parseFloat(organicGrowthPct) || 0) / 100;
    return existingDoorBaseRevenue * growthPct;
  }, [existingDoorBaseRevenue, organicGrowthPct]);

  // Total existing door revenue (base + organic growth)
  const existingDoorTotalRevenue = existingDoorBaseRevenue + organicGrowthRevenue;

  // Total projected B2B revenue (existing + new door)
  const projectedB2BRevenue = existingDoorTotalRevenue + newDoorRevenue.total;

  // B2B target for comparison
  const b2bTarget = parseNumericInput(b2bAnnualTarget);

  // Gap to target (positive = shortfall, negative = surplus)
  const gapToTarget = b2bTarget - projectedB2BRevenue;
  const gapPercentage = b2bTarget > 0 ? (gapToTarget / b2bTarget) * 100 : 0;

  // Handle save
  const handleSave = async () => {
    setError(null);
    setSaving(true);

    try {
      // Validate required fields
      const b2bTotal = parseNumericInput(b2bAnnualTarget);

      if (b2bTotal <= 0) {
        throw new Error("B2B annual target is required");
      }

      // For updates, require revision note
      if (existingForecast && !revisionNote.trim()) {
        throw new Error("Please provide a revision note explaining the changes");
      }

      // Compute blended new door yield from segment mix
      const majorDoors = parseInt(newDoorsMajor) || 0;
      const midDoors = parseInt(newDoorsMid) || 0;
      const smallDoors = parseInt(newDoorsSmall) || 0;
      const totalDoors = majorDoors + midDoors + smallDoors;

      // Weighted average yield
      const blendedYield = totalDoors > 0
        ? Math.round(
            (majorDoors * segmentYields.major + midDoors * segmentYields.mid + smallDoors * segmentYields.small) /
              totalDoors
          )
        : DOOR_BENCHMARKS.newDoorFirstYearYield;

      // Build the input
      const input: ForecastCreateInput = {
        fiscal_year: fiscalYear,
        status,
        b2b_q1_target: computedB2bQuarterly.q1,
        b2b_q2_target: computedB2bQuarterly.q2,
        b2b_q3_target: computedB2bQuarterly.q3,
        b2b_q4_target: computedB2bQuarterly.q4,
        corp_q1_target: computedCorpQuarterly.q1,
        corp_q2_target: computedCorpQuarterly.q2,
        corp_q3_target: computedCorpQuarterly.q3,
        corp_q4_target: computedCorpQuarterly.q4,
        existing_doors_start: currentDoorCount, // Always use dynamic value
        new_doors_target: totalDoors,
        expected_churn_doors: expectedChurnDoors,
        organic_growth_pct: (organicGrowthPct !== "" ? parseFloat(organicGrowthPct) : DOOR_BENCHMARKS.sameStoreGrowth * 100) / 100,
        new_door_first_year_yield: blendedYield,
        revision_note: revisionNote.trim() || undefined,
        // Store segment breakdown for future use
        // new_doors_major: majorDoors,
        // new_doors_mid: midDoors,
        // new_doors_small: smallDoors,
      };

      await onSave(input);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save forecast");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-bg-secondary rounded-xl border border-border/30 shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border/30 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">
              {existingForecast ? "Edit Forecast" : "Create Forecast"}
            </h2>
            <p className="text-sm text-text-tertiary">FY{fiscalYear}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-text-muted hover:text-text-primary rounded-lg hover:bg-bg-tertiary"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)] space-y-6">
          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-status-bad/10 border border-status-bad/20 rounded-lg">
              <AlertCircle className="w-4 h-4 text-status-bad flex-shrink-0" />
              <span className="text-sm text-status-bad">{error}</span>
            </div>
          )}

          {/* Revenue Targets */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
              <Target className="w-4 h-4" />
              Revenue Targets
            </h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-text-tertiary mb-1.5 flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  B2B Annual Target
                </label>
                <input
                  type="text"
                  value={b2bAnnualTarget}
                  onChange={(e) => setB2bAnnualTarget(formatCurrencyWhileTyping(e.target.value))}
                  placeholder="e.g., $8,000,000"
                  className="w-full px-3 py-2 bg-bg-tertiary border border-border/30 rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
                />
                {parseNumericInput(b2bAnnualTarget) > 0 && (
                  <div className="mt-1 text-xs text-text-muted">
                    Q1: {formatCompact(computedB2bQuarterly.q1)} • Q2: {formatCompact(computedB2bQuarterly.q2)} • Q3: {formatCompact(computedB2bQuarterly.q3)} • Q4: {formatCompact(computedB2bQuarterly.q4)}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs text-text-tertiary mb-1.5 flex items-center gap-1">
                  <Building2 className="w-3 h-3" />
                  Corporate Annual Target
                </label>
                <input
                  type="text"
                  value={corpAnnualTarget}
                  onChange={(e) => setCorpAnnualTarget(formatCurrencyWhileTyping(e.target.value))}
                  placeholder="e.g., $1,200,000"
                  className="w-full px-3 py-2 bg-bg-tertiary border border-border/30 rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
                />
                {parseNumericInput(corpAnnualTarget) > 0 && (
                  <div className="mt-1 text-xs text-text-muted">
                    Q1: {formatCompact(computedCorpQuarterly.q1)} • Q2: {formatCompact(computedCorpQuarterly.q2)} • Q3: {formatCompact(computedCorpQuarterly.q3)} • Q4: {formatCompact(computedCorpQuarterly.q4)}
                  </div>
                )}
              </div>
            </div>

            {/* Historical B2B quarterly distribution callout */}
            {historicalB2BQuarterly && (() => {
              const total = historicalB2BQuarterly.q1 + historicalB2BQuarterly.q2 + historicalB2BQuarterly.q3 + historicalB2BQuarterly.q4;
              if (total === 0) return null; // Don't show if no historical data
              return (
                <div className="flex items-start gap-2 p-3 bg-bg-tertiary border border-border/30 rounded-lg">
                  <TrendingUp className="w-4 h-4 text-accent-blue flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-text-secondary">
                    <strong className="text-text-primary">Historical B2B Distribution:</strong>{" "}
                    Q1: {formatCompact(historicalB2BQuarterly.q1)} ({Math.round((historicalB2BQuarterly.q1 / total) * 100)}%) •
                    Q2: {formatCompact(historicalB2BQuarterly.q2)} ({Math.round((historicalB2BQuarterly.q2 / total) * 100)}%) •
                    Q3: {formatCompact(historicalB2BQuarterly.q3)} ({Math.round((historicalB2BQuarterly.q3 / total) * 100)}%) •
                    Q4: {formatCompact(historicalB2BQuarterly.q4)} ({Math.round((historicalB2BQuarterly.q4 / total) * 100)}%)
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Door Drivers */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
              <Users className="w-4 h-4" />
              Door Drivers
            </h3>

            {/* Starting Doors (Read-only) and Basic Inputs */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-text-tertiary mb-1.5">
                  Starting Doors (Jan 1)
                </label>
                <div className="w-full px-3 py-2 bg-bg-tertiary/50 border border-border/20 rounded-lg text-text-primary font-medium">
                  {currentDoorCount.toLocaleString()}
                </div>
                <span className="text-[10px] text-text-muted">Dynamic (not editable)</span>
              </div>
              <div>
                <label className="block text-xs text-text-tertiary mb-1.5">
                  Expected Churn %
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="100"
                    value={expectedChurnPct}
                    onChange={(e) => setExpectedChurnPct(e.target.value)}
                    placeholder="17"
                    className="w-full px-3 py-2 pr-8 bg-bg-tertiary border border-border/30 rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted">%</span>
                </div>
                <span className="text-[10px] text-text-muted">= {expectedChurnDoors} doors</span>
              </div>
              <div>
                <label className="block text-xs text-text-tertiary mb-1.5">
                  Organic Growth %
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.1"
                    value={organicGrowthPct}
                    onChange={(e) => setOrganicGrowthPct(e.target.value)}
                    placeholder="11"
                    className="w-full px-3 py-2 pr-8 bg-bg-tertiary border border-border/30 rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted">%</span>
                </div>
                <span className="text-[10px] text-text-muted">Same-store growth</span>
              </div>
            </div>

            {/* New Doors by Segment */}
            <div className="space-y-3">
              <label className="block text-xs text-text-tertiary">
                New Door Targets by Segment
              </label>
              <div className="grid grid-cols-3 gap-4">
                <div className="p-3 bg-bg-tertiary rounded-lg border border-border/30">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-status-good">Major</span>
                    <span className="text-[10px] text-text-muted">≥$20K lifetime</span>
                  </div>
                  <input
                    type="number"
                    min="0"
                    value={newDoorsMajor}
                    onChange={(e) => setNewDoorsMajor(e.target.value)}
                    placeholder="5"
                    className="w-full px-2 py-1.5 bg-bg-primary border border-border/30 rounded text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
                  />
                  <div className="mt-1 text-[10px] text-text-muted">
                    Avg yield: {formatCurrency(segmentYields.major)}
                  </div>
                  {(parseInt(newDoorsMajor) || 0) > 0 && (
                    <div className="mt-1 text-[10px] text-status-good">
                      → {formatCompact(newDoorRevenue.major)} implied
                    </div>
                  )}
                </div>
                <div className="p-3 bg-bg-tertiary rounded-lg border border-border/30">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-status-warning">Mid</span>
                    <span className="text-[10px] text-text-muted">≥$5K lifetime</span>
                  </div>
                  <input
                    type="number"
                    min="0"
                    value={newDoorsMid}
                    onChange={(e) => setNewDoorsMid(e.target.value)}
                    placeholder="15"
                    className="w-full px-2 py-1.5 bg-bg-primary border border-border/30 rounded text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
                  />
                  <div className="mt-1 text-[10px] text-text-muted">
                    Avg yield: {formatCurrency(segmentYields.mid)}
                  </div>
                  {(parseInt(newDoorsMid) || 0) > 0 && (
                    <div className="mt-1 text-[10px] text-status-warning">
                      → {formatCompact(newDoorRevenue.mid)} implied
                    </div>
                  )}
                </div>
                <div className="p-3 bg-bg-tertiary rounded-lg border border-border/30">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-text-secondary">Small</span>
                    <span className="text-[10px] text-text-muted">&lt;$5K lifetime</span>
                  </div>
                  <input
                    type="number"
                    min="0"
                    value={newDoorsSmall}
                    onChange={(e) => setNewDoorsSmall(e.target.value)}
                    placeholder="40"
                    className="w-full px-2 py-1.5 bg-bg-primary border border-border/30 rounded text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
                  />
                  <div className="mt-1 text-[10px] text-text-muted">
                    Avg yield: {formatCurrency(segmentYields.small)}
                  </div>
                  {(parseInt(newDoorsSmall) || 0) > 0 && (
                    <div className="mt-1 text-[10px] text-text-secondary">
                      → {formatCompact(newDoorRevenue.small)} implied
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Summary Calculations - Door Math */}
            <div className="p-4 bg-bg-tertiary/50 rounded-lg border border-border/30 space-y-2">
              <div className="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-2">Door Math</div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-secondary">Starting Doors</span>
                <span className="font-medium text-text-primary">{currentDoorCount}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-secondary">Expected Churn ({expectedChurnPct || 0}%)</span>
                <span className="font-medium text-status-bad">-{expectedChurnDoors}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-secondary">= Retained Doors</span>
                <span className="font-medium text-text-primary">{retainedDoors}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-secondary">+ New Doors</span>
                <span className="font-medium text-status-good">+{totalNewDoors}</span>
              </div>
              <div className="h-px bg-border/30" />
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-secondary font-medium">Ending Doors</span>
                <span className="font-semibold text-text-primary">{endingDoors}</span>
              </div>
            </div>

            {/* Projected Revenue - Bottom-Up Math */}
            <div className="p-4 bg-bg-tertiary/50 rounded-lg border border-border/30 space-y-2">
              <div className="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-2">Projected Revenue (Bottom-Up)</div>

              {/* Existing Door Revenue */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">{retainedDoors} doors × ${DOOR_BENCHMARKS.returningDoorAvgYield.toLocaleString()} avg</span>
                  <span className="font-medium text-text-primary">{formatCompact(existingDoorBaseRevenue)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">+ Organic Growth ({organicGrowthPct || 0}%)</span>
                  <span className="font-medium text-status-good">+{formatCompact(organicGrowthRevenue)}</span>
                </div>
                <div className="flex items-center justify-between text-sm pl-2 border-l-2 border-border/30">
                  <span className="text-text-muted text-xs">Existing Door Total</span>
                  <span className="font-medium text-text-secondary">{formatCompact(existingDoorTotalRevenue)}</span>
                </div>
              </div>

              <div className="h-px bg-border/30" />

              {/* New Door Revenue */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-secondary">+ New Door Revenue ({Math.round(newDoorSeasonalityFactor * 100)}% factor)</span>
                <span className="font-medium text-accent-blue">+{formatCompact(newDoorRevenue.total)}</span>
              </div>

              <div className="h-px bg-border/30" />

              {/* Total Projected */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-primary font-medium">Projected B2B Total</span>
                <span className="font-semibold text-lg text-text-primary">{formatCompact(projectedB2BRevenue)}</span>
              </div>

              {/* Gap to Target */}
              {b2bTarget > 0 && (
                <>
                  <div className="h-px bg-border/30" />
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-secondary">B2B Target</span>
                    <span className="font-medium text-text-primary">{formatCompact(b2bTarget)}</span>
                  </div>
                  <div className={`flex items-center justify-between text-sm p-2 rounded-lg ${
                    gapToTarget > 0
                      ? "bg-status-bad/10 border border-status-bad/20"
                      : gapToTarget < 0
                        ? "bg-status-good/10 border border-status-good/20"
                        : "bg-bg-tertiary"
                  }`}>
                    <span className={`font-medium ${gapToTarget > 0 ? "text-status-bad" : gapToTarget < 0 ? "text-status-good" : "text-text-primary"}`}>
                      {gapToTarget > 0 ? "⚠️ Gap to Target" : gapToTarget < 0 ? "✓ Surplus vs Target" : "On Target"}
                    </span>
                    <span className={`font-semibold ${gapToTarget > 0 ? "text-status-bad" : gapToTarget < 0 ? "text-status-good" : "text-text-primary"}`}>
                      {gapToTarget !== 0 && (
                        <>
                          {gapToTarget > 0 ? "-" : "+"}{formatCompact(Math.abs(gapToTarget))}
                          <span className="text-xs ml-1">({Math.abs(gapPercentage).toFixed(1)}%)</span>
                        </>
                      )}
                    </span>
                  </div>
                  {gapToTarget > 0 && (
                    <div className="text-[10px] text-status-bad/80 mt-1">
                      To close this gap: Need ~{Math.ceil(gapToTarget / (DOOR_BENCHMARKS.newDoorFirstYearYield * newDoorSeasonalityFactor))} more new doors
                      {existingDoorTotalRevenue > 0 && ` or ${((gapToTarget / existingDoorTotalRevenue) * 100).toFixed(1)}% more organic growth`}
                    </div>
                  )}
                </>
              )}

              <div className="text-[10px] text-text-muted mt-2 pt-2 border-t border-border/20">
                * Using ${DOOR_BENCHMARKS.returningDoorAvgYield.toLocaleString()} avg yield for returning doors (historical benchmark)
              </div>
            </div>

            {/* Info callout */}
            <div className="flex items-start gap-2 p-3 bg-accent-blue/10 border border-accent-blue/20 rounded-lg">
              <Info className="w-4 h-4 text-accent-blue flex-shrink-0 mt-0.5" />
              <div className="text-xs text-text-secondary">
                <strong className="text-text-primary">Historical benchmarks:</strong> 83% retention rate (17% churn), 11% same-store growth. Segment yields based on historical averages.
              </div>
            </div>
          </div>

          {/* Status & Revision Note */}
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <label className="text-xs text-text-tertiary">Status:</label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setStatus("draft")}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                    status === "draft"
                      ? "bg-status-warning/20 text-status-warning"
                      : "bg-bg-tertiary text-text-muted hover:text-text-secondary"
                  }`}
                >
                  Draft
                </button>
                <button
                  onClick={() => setStatus("active")}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                    status === "active"
                      ? "bg-status-good/20 text-status-good"
                      : "bg-bg-tertiary text-text-muted hover:text-text-secondary"
                  }`}
                >
                  Active
                </button>
              </div>
            </div>

            {existingForecast && (
              <div>
                <label className="block text-xs text-text-tertiary mb-1.5">
                  Revision Note <span className="text-status-bad">*</span>
                </label>
                <textarea
                  value={revisionNote}
                  onChange={(e) => setRevisionNote(e.target.value)}
                  placeholder="Explain what changed and why..."
                  rows={2}
                  className="w-full px-3 py-2 bg-bg-tertiary border border-border/30 rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue resize-none"
                />
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border/30 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary rounded-lg hover:bg-bg-tertiary transition-colors"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium bg-accent-blue text-white rounded-lg hover:bg-accent-blue/80 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                {existingForecast ? "Save Revision" : "Create Forecast"}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
