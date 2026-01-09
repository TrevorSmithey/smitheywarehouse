"use client";

import { useState, useCallback } from "react";
import {
  X,
  Search,
  CheckCircle,
  AlertCircle,
  Package,
  Loader2,
  Hash,
} from "lucide-react";
import type { RestorationRecord } from "@/app/api/restorations/route";

interface RestorationCheckInProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  restorations: RestorationRecord[];
}

export function RestorationCheckIn({
  isOpen,
  onClose,
  onSuccess,
  restorations,
}: RestorationCheckInProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedItem, setSelectedItem] = useState<RestorationRecord | null>(null);
  const [magnetNumber, setMagnetNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Filter to delivered_warehouse items only
  const eligibleItems = restorations.filter((r) => r.status === "delivered_warehouse");

  // Search filter
  const filteredItems = searchTerm
    ? eligibleItems.filter(
        (r) =>
          r.order_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          r.rma_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          r.return_tracking_number?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : eligibleItems;

  const handleSubmit = useCallback(async () => {
    if (!selectedItem) return;
    if (!magnetNumber.trim()) {
      setError("Magnet number is required");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/restorations/${selectedItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "received",
          magnet_number: magnetNumber.trim(),
          notes: notes.trim() || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to check in item");
      }

      setSuccess(true);
      setTimeout(() => {
        // Reset form
        setSelectedItem(null);
        setMagnetNumber("");
        setNotes("");
        setSearchTerm("");
        setSuccess(false);
        onSuccess();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to check in item");
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedItem, magnetNumber, notes, onSuccess]);

  const handleClose = useCallback(() => {
    setSelectedItem(null);
    setMagnetNumber("");
    setNotes("");
    setSearchTerm("");
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
            Check In Restoration
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
              <p className="text-lg text-text-primary font-medium">Checked In!</p>
              <p className="text-sm text-text-secondary mt-1">
                {selectedItem?.order_name} with magnet #{magnetNumber}
              </p>
            </div>
          ) : !selectedItem ? (
            <>
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                <input
                  type="text"
                  placeholder="Search by order #, RMA, or tracking..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 text-sm bg-bg-primary border border-border rounded-lg
                    text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-blue"
                  autoFocus
                />
              </div>

              {/* Items List */}
              <div className="max-h-64 overflow-y-auto scrollbar-thin space-y-1">
                {filteredItems.length === 0 ? (
                  <p className="text-center text-text-tertiary text-sm py-8">
                    {searchTerm
                      ? "No items match your search"
                      : "No items waiting for check-in"}
                  </p>
                ) : (
                  filteredItems.slice(0, 20).map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setSelectedItem(item)}
                      className="w-full flex items-center justify-between p-3 rounded-lg
                        hover:bg-white/5 transition-colors text-left"
                    >
                      <div>
                        <p className="text-sm text-text-primary font-medium">
                          {item.order_name || item.rma_number}
                        </p>
                        {item.return_tracking_number && (
                          <p className="text-xs text-text-tertiary">
                            {item.return_tracking_number}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-text-tertiary">
                        <span className="text-xs">{item.days_in_status}d waiting</span>
                        <Package className="w-4 h-4" />
                      </div>
                    </button>
                  ))
                )}
              </div>

              {filteredItems.length > 20 && (
                <p className="text-xs text-text-tertiary text-center">
                  Showing first 20 of {filteredItems.length} items. Use search to narrow down.
                </p>
              )}
            </>
          ) : (
            <>
              {/* Selected Item Details */}
              <div className="bg-bg-primary rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-lg text-text-primary font-semibold">
                      {selectedItem.order_name || selectedItem.rma_number}
                    </p>
                    {selectedItem.rma_number && selectedItem.order_name && (
                      <p className="text-sm text-text-secondary">
                        RMA: {selectedItem.rma_number}
                      </p>
                    )}
                    {selectedItem.return_tracking_number && (
                      <p className="text-sm text-text-tertiary mt-1">
                        Tracking: {selectedItem.return_tracking_number}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => setSelectedItem(null)}
                    className="text-xs text-accent-blue hover:underline"
                  >
                    Change
                  </button>
                </div>
                <div className="mt-2 pt-2 border-t border-border/50 text-xs text-text-tertiary">
                  Delivered {selectedItem.days_in_status} days ago
                </div>
              </div>

              {/* Magnet Number Input */}
              <div>
                <label className="block text-sm text-text-secondary mb-1.5">
                  Magnet Number <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                  <input
                    type="text"
                    value={magnetNumber}
                    onChange={(e) => setMagnetNumber(e.target.value.toUpperCase())}
                    placeholder="Enter magnet number (e.g., A1, B2)"
                    className="w-full pl-9 pr-4 py-2.5 text-sm bg-bg-primary border border-border rounded-lg
                      text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-blue"
                    autoFocus
                  />
                </div>
              </div>

              {/* Notes Input */}
              <div>
                <label className="block text-sm text-text-secondary mb-1.5">
                  Notes (optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any notes about the item condition, etc."
                  rows={2}
                  className="w-full px-4 py-2.5 text-sm bg-bg-primary border border-border rounded-lg
                    text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-blue
                    resize-none"
                />
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
                disabled={isSubmitting || !magnetNumber.trim()}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-600/50
                  text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Checking In...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    Check In Item
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
