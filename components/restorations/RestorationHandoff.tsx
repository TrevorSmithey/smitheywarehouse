"use client";

import { useState, useCallback } from "react";
import {
  X,
  ArrowRight,
  CheckCircle,
  AlertCircle,
  Loader2,
  Package,
  Wrench,
} from "lucide-react";
import type { RestorationRecord } from "@/app/api/restorations/route";
import { getAuthHeaders } from "@/lib/auth";

type HandoffType = "to_restoration" | "from_restoration";

interface RestorationHandoffProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  restorations: RestorationRecord[];
  handoffType: HandoffType;
}

const HANDOFF_CONFIG: Record<HandoffType, {
  title: string;
  sourceStatus: string;
  targetStatus: string;
  sourceLabel: string;
  targetLabel: string;
  buttonLabel: string;
  buttonColor: string;
}> = {
  to_restoration: {
    title: "Send to Restoration",
    sourceStatus: "received",
    targetStatus: "at_restoration",
    sourceLabel: "Received",
    targetLabel: "At Restoration",
    buttonLabel: "Send to Restoration",
    buttonColor: "bg-purple-600 hover:bg-purple-700",
  },
  from_restoration: {
    title: "Back from Restoration",
    sourceStatus: "at_restoration",
    targetStatus: "ready_to_ship",
    sourceLabel: "At Restoration",
    targetLabel: "Ready to Ship",
    buttonLabel: "Mark Ready to Ship",
    buttonColor: "bg-blue-600 hover:bg-blue-700",
  },
};

export function RestorationHandoff({
  isOpen,
  onClose,
  onSuccess,
  restorations,
  handoffType,
}: RestorationHandoffProps) {
  const config = HANDOFF_CONFIG[handoffType];

  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);

  // Filter to eligible items
  const eligibleItems = restorations.filter((r) => r.status === config.sourceStatus);

  const toggleItem = useCallback((id: number) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedItems(new Set(eligibleItems.map((r) => r.id)));
  }, [eligibleItems]);

  const clearSelection = useCallback(() => {
    setSelectedItems(new Set());
  }, []);

  const handleSubmit = useCallback(async () => {
    if (selectedItems.size === 0) return;

    setIsSubmitting(true);
    setError(null);
    setProcessedCount(0);

    let successCount = 0;
    const errors: string[] = [];

    // Process each selected item
    for (const itemId of selectedItems) {
      try {
        const response = await fetch(`/api/restorations/${itemId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ status: config.targetStatus }),
        });

        if (response.ok) {
          successCount++;
          setProcessedCount(successCount);
        } else {
          const data = await response.json();
          errors.push(`#${itemId}: ${data.error}`);
        }
      } catch (err) {
        errors.push(`#${itemId}: Network error`);
      }
    }

    if (errors.length > 0) {
      setError(`${successCount} succeeded, ${errors.length} failed: ${errors[0]}`);
    }

    if (successCount > 0) {
      setSuccess(true);
      setTimeout(() => {
        setSelectedItems(new Set());
        setSuccess(false);
        onSuccess();
      }, 1500);
    } else {
      setIsSubmitting(false);
    }
  }, [selectedItems, config.targetStatus, onSuccess]);

  const handleClose = useCallback(() => {
    setSelectedItems(new Set());
    setError(null);
    setSuccess(false);
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-bg-secondary rounded-lg w-full max-w-lg shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary uppercase tracking-wider">
            {config.title}
          </h2>
          <button
            onClick={handleClose}
            className="p-1 text-text-tertiary hover:text-text-secondary"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {success ? (
            <div className="flex flex-col items-center justify-center py-8">
              <CheckCircle className="w-12 h-12 text-emerald-400 mb-3" />
              <p className="text-lg text-text-primary font-medium">
                {processedCount} item{processedCount !== 1 ? "s" : ""} updated!
              </p>
              <p className="text-sm text-text-secondary mt-1">
                Moved to {config.targetLabel}
              </p>
            </div>
          ) : (
            <>
              {/* Transition Indicator */}
              <div className="flex items-center justify-center gap-3 py-3 bg-bg-primary rounded-lg">
                <span className="text-sm text-text-secondary">{config.sourceLabel}</span>
                <ArrowRight className="w-5 h-5 text-accent-blue" />
                <span className="text-sm text-text-primary font-medium">{config.targetLabel}</span>
              </div>

              {/* Selection Controls */}
              {eligibleItems.length > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">
                    {selectedItems.size} of {eligibleItems.length} selected
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={selectAll}
                      className="text-accent-blue hover:underline"
                    >
                      Select All
                    </button>
                    {selectedItems.size > 0 && (
                      <button
                        onClick={clearSelection}
                        className="text-text-tertiary hover:text-text-secondary"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Items List */}
              <div className="max-h-64 overflow-y-auto scrollbar-thin space-y-1">
                {eligibleItems.length === 0 ? (
                  <p className="text-center text-text-tertiary text-sm py-8">
                    No items in {config.sourceLabel} status
                  </p>
                ) : (
                  eligibleItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => toggleItem(item.id)}
                      className={`w-full flex items-center justify-between p-3 rounded-lg
                        transition-colors text-left ${
                          selectedItems.has(item.id)
                            ? "bg-accent-blue/20 border border-accent-blue/40"
                            : "hover:bg-white/5 border border-transparent"
                        }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-5 h-5 rounded border flex items-center justify-center ${
                            selectedItems.has(item.id)
                              ? "bg-accent-blue border-accent-blue"
                              : "border-border"
                          }`}
                        >
                          {selectedItems.has(item.id) && (
                            <CheckCircle className="w-3.5 h-3.5 text-white" />
                          )}
                        </div>
                        <div>
                          <p className="text-sm text-text-primary font-medium">
                            {item.order_name || item.rma_number}
                          </p>
                          {item.magnet_number && (
                            <p className="text-xs text-text-tertiary">
                              Magnet: {item.magnet_number}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-text-tertiary">
                        {item.days_in_status}d
                      </div>
                    </button>
                  ))
                )}
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}

              {/* Submit Button */}
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || selectedItems.size === 0}
                className={`w-full py-3 ${config.buttonColor} disabled:opacity-50
                  text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2`}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing {processedCount}/{selectedItems.size}...
                  </>
                ) : handoffType === "to_restoration" ? (
                  <>
                    <Wrench className="w-4 h-4" />
                    {config.buttonLabel} ({selectedItems.size})
                  </>
                ) : (
                  <>
                    <Package className="w-4 h-4" />
                    {config.buttonLabel} ({selectedItems.size})
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
