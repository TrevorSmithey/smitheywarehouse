"use client";

import { useState, useCallback } from "react";
import { useSales } from "../layout";
import { ForecastDashboard } from "@/components/ForecastDashboard";
import { ForecastEditor } from "@/components/ForecastEditor";
import type { ForecastCreateInput } from "@/lib/types";
import { getAuthHeaders } from "@/lib/auth";

export default function DriverPage() {
  const { forecastData, forecastLoading, forecastError, refreshForecast } = useSales();
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  // Handle opening editor (for both create and edit)
  const handleEdit = useCallback(() => {
    setIsEditorOpen(true);
  }, []);

  const handleEditorClose = useCallback(() => {
    setIsEditorOpen(false);
  }, []);

  // Save handler - calls API and refreshes data
  const handleEditorSave = useCallback(async (data: ForecastCreateInput) => {
    const fiscalYear = forecastData?.forecast?.fiscal_year ?? new Date().getFullYear();

    const res = await fetch("/api/wholesale/forecast", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
      },
      body: JSON.stringify({
        ...data,
        fiscal_year: fiscalYear,
      }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to save forecast");
    }

    // MED-3 FIX: Await refresh BEFORE closing to prevent stale data display
    await refreshForecast();
    setIsEditorOpen(false);
  }, [forecastData?.forecast?.fiscal_year, refreshForecast]);

  // Get current door count for the editor (from stats or forecast)
  const currentDoorCount = forecastData?.stats?.current_doors ??
    forecastData?.forecast?.existing_doors_start ??
    400; // Fallback default

  const fiscalYear = forecastData?.forecast?.fiscal_year ?? new Date().getFullYear();

  return (
    <>
      {/* Main dashboard */}
      <ForecastDashboard
        data={forecastData}
        loading={forecastLoading}
        error={forecastError}
        onRefresh={refreshForecast}
        onEdit={handleEdit}
      />

      {/* Editor modal */}
      <ForecastEditor
        isOpen={isEditorOpen}
        onClose={handleEditorClose}
        onSave={handleEditorSave}
        existingForecast={forecastData?.forecast ?? null}
        currentDoorCount={currentDoorCount}
        fiscalYear={fiscalYear}
      />
    </>
  );
}
