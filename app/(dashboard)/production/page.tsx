"use client";

import { AssemblyDashboard } from "@/components/AssemblyDashboard";
import { useProduction } from "./layout";

export default function ProductionPage() {
  const { data, loading, error, refresh } = useProduction();

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
      <AssemblyDashboard
        data={data}
        loading={loading}
        onRefresh={refresh}
      />
    </>
  );
}
