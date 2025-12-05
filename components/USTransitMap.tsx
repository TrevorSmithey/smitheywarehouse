"use client";

import { useState } from "react";
import type { TransitAnalytics, StateTransitStats } from "@/lib/types";

// Simplified US state paths - optimized for dashboard display
const US_STATES: Record<string, { path: string; name: string }> = {
  AL: { path: "M594,371 L593,395 L591,420 L548,416 L549,367 L594,371Z", name: "Alabama" },
  AK: { path: "M127,485 L172,485 L172,530 L127,530Z", name: "Alaska" },
  AZ: { path: "M205,327 L258,337 L248,414 L177,404 L186,327Z", name: "Arizona" },
  AR: { path: "M510,351 L559,353 L557,397 L508,395Z", name: "Arkansas" },
  CA: { path: "M118,232 L175,248 L186,327 L177,404 L118,384 L93,268Z", name: "California" },
  CO: { path: "M269,268 L347,272 L345,331 L267,327Z", name: "Colorado" },
  CT: { path: "M747,207 L773,202 L777,220 L751,226Z", name: "Connecticut" },
  DE: { path: "M733,256 L745,252 L748,276 L736,280Z", name: "Delaware" },
  FL: { path: "M592,420 L650,420 L695,485 L638,505 L598,450Z", name: "Florida" },
  GA: { path: "M594,371 L649,375 L656,420 L592,420Z", name: "Georgia" },
  HI: { path: "M235,495 L280,495 L280,535 L235,535Z", name: "Hawaii" },
  ID: { path: "M195,115 L240,125 L235,220 L185,210Z", name: "Idaho" },
  IL: { path: "M545,232 L580,235 L583,313 L548,310Z", name: "Illinois" },
  IN: { path: "M580,235 L615,238 L612,303 L578,300Z", name: "Indiana" },
  IA: { path: "M465,212 L535,215 L532,268 L462,265Z", name: "Iowa" },
  KS: { path: "M348,288 L428,290 L426,343 L346,340Z", name: "Kansas" },
  KY: { path: "M575,300 L640,305 L638,340 L573,335Z", name: "Kentucky" },
  LA: { path: "M498,398 L555,400 L560,455 L505,450Z", name: "Louisiana" },
  ME: { path: "M768,95 L795,85 L805,148 L772,165Z", name: "Maine" },
  MD: { path: "M695,260 L745,252 L748,276 L700,285Z", name: "Maryland" },
  MA: { path: "M757,185 L795,178 L798,202 L760,210Z", name: "Massachusetts" },
  MI: { path: "M565,145 L618,140 L625,210 L570,218Z", name: "Michigan" },
  MN: { path: "M445,115 L515,118 L512,195 L442,192Z", name: "Minnesota" },
  MS: { path: "M548,367 L590,370 L588,430 L545,425Z", name: "Mississippi" },
  MO: { path: "M468,270 L540,273 L537,350 L465,347Z", name: "Missouri" },
  MT: { path: "M200,85 L310,92 L305,165 L195,158Z", name: "Montana" },
  NE: { path: "M350,228 L430,232 L428,288 L348,284Z", name: "Nebraska" },
  NV: { path: "M155,185 L205,192 L200,315 L150,305Z", name: "Nevada" },
  NH: { path: "M765,135 L785,130 L788,178 L768,185Z", name: "New Hampshire" },
  NJ: { path: "M735,215 L755,210 L758,262 L738,268Z", name: "New Jersey" },
  NM: { path: "M258,337 L330,342 L325,422 L248,414Z", name: "New Mexico" },
  NY: { path: "M685,145 L760,155 L755,218 L680,208Z", name: "New York" },
  NC: { path: "M638,330 L725,320 L730,355 L645,365Z", name: "North Carolina" },
  ND: { path: "M350,105 L430,108 L428,165 L348,162Z", name: "North Dakota" },
  OH: { path: "M615,225 L660,228 L657,290 L612,287Z", name: "Ohio" },
  OK: { path: "M346,340 L428,343 L435,390 L355,387Z", name: "Oklahoma" },
  OR: { path: "M108,130 L195,140 L190,210 L98,195Z", name: "Oregon" },
  PA: { path: "M660,195 L735,200 L732,252 L657,247Z", name: "Pennsylvania" },
  RI: { path: "M772,195 L788,192 L790,212 L774,215Z", name: "Rhode Island" },
  SC: { path: "M645,355 L695,350 L700,395 L650,400Z", name: "South Carolina" },
  SD: { path: "M350,165 L430,168 L428,228 L348,225Z", name: "South Dakota" },
  TN: { path: "M548,327 L640,322 L638,355 L545,360Z", name: "Tennessee" },
  TX: { path: "M325,370 L435,375 L450,495 L305,485 L295,410Z", name: "Texas" },
  UT: { path: "M220,195 L280,200 L275,295 L215,290Z", name: "Utah" },
  VT: { path: "M752,125 L772,120 L775,165 L755,172Z", name: "Vermont" },
  VA: { path: "M640,285 L725,278 L728,328 L645,335Z", name: "Virginia" },
  WA: { path: "M115,55 L198,62 L195,130 L108,120Z", name: "Washington" },
  WV: { path: "M660,260 L695,255 L698,305 L665,310Z", name: "West Virginia" },
  WI: { path: "M512,135 L565,138 L562,210 L508,207Z", name: "Wisconsin" },
  WY: { path: "M255,162 L340,168 L337,240 L252,234Z", name: "Wyoming" },
};

interface USTransitMapProps {
  analytics: TransitAnalytics[];
  loading?: boolean;
}

export function USTransitMap({ analytics, loading }: USTransitMapProps) {
  const [hoveredState, setHoveredState] = useState<{
    state: string;
    warehouse: string;
    data: StateTransitStats | null;
    x: number;
    y: number;
  } | null>(null);

  // Build lookup maps for each warehouse
  const dataByWarehouse = analytics.reduce((acc, wh) => {
    const stateMap: Record<string, StateTransitStats> = {};
    for (const st of wh.by_state) {
      stateMap[st.state] = st;
    }
    acc[wh.warehouse] = { stateMap, avgDays: wh.avg_transit_days, totalDelivered: wh.total_delivered };
    return acc;
  }, {} as Record<string, { stateMap: Record<string, StateTransitStats>; avgDays: number; totalDelivered: number }>);

  // Color scale: 1-3 days = green, 4-5 = yellow, 6+ = red
  const getColor = (days: number | null, isSmithey: boolean): string => {
    if (days === null) return "#1A1D2A"; // No data
    if (days <= 3) return isSmithey ? "#10B981" : "#059669"; // Green
    if (days <= 5) return "#F59E0B"; // Yellow/Warning
    return "#DC2626"; // Red/Bad
  };

  const getOpacity = (hasData: boolean): number => {
    return hasData ? 0.85 : 0.3;
  };

  const hasData = analytics.some((a) => a.total_delivered > 0);
  if (!hasData && !loading) {
    return (
      <div className="bg-bg-secondary rounded border border-border p-6">
        <h3 className="text-label font-medium text-text-tertiary mb-4">
          TRANSIT TIME BY REGION
        </h3>
        <div className="text-context text-text-muted py-8 text-center">
          No delivery data yet
        </div>
      </div>
    );
  }

  const renderMap = (warehouse: string, isSmithey: boolean) => {
    const data = dataByWarehouse[warehouse];

    return (
      <div className="relative">
        <div className="flex items-center justify-between mb-3">
          <div className={`text-label font-medium ${isSmithey ? "text-accent-blue" : "text-text-tertiary"}`}>
            {warehouse.toUpperCase()}
          </div>
          {data && (
            <div className="text-context text-text-muted">
              Avg: <span className="text-text-primary font-medium">{data.avgDays}d</span>
              <span className="mx-2 text-border">|</span>
              {data.totalDelivered.toLocaleString()} delivered
            </div>
          )}
        </div>
        <svg
          viewBox="70 50 750 500"
          className="w-full h-auto"
          style={{ maxHeight: "280px" }}
        >
          {/* Background */}
          <rect x="70" y="50" width="750" height="500" fill="transparent" />

          {/* State paths */}
          {Object.entries(US_STATES).map(([abbr, { path, name }]) => {
            const stateData = data?.stateMap[abbr];
            const days = stateData?.avg_transit_days ?? null;
            const hasStateData = stateData !== undefined;

            return (
              <path
                key={abbr}
                d={path}
                fill={getColor(days, isSmithey)}
                fillOpacity={getOpacity(hasStateData)}
                stroke="#0B0E1A"
                strokeWidth="1.5"
                className="transition-all duration-200 cursor-pointer"
                style={{
                  filter: hoveredState?.state === abbr && hoveredState?.warehouse === warehouse
                    ? "brightness(1.3)"
                    : "none",
                }}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setHoveredState({
                    state: abbr,
                    warehouse,
                    data: stateData || null,
                    x: rect.left + rect.width / 2,
                    y: rect.top,
                  });
                }}
                onMouseLeave={() => setHoveredState(null)}
              >
                <title>{name}</title>
              </path>
            );
          })}
        </svg>
      </div>
    );
  };

  return (
    <div className="bg-bg-secondary rounded border border-border p-6 transition-all hover:border-border-hover">
      <h3 className="text-label font-medium text-text-tertiary mb-6">
        TRANSIT TIME BY REGION
      </h3>

      {loading ? (
        <div className="h-[280px] flex items-center justify-center text-text-muted text-sm">
          Loading...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {renderMap("smithey", true)}
            {renderMap("selery", false)}
          </div>

          {/* Legend */}
          <div className="flex justify-center items-center gap-6 mt-6 pt-4 border-t border-border-subtle">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-status-good opacity-85" />
              <span className="text-context text-text-muted">1-3 days</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-status-warning opacity-85" />
              <span className="text-context text-text-muted">4-5 days</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-status-bad opacity-85" />
              <span className="text-context text-text-muted">6+ days</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-bg-tertiary opacity-30" />
              <span className="text-context text-text-muted">No data</span>
            </div>
          </div>
        </>
      )}

      {/* Tooltip */}
      {hoveredState && hoveredState.data && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: hoveredState.x,
            top: hoveredState.y - 10,
            transform: "translate(-50%, -100%)",
          }}
        >
          <div className="bg-bg-primary border border-border rounded px-3 py-2 shadow-lg">
            <div className="text-label text-text-secondary mb-1">
              {US_STATES[hoveredState.state]?.name || hoveredState.state}
            </div>
            <div className="text-context">
              <span className="text-text-primary font-medium">
                {hoveredState.data.avg_transit_days}d
              </span>
              <span className="text-text-muted ml-1">avg transit</span>
            </div>
            <div className="text-context text-text-muted">
              {hoveredState.data.shipment_count.toLocaleString()} shipments
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
