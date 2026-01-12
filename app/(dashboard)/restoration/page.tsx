"use client";

import { useRestoration } from "./layout";
import { RestorationOperations } from "@/components/restorations/RestorationOperations";

export default function RestorationPage() {
  const { data, loading, error, refresh, openRestoration } = useRestoration();

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
      <RestorationOperations
        data={data}
        loading={loading}
        onRefresh={refresh}
        onCardClick={openRestoration}
      />
    </>
  );
}
