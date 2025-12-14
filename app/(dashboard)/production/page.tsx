"use client";

import { useState, useEffect, useCallback } from "react";
import { AssemblyDashboard } from "@/components/AssemblyDashboard";
import { useDashboard } from "../layout";
import type { AssemblyResponse } from "@/lib/types";

export default function ProductionPage() {
  const { setLastRefresh, setIsRefreshing, setTriggerRefresh } = useDashboard();

  const [data, setData] = useState<AssemblyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAssembly = useCallback(async () => {
    try {
      setLoading(true);
      setIsRefreshing(true);
      setError(null);
      const res = await fetch("/api/assembly");
      if (!res.ok) throw new Error("Failed to fetch assembly data");
      const result: AssemblyResponse = await res.json();
      setData(result);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Assembly fetch error:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch assembly data");
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [setLastRefresh, setIsRefreshing]);

  // Register refresh handler with layout
  useEffect(() => {
    setTriggerRefresh(() => fetchAssembly);
    return () => setTriggerRefresh(null);
  }, [fetchAssembly, setTriggerRefresh]);

  // Initial data fetch
  useEffect(() => {
    if (!data && !loading) {
      fetchAssembly();
    }
  }, [data, loading, fetchAssembly]);

  return (
    <>
      {error && (
        <div className="bg-status-bad/10 border border-status-bad/30 rounded-lg p-4 text-status-bad text-sm mb-4">
          <strong>Error:</strong> {error}
          <button
            onClick={fetchAssembly}
            className="ml-4 underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}
      <AssemblyDashboard
        data={data}
        loading={loading}
        onRefresh={fetchAssembly}
      />
    </>
  );
}
