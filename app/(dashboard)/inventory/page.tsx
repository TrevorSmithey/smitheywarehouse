"use client";

import { InventoryDashboard } from "@/components/InventoryDashboard";
import { useInventory } from "./layout";

export default function InventoryPage() {
  const { data, loading, error, expandedCategories, toggleCategory, refresh } = useInventory();

  return (
    <>
      {error && (
        <div className="bg-status-bad/10 border border-status-bad/30 rounded-lg p-4 text-status-bad text-sm mb-4">
          <strong>Error:</strong> {error}
          <button
            onClick={refresh}
            className="ml-4 underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}
      <InventoryDashboard
        inventory={data}
        loading={loading}
        expandedCategories={expandedCategories}
        onToggleCategory={toggleCategory}
        onRefresh={refresh}
      />
    </>
  );
}
