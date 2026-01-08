"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  X,
  ExternalLink,
  Clock,
  Calendar,
  Tag,
  FileText,
  Save,
  Loader2,
  Truck,
  Camera,
  Trash2,
  ChevronRight,
  ChevronDown,
  CheckCircle,
  Package,
  Wrench,
} from "lucide-react";
import type { RestorationRecord } from "@/app/api/restorations/route";
import { createClient } from "@/lib/supabase/client";

// =============================================================================
// SECURITY UTILITIES
// =============================================================================

/**
 * Validates that a URL is a safe Supabase storage URL for restoration photos.
 * Prevents XSS attacks from malicious URLs stored in the database.
 */
function isValidPhotoUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;

  try {
    const parsed = new URL(url);
    // Only allow Supabase storage URLs from our project
    const validHosts = [
      "rpfkpxoyucocriifutfy.supabase.co",
      // Add any CDN domains if used
    ];
    return (
      validHosts.includes(parsed.hostname) &&
      parsed.pathname.includes("/restoration-photos/") &&
      parsed.protocol === "https:"
    );
  } catch {
    return false;
  }
}

interface RestorationDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  restoration: RestorationRecord | null;
  onSave: () => void;
}

// Stage configuration for display
const STAGE_CONFIG: Record<string, { label: string; color: string; bgColor: string; borderColor: string }> = {
  pending_label: { label: "Pending Label", color: "text-slate-400", bgColor: "bg-slate-500/20", borderColor: "border-slate-500" },
  label_sent: { label: "Label Sent", color: "text-amber-400", bgColor: "bg-amber-500/20", borderColor: "border-amber-500" },
  in_transit_inbound: { label: "In Transit", color: "text-sky-400", bgColor: "bg-sky-500/20", borderColor: "border-sky-500" },
  delivered_warehouse: { label: "Delivered", color: "text-orange-400", bgColor: "bg-orange-500/20", borderColor: "border-orange-500" },
  received: { label: "Received", color: "text-emerald-400", bgColor: "bg-emerald-500/20", borderColor: "border-emerald-500" },
  at_restoration: { label: "At Restoration", color: "text-purple-400", bgColor: "bg-purple-500/20", borderColor: "border-purple-500" },
  ready_to_ship: { label: "Ready to Ship", color: "text-blue-400", bgColor: "bg-blue-500/20", borderColor: "border-blue-500" },
  shipped: { label: "Shipped", color: "text-cyan-400", bgColor: "bg-cyan-500/20", borderColor: "border-cyan-500" },
  delivered: { label: "Delivered", color: "text-green-400", bgColor: "bg-green-500/20", borderColor: "border-green-500" },
  cancelled: { label: "Cancelled", color: "text-red-400", bgColor: "bg-red-500/20", borderColor: "border-red-500" },
};

// Status advancement configuration
const STATUS_ADVANCE: Record<string, { nextStatus: string; label: string; icon: React.ElementType; bgClass: string }> = {
  delivered_warehouse: {
    nextStatus: "received",
    label: "Check In",
    icon: CheckCircle,
    bgClass: "bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700",
  },
  received: {
    nextStatus: "at_restoration",
    label: "Send to Restoration",
    icon: Package,
    bgClass: "bg-purple-500 hover:bg-purple-600 active:bg-purple-700",
  },
  at_restoration: {
    nextStatus: "ready_to_ship",
    label: "Mark Ready to Ship",
    icon: Wrench,
    bgClass: "bg-blue-500 hover:bg-blue-600 active:bg-blue-700",
  },
};

// Valid status transitions (mirrors API validation)
const VALID_TRANSITIONS: Record<string, string[]> = {
  pending_label: ["label_sent", "cancelled"],
  label_sent: ["in_transit_inbound", "cancelled"],
  in_transit_inbound: ["delivered_warehouse", "cancelled"],
  delivered_warehouse: ["received", "cancelled"],
  received: ["at_restoration", "cancelled"],
  at_restoration: ["ready_to_ship", "cancelled"],
  ready_to_ship: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [], // Terminal state
  cancelled: [], // Terminal state
};

// All statuses with labels for display
const STATUS_LABELS: Record<string, string> = {
  pending_label: "Pending Label",
  label_sent: "Label Sent",
  in_transit_inbound: "In Transit",
  delivered_warehouse: "Delivered to Warehouse",
  received: "Received",
  at_restoration: "At Restoration",
  ready_to_ship: "Ready to Ship",
  shipped: "Shipped",
  delivered: "Delivered to Customer",
  cancelled: "Cancelled",
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Compress an image file using canvas
 * - Resizes to max 1200px on longest side
 * - Converts to JPEG at 0.8 quality
 * - Reduces iPad photos from ~3MB to ~200-400KB
 * - Supports AbortSignal for cancellation (prevents memory leaks on unmount)
 */
async function compressImage(
  file: File,
  maxDimension = 1200,
  quality = 0.8,
  signal?: AbortSignal
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // Check if already aborted before starting
    if (signal?.aborted) {
      reject(new DOMException("Compression aborted", "AbortError"));
      return;
    }

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    // Cleanup function to revoke URL and remove listeners
    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      img.onload = null;
      img.onerror = null;
    };

    // Handle abort signal
    const abortHandler = () => {
      cleanup();
      reject(new DOMException("Compression aborted", "AbortError"));
    };

    signal?.addEventListener("abort", abortHandler, { once: true });

    img.onload = () => {
      signal?.removeEventListener("abort", abortHandler);

      // Check if aborted during load
      if (signal?.aborted) {
        cleanup();
        reject(new DOMException("Compression aborted", "AbortError"));
        return;
      }

      // Clean up object URL to prevent memory leak
      URL.revokeObjectURL(objectUrl);

      // Calculate new dimensions maintaining aspect ratio
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height / width) * maxDimension);
          width = maxDimension;
        } else {
          width = Math.round((width / height) * maxDimension);
          height = maxDimension;
        }
      }

      // Draw to canvas
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Failed to get canvas context"));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);

      // Export as JPEG
      canvas.toBlob(
        (blob) => {
          if (signal?.aborted) {
            reject(new DOMException("Compression aborted", "AbortError"));
            return;
          }
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Compression failed"));
          }
        },
        "image/jpeg",
        quality
      );
    };

    img.onerror = () => {
      signal?.removeEventListener("abort", abortHandler);
      cleanup();
      reject(new Error("Failed to load image"));
    };

    img.src = objectUrl;
  });
}

const MAX_PHOTOS = 3;

export function RestorationDetailModal({
  isOpen,
  onClose,
  restoration,
  onSave,
}: RestorationDetailModalProps) {
  const [notes, setNotes] = useState("");
  const [magnetNumber, setMagnetNumber] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set());

  // Refs for async operation safety
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMountedRef = useRef(true);
  const uploadAbortControllerRef = useRef<AbortController | null>(null);

  // Track mount state to prevent state updates after unmount
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      // Abort any pending uploads on unmount
      uploadAbortControllerRef.current?.abort();
      // Clear file input reference
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    };
  }, []);

  // Reset form when restoration changes
  useEffect(() => {
    if (restoration) {
      setNotes(restoration.notes || "");
      setMagnetNumber(restoration.magnet_number || "");
      // Filter to only valid photo URLs for security
      setPhotos((restoration.photos || []).filter(isValidPhotoUrl));
      setHasChanges(false);
      setShowStatusDropdown(false);
      setLoadedImages(new Set()); // Reset loaded images tracking
    }
  }, [restoration]);

  // Track changes
  useEffect(() => {
    if (restoration) {
      const notesChanged = notes !== (restoration.notes || "");
      const magnetChanged = magnetNumber !== (restoration.magnet_number || "");
      const photosChanged = JSON.stringify(photos) !== JSON.stringify(restoration.photos || []);
      setHasChanges(notesChanged || magnetChanged || photosChanged);
    }
  }, [notes, magnetNumber, photos, restoration]);

  if (!isOpen || !restoration) return null;

  const config = STAGE_CONFIG[restoration.status] || {
    label: restoration.status,
    color: "text-text-secondary",
    bgColor: "bg-bg-tertiary",
    borderColor: "border-border",
  };

  const advanceConfig = STATUS_ADVANCE[restoration.status];
  const AdvanceIcon = advanceConfig?.icon;

  const handlePhotoUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !restoration) return;

    const remainingSlots = MAX_PHOTOS - photos.length;
    if (remainingSlots <= 0) {
      alert("Maximum 3 photos allowed");
      return;
    }

    // Create new AbortController for this upload session
    uploadAbortControllerRef.current?.abort(); // Cancel any previous pending upload
    const abortController = new AbortController();
    uploadAbortControllerRef.current = abortController;

    setUploading(true);
    const supabase = createClient();

    try {
      const filesToUpload = Array.from(files).slice(0, remainingSlots);
      const newPhotoUrls: string[] = [];

      for (const file of filesToUpload) {
        // Check if aborted or unmounted before each file
        if (abortController.signal.aborted || !isMountedRef.current) {
          break;
        }

        // Validate file type (be lenient for iOS camera output including HEIC)
        if (!file.type.match(/^image\//)) {
          console.warn(`Skipping non-image file: ${file.type}`);
          continue;
        }

        try {
          // Compress image before upload (converts to JPEG, resizes to max 1200px)
          const compressedBlob = await compressImage(file, 1200, 0.8, abortController.signal);

          // Check again after compression
          if (abortController.signal.aborted || !isMountedRef.current) {
            break;
          }

          // Always use .jpg extension since compression converts to JPEG
          const filename = `${restoration.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;

          const { data, error } = await supabase.storage
            .from("restoration-photos")
            .upload(filename, compressedBlob, {
              cacheControl: "3600",
              upsert: false,
              contentType: "image/jpeg",
            });

          if (error) {
            console.error("Upload error:", error);
            continue;
          }

          const { data: urlData } = supabase.storage
            .from("restoration-photos")
            .getPublicUrl(data.path);

          // Only add if it's a valid URL (security check)
          if (isValidPhotoUrl(urlData.publicUrl)) {
            newPhotoUrls.push(urlData.publicUrl);
          }
        } catch (compressionError) {
          // If aborted, don't log as error
          if (compressionError instanceof DOMException && compressionError.name === "AbortError") {
            break;
          }

          console.error("Compression error, uploading original:", compressionError);
          // Fallback: upload original file if compression fails
          const ext = file.name.split(".").pop() || "jpg";
          const filename = `${restoration.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

          const { data, error } = await supabase.storage
            .from("restoration-photos")
            .upload(filename, file, {
              cacheControl: "3600",
              upsert: false,
            });

          if (!error && data) {
            const { data: urlData } = supabase.storage
              .from("restoration-photos")
              .getPublicUrl(data.path);
            // Only add if it's a valid URL (security check)
            if (isValidPhotoUrl(urlData.publicUrl)) {
              newPhotoUrls.push(urlData.publicUrl);
            }
          }
        }
      }

      // Only update state if still mounted and not aborted
      if (isMountedRef.current && !abortController.signal.aborted && newPhotoUrls.length > 0) {
        setPhotos((prev) => [...prev, ...newPhotoUrls].slice(0, MAX_PHOTOS));
      }
    } catch (error) {
      // Only show error if not aborted and still mounted
      if (isMountedRef.current && !(error instanceof DOMException && (error as DOMException).name === "AbortError")) {
        console.error("Error uploading photos:", error);
        alert("Failed to upload photos. Please try again.");
      }
    } finally {
      // Only update state if still mounted
      if (isMountedRef.current) {
        setUploading(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    }
  }, [photos.length, restoration]);

  const handleRemovePhoto = async (photoUrl: string) => {
    // Update UI immediately for responsiveness
    setPhotos((prev) => prev.filter((p) => p !== photoUrl));
    setLoadedImages((prev) => {
      const next = new Set(prev);
      next.delete(photoUrl);
      return next;
    });

    // Storage cleanup with retry logic (background, doesn't block UI)
    const supabase = createClient();
    const urlParts = photoUrl.split("/restoration-photos/");
    if (urlParts.length !== 2) return;

    const filePath = urlParts[1];
    const maxRetries = 3;
    const baseDelayMs = 1000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const { error } = await supabase.storage.from("restoration-photos").remove([filePath]);
        if (!error) {
          return; // Success
        }
        console.warn(`Storage delete attempt ${attempt} failed:`, error.message);
      } catch (error) {
        console.warn(`Storage delete attempt ${attempt} error:`, error);
      }

      // Exponential backoff before retry
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * Math.pow(2, attempt - 1)));
      }
    }

    // All retries failed - log but don't alert user (storage cleanup isn't critical to their workflow)
    console.error(`Failed to delete photo from storage after ${maxRetries} attempts: ${filePath}`);
  };

  // Save changes without advancing status
  const handleSave = async () => {
    if (!hasChanges) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/restorations/${restoration.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: notes || null,
          magnet_number: magnetNumber || null,
          photos: photos,
        }),
      });

      if (!res.ok) throw new Error("Failed to save");

      setHasChanges(false);
      onSave();
    } catch (error) {
      console.error("Error saving restoration:", error);
      alert("Failed to save changes. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // Save AND advance status in one action
  const handleAdvanceStatus = async () => {
    if (!advanceConfig) return;

    setAdvancing(true);
    try {
      const res = await fetch(`/api/restorations/${restoration.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: advanceConfig.nextStatus,
          notes: notes || null,
          magnet_number: magnetNumber || null,
          photos: photos,
        }),
      });

      if (!res.ok) throw new Error("Failed to advance status");

      setHasChanges(false);
      onSave();
    } catch (error) {
      console.error("Error advancing status:", error);
      alert("Failed to advance status. Please try again.");
    } finally {
      setAdvancing(false);
    }
  };

  // Manual status change
  const handleManualStatusChange = async (newStatus: string) => {
    if (newStatus === restoration.status) {
      setShowStatusDropdown(false);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/restorations/${restoration.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: newStatus,
          notes: notes || null,
          magnet_number: magnetNumber || null,
          photos: photos,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to change status");
      }

      setHasChanges(false);
      setShowStatusDropdown(false);
      onSave();
    } catch (error) {
      console.error("Error changing status:", error);
      alert(error instanceof Error ? error.message : "Failed to change status");
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (hasChanges) {
      if (!confirm("You have unsaved changes. Discard them?")) {
        return;
      }
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="restoration-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Modal - optimized for iPad */}
      <div className="relative bg-bg-primary border border-border rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* ================================================================ */}
        {/* HEADER - Status Badge + Close */}
        {/* ================================================================ */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            {/* Status Badge - Tappable for manual override */}
            <button
              onClick={() => setShowStatusDropdown(!showStatusDropdown)}
              aria-expanded={showStatusDropdown}
              aria-haspopup="listbox"
              aria-label={`Current status: ${config.label}. Tap to change status`}
              className={`inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider px-3 py-2 rounded-lg ${config.bgColor} ${config.color} min-h-[44px] active:opacity-80 transition-opacity`}
            >
              <span className="w-2 h-2 rounded-full bg-current" aria-hidden="true" />
              {config.label}
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showStatusDropdown ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>
            {restoration.is_pos && (
              <span className="text-[10px] px-2 py-1 bg-purple-500/30 text-purple-300 rounded font-semibold" aria-label="Point of Sale order">
                POS
              </span>
            )}
          </div>
          {/* Close Button - 44px touch target */}
          <button
            onClick={handleClose}
            type="button"
            aria-label="Close restoration details"
            className="p-2.5 text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary rounded-xl transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Status Dropdown (shown when badge is tapped) */}
        {showStatusDropdown && (
          <>
            {/* Backdrop - closes dropdown when clicked outside */}
            <div
              className="fixed inset-0 z-[5]"
              onClick={() => setShowStatusDropdown(false)}
              aria-hidden="true"
            />
            <div
              role="listbox"
              aria-label="Status options"
              className="absolute top-[72px] left-5 z-10 bg-bg-primary border border-border rounded-xl shadow-xl py-2 min-w-[220px] max-h-[300px] overflow-y-auto"
            >
              {/* Current status - always shown first */}
              <div className="px-4 py-3 text-sm text-text-tertiary border-b border-border/50 mb-1">
                Current: <span className="font-medium text-text-primary">{STATUS_LABELS[restoration.status]}</span>
              </div>

              {/* Valid next statuses */}
              {(VALID_TRANSITIONS[restoration.status] || []).length > 0 ? (
                <>
                  <div className="px-4 py-1 text-xs text-text-muted uppercase tracking-wider" id="status-dropdown-label">
                    Move to
                  </div>
                  {(VALID_TRANSITIONS[restoration.status] || []).map((statusValue) => (
                    <button
                      key={statusValue}
                      role="option"
                      aria-selected={false}
                      onClick={() => handleManualStatusChange(statusValue)}
                      disabled={saving}
                      className="w-full text-left px-4 py-3 text-sm text-text-primary hover:bg-bg-secondary transition-colors min-h-[44px]"
                    >
                      {STATUS_LABELS[statusValue]}
                    </button>
                  ))}
                </>
              ) : (
                <div className="px-4 py-3 text-sm text-text-muted italic">
                  No available transitions
                </div>
              )}
            </div>
          </>
        )}

        {/* ================================================================ */}
        {/* CONTENT - Scrollable */}
        {/* ================================================================ */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {/* ============================================================ */}
          {/* SECTION 1: HEROES - Order # + Internal ID */}
          {/* ============================================================ */}
          <div className="space-y-4">
            {/* Order Number - THE HERO */}
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs text-text-tertiary uppercase tracking-wider mb-1">
                  Order Number
                </div>
                <h2
                  id="restoration-modal-title"
                  className="text-2xl font-bold text-text-primary tracking-tight"
                >
                  {restoration.order_name || `#${restoration.id}`}
                </h2>
              </div>
              {restoration.shopify_order_id && (
                <a
                  href={`https://admin.shopify.com/store/smithey-iron-ware/orders/${restoration.shopify_order_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="View order in Shopify admin (opens in new tab)"
                  className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-accent-blue transition-colors p-2 -m-2 min-h-[44px]"
                >
                  Shopify
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                </a>
              )}
            </div>

            {/* Internal ID (Magnet #) - Editable Hero */}
            <div>
              <label htmlFor="magnet-number-input" className="flex items-center gap-2 text-xs text-text-tertiary uppercase tracking-wider mb-2">
                <Tag className="w-3.5 h-3.5" aria-hidden="true" />
                Internal ID (Magnet #)
              </label>
              <input
                id="magnet-number-input"
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                value={magnetNumber}
                onChange={(e) => setMagnetNumber(e.target.value.toUpperCase())}
                placeholder="e.g., M-042"
                className="w-full px-4 py-4 text-lg font-semibold bg-bg-secondary border-2 border-border rounded-xl
                  text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-blue
                  transition-colors min-h-[56px]"
              />
            </div>

            {/* Key Metrics Row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-bg-secondary rounded-xl p-4 border border-border">
                <div className="flex items-center gap-2 text-text-tertiary text-xs mb-1">
                  <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>In Stage</span>
                </div>
                <div
                  className={`text-2xl font-bold tabular-nums ${
                    restoration.days_in_status <= 3
                      ? "text-emerald-400"
                      : restoration.days_in_status <= 7
                      ? "text-amber-400"
                      : "text-red-400"
                  }`}
                >
                  {restoration.days_in_status}d
                </div>
              </div>
              <div className="bg-bg-secondary rounded-xl p-4 border border-border">
                <div className="flex items-center gap-2 text-text-tertiary text-xs mb-1">
                  <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Total Time</span>
                </div>
                <div
                  className={`text-2xl font-bold tabular-nums ${
                    restoration.total_days <= 14
                      ? "text-emerald-400"
                      : restoration.total_days <= 21
                      ? "text-amber-400"
                      : "text-red-400"
                  }`}
                >
                  {restoration.total_days}d
                </div>
              </div>
            </div>
          </div>

          {/* ============================================================ */}
          {/* SECTION 2: NOTES + PHOTOS */}
          {/* ============================================================ */}
          <div className="space-y-4 pt-2 border-t border-border/50">
            {/* Notes */}
            <div>
              <label htmlFor="restoration-notes" className="flex items-center gap-2 text-xs text-text-tertiary uppercase tracking-wider mb-2">
                <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                Notes
              </label>
              <textarea
                id="restoration-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any notes about this restoration..."
                rows={3}
                className="w-full px-4 py-4 text-sm bg-bg-secondary border border-border rounded-xl
                  text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-blue
                  resize-none transition-colors min-h-[100px]"
              />
            </div>

            {/* Photos */}
            <div>
              <span className="flex items-center gap-2 text-xs text-text-tertiary uppercase tracking-wider mb-3">
                <Camera className="w-3.5 h-3.5" aria-hidden="true" />
                Photos ({photos.length}/{MAX_PHOTOS})
              </span>

              {/* Photo Grid - Larger for iPad */}
              <div className="grid grid-cols-3 gap-3" role="group" aria-label="Restoration photos">
                {/* Existing Photos */}
                {photos.map((photoUrl, index) => (
                  <div
                    key={photoUrl}
                    className="relative aspect-square bg-bg-secondary rounded-xl border border-border overflow-hidden"
                  >
                    {/* Loading skeleton */}
                    {!loadedImages.has(photoUrl) && (
                      <div className="absolute inset-0 flex items-center justify-center bg-bg-secondary animate-pulse">
                        <Loader2 className="w-6 h-6 text-text-muted animate-spin" aria-hidden="true" />
                        <span className="sr-only">Loading photo {index + 1}</span>
                      </div>
                    )}
                    {/* Only render img if URL is valid (defense in depth) */}
                    {isValidPhotoUrl(photoUrl) && (
                      <img
                        src={photoUrl}
                        alt={`Restoration photo ${index + 1} of ${photos.length}`}
                        loading="lazy"
                        onLoad={() => setLoadedImages((prev) => new Set(prev).add(photoUrl))}
                        className={`w-full h-full object-cover transition-opacity duration-200 ${
                          loadedImages.has(photoUrl) ? "opacity-100" : "opacity-0"
                        }`}
                      />
                    )}
                    {/* Delete Button - ALWAYS VISIBLE, 44px touch target */}
                    <button
                      onClick={() => handleRemovePhoto(photoUrl)}
                      type="button"
                      aria-label={`Remove photo ${index + 1}`}
                      className="absolute top-2 right-2 w-11 h-11 bg-red-500/90 text-white rounded-xl
                        flex items-center justify-center shadow-lg
                        hover:bg-red-600 active:bg-red-700 active:scale-95 transition-all"
                    >
                      <Trash2 className="w-5 h-5" aria-hidden="true" />
                    </button>
                  </div>
                ))}

                {/* Add Photo Button - iPad-friendly, goes directly to camera */}
                {photos.length < MAX_PHOTOS && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    type="button"
                    aria-label={uploading ? "Uploading photo, please wait" : `Take photo (${photos.length} of ${MAX_PHOTOS} used)`}
                    aria-busy={uploading}
                    className="aspect-square bg-bg-secondary border-2 border-dashed border-border rounded-xl
                      flex flex-col items-center justify-center gap-2 text-text-tertiary
                      hover:border-accent-blue hover:text-accent-blue hover:bg-accent-blue/5
                      active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed
                      min-h-[100px]"
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="w-8 h-8 animate-spin" aria-hidden="true" />
                        <span className="sr-only">Uploading...</span>
                      </>
                    ) : (
                      <>
                        <Camera className="w-8 h-8" aria-hidden="true" />
                        <span className="text-xs font-semibold">Take Photo</span>
                      </>
                    )}
                  </button>
                )}

                {/* Empty slots removed - "Add Photo" button is sufficient indicator */}
              </div>

              {/* Hidden file input - capture="environment" for back camera (iOS only allows single capture) */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoUpload}
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
              />
            </div>
          </div>

          {/* ============================================================ */}
          {/* SECTION 3: TIMELINE */}
          {/* ============================================================ */}
          <div className="space-y-3 pt-2 border-t border-border/50">
            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
              Timeline
            </h3>
            <div className="space-y-1 text-sm">
              <div className="flex items-center justify-between py-2 border-b border-border/30">
                <span className="text-text-tertiary">Order Created</span>
                <span className="text-text-primary font-medium">
                  {formatDate(restoration.order_created_at)}
                </span>
              </div>
              {restoration.delivered_to_warehouse_at && (
                <div className="flex items-center justify-between py-2 border-b border-border/30">
                  <span className="text-text-tertiary">Delivered to Warehouse</span>
                  <span className="text-text-primary font-medium">
                    {formatDateTime(restoration.delivered_to_warehouse_at)}
                  </span>
                </div>
              )}
              {restoration.received_at && (
                <div className="flex items-center justify-between py-2 border-b border-border/30">
                  <span className="text-text-tertiary">Checked In</span>
                  <span className="text-text-primary font-medium">
                    {formatDateTime(restoration.received_at)}
                  </span>
                </div>
              )}
              {restoration.sent_to_restoration_at && (
                <div className="flex items-center justify-between py-2 border-b border-border/30">
                  <span className="text-text-tertiary">Sent to Restoration</span>
                  <span className="text-text-primary font-medium">
                    {formatDateTime(restoration.sent_to_restoration_at)}
                  </span>
                </div>
              )}
              {restoration.back_from_restoration_at && (
                <div className="flex items-center justify-between py-2 border-b border-border/30">
                  <span className="text-text-tertiary">Back from Restoration</span>
                  <span className="text-text-primary font-medium">
                    {formatDateTime(restoration.back_from_restoration_at)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* ============================================================ */}
          {/* SECTION 4: TRACKING (Least Important - Bottom) */}
          {/* ============================================================ */}
          {restoration.return_tracking_number && (
            <div className="space-y-3 pt-2 border-t border-border/50">
              <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                Return Tracking
              </h3>
              <div className="bg-bg-secondary rounded-xl p-4 border border-border">
                <div className="flex items-center gap-2 mb-1">
                  <Truck className="w-4 h-4 text-text-tertiary" aria-hidden="true" />
                  <span className="text-sm font-mono text-text-primary">
                    {restoration.return_tracking_number}
                  </span>
                </div>
                {restoration.return_carrier && (
                  <span className="text-xs text-text-tertiary">
                    via {restoration.return_carrier}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ================================================================ */}
        {/* FOOTER - iPad-Optimized Button Hierarchy */}
        {/* ================================================================ */}
        <div className="px-5 py-4 border-t border-border bg-bg-secondary/50">
          {/* Primary Action: Advance Status (if available) */}
          {advanceConfig && (
            <button
              onClick={handleAdvanceStatus}
              disabled={advancing || saving || uploading}
              aria-busy={advancing}
              aria-label={`${advanceConfig.label} - advances restoration to ${advanceConfig.nextStatus} status`}
              className={`w-full flex items-center justify-center gap-3 px-6 py-4 text-base font-bold text-white rounded-xl
                ${advanceConfig.bgClass} disabled:opacity-50 disabled:cursor-not-allowed
                min-h-[56px] mb-3 transition-all active:scale-[0.98]`}
            >
              {advancing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                  <span>Processing...</span>
                </>
              ) : uploading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                  <span>Wait for upload...</span>
                </>
              ) : (
                <>
                  {AdvanceIcon && <AdvanceIcon className="w-5 h-5" aria-hidden="true" />}
                  {advanceConfig.label}
                  <ChevronRight className="w-5 h-5" aria-hidden="true" />
                </>
              )}
            </button>
          )}

          {/* Secondary Actions Row */}
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={handleClose}
              type="button"
              aria-label="Cancel and close modal"
              className="px-4 py-3 text-sm text-text-secondary hover:text-text-primary transition-colors min-h-[44px]"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving || advancing || uploading}
              aria-busy={saving}
              aria-label="Save changes without advancing status"
              className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-xl transition-all min-h-[44px] ${
                hasChanges && !saving && !advancing && !uploading
                  ? "bg-bg-tertiary text-text-primary hover:bg-border active:scale-95"
                  : "bg-bg-tertiary/50 text-text-muted cursor-not-allowed"
              }`}
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Only
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
