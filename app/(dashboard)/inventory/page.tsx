"use client";

import { useState, useEffect, useCallback } from "react";
import { InventoryDashboard } from "@/components/InventoryDashboard";
import { useDashboard } from "../layout";
import type { InventoryResponse } from "@/lib/types";

export default function InventoryPage() {
  const { setLastRefresh, setIsRefreshing, setTriggerRefresh } = useDashboard();

  const [inventory, setInventory] = useState<InventoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(["cast_iron", "carbon_steel", "accessory"]) // factory_second collapsed by default
  );

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const fetchInventory = useCallback(async () => {
    try {
      setLoading(true);
      setIsRefreshing(true);
      setError(null);
      const res = await fetch("/api/inventory");
      if (!res.ok) throw new Error("Failed to fetch inventory");
      const data: InventoryResponse = await res.json();
      setInventory(data);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Inventory fetch error:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch inventory");
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [setLastRefresh, setIsRefreshing]);

  // Register refresh handler with layout
  useEffect(() => {
    setTriggerRefresh(() => fetchInventory);
    return () => setTriggerRefresh(null);
  }, [fetchInventory, setTriggerRefresh]);

  // Initial data fetch
  useEffect(() => {
    if (!inventory && !loading) {
      fetchInventory();
    }
  }, [inventory, loading, fetchInventory]);

  return (
    <>
      {error && (
        <div className="bg-status-bad/10 border border-status-bad/30 rounded-lg p-4 text-status-bad text-sm mb-4">
          <strong>Error:</strong> {error}
          <button
            onClick={fetchInventory}
            className="ml-4 underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}
      <InventoryDashboard
        inventory={inventory}
        loading={loading}
        expandedCategories={expandedCategories}
        onToggleCategory={toggleCategory}
        onRefresh={fetchInventory}
      />
    </>
  );
}
