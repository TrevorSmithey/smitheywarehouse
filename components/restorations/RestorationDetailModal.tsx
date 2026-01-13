"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
  ChevronLeft,
  ChevronDown,
  CheckCircle,
  Package,
  Wrench,
  ZoomIn,
  AlertTriangle,
  Plus,
  ArrowLeft,
} from "lucide-react";
import type { RestorationRecord } from "@/app/api/restorations/route";
import { createClient } from "@/lib/supabase/client";
import { getAuthHeaders } from "@/lib/auth";

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
  damaged: { label: "Damaged", color: "text-rose-400", bgColor: "bg-rose-500/20", borderColor: "border-rose-500" },
};

// Status advancement configuration
// Note: "received" status removed from forward workflow - delivered_warehouse now goes directly to at_restoration
// The "received" entry remains for backward compatibility with 6 existing items in that status
const STATUS_ADVANCE: Record<string, { nextStatus: string; label: string; icon: React.ElementType; bgClass: string }> = {
  delivered_warehouse: {
    nextStatus: "at_restoration",
    label: "Send to Restoration",
    icon: Package,
    bgClass: "bg-purple-500 hover:bg-purple-600 active:bg-purple-700",
  },
  received: {
    // Legacy: for items already in "received" status before workflow simplification
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

// Status order for determining forward/backward
const STATUS_ORDER = [
  "pending_label",
  "label_sent",
  "in_transit_inbound",
  "delivered_warehouse",
  "received",
  "at_restoration",
  "ready_to_ship",
  "shipped",
  "delivered",
] as const;

// Valid status transitions - includes backward movement and damaged (mirrors API)
// Note: delivered_warehouse can now go directly to at_restoration (skipping "received")
const VALID_TRANSITIONS: Record<string, string[]> = {
  pending_label: ["label_sent", "cancelled", "damaged"],
  label_sent: ["in_transit_inbound", "pending_label", "cancelled", "damaged"],
  in_transit_inbound: ["delivered_warehouse", "label_sent", "pending_label", "cancelled", "damaged"],
  delivered_warehouse: ["at_restoration", "received", "in_transit_inbound", "label_sent", "pending_label", "cancelled", "damaged"],
  received: ["at_restoration", "delivered_warehouse", "in_transit_inbound", "label_sent", "pending_label", "cancelled", "damaged"],
  at_restoration: ["ready_to_ship", "received", "delivered_warehouse", "in_transit_inbound", "label_sent", "pending_label", "cancelled", "damaged"],
  ready_to_ship: ["shipped", "at_restoration", "received", "delivered_warehouse", "in_transit_inbound", "label_sent", "pending_label", "cancelled", "damaged"],
  shipped: ["delivered", "ready_to_ship", "at_restoration", "received", "damaged"],
  delivered: [], // Terminal state
  cancelled: [], // Terminal state
  damaged: [], // Terminal state
};

// Damage reason options
const DAMAGE_REASONS = [
  { value: "damaged_upon_arrival", label: "Damaged Upon Arrival" },
  { value: "damaged_internal", label: "Damaged Internal" },
  { value: "lost", label: "Lost" },
] as const;

/** Check if a status transition is backward */
function isBackwardTransition(from: string, to: string): boolean {
  const fromIndex = STATUS_ORDER.indexOf(from as typeof STATUS_ORDER[number]);
  const toIndex = STATUS_ORDER.indexOf(to as typeof STATUS_ORDER[number]);
  return fromIndex >= 0 && toIndex >= 0 && toIndex < fromIndex;
}

/** Get forward transitions for a status */
function getForwardTransitions(status: string): string[] {
  const statusIndex = STATUS_ORDER.indexOf(status as typeof STATUS_ORDER[number]);
  if (statusIndex < 0 || statusIndex >= STATUS_ORDER.length - 1) return [];

  const nextStatus = STATUS_ORDER[statusIndex + 1];

  // Skip delivered_warehouse - it's handled automatically by AfterShip webhook
  // when tracking shows delivery. No manual option needed.
  if (nextStatus === "delivered_warehouse") {
    return [];
  }

  return [nextStatus];
}

/** Get backward transition for a status - only ONE step back (not all) */
function getBackwardTransition(status: string): string | null {
  const statusIndex = STATUS_ORDER.indexOf(status as typeof STATUS_ORDER[number]);
  if (statusIndex <= 0) return null;
  return STATUS_ORDER[statusIndex - 1];
}

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
  damaged: "Damaged",
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
  const [tagNumbers, setTagNumbers] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set());
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // Damaged dialog state
  const [showDamageDialog, setShowDamageDialog] = useState(false);
  const [selectedDamageReason, setSelectedDamageReason] = useState<string>("");
  const [damageConfirmed, setDamageConfirmed] = useState(false);
  // Resolve damaged item state
  const [resolving, setResolving] = useState(false);
  // Local pickup toggle state
  const [localPickup, setLocalPickup] = useState<boolean | null>(null);
  const [togglingPickup, setTogglingPickup] = useState(false);

  // Refs for async operation safety
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMountedRef = useRef(true);
  const uploadAbortControllerRef = useRef<AbortController | null>(null);
  // Mutex to prevent concurrent status update operations (prevents race conditions)
  const statusUpdateInProgressRef = useRef(false);
  // Ref for damage success timeout (to clean up on unmount)
  const damageSuccessTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Track mount state to prevent state updates after unmount
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      // Abort any pending uploads on unmount
      uploadAbortControllerRef.current?.abort();
      // Clear damage success timeout
      if (damageSuccessTimeoutRef.current) {
        clearTimeout(damageSuccessTimeoutRef.current);
      }
      // Clear file input reference
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    };
  }, []);

  // Reset form when restoration changes
  useEffect(() => {
    if (restoration) {
      setNotes(typeof restoration.notes === "string" ? restoration.notes : "");
      // Use tag_numbers array, fallback to magnet_number for backward compatibility
      const tags = Array.isArray(restoration.tag_numbers) && restoration.tag_numbers.length > 0
        ? restoration.tag_numbers
        : restoration.magnet_number
          ? [restoration.magnet_number]
          : [];
      setTagNumbers(tags);
      setNewTagInput("");
      // Filter to only valid photo URLs for security
      // Defensive: ensure photos is an array before filtering
      const photosArray = Array.isArray(restoration.photos) ? restoration.photos : [];
      setPhotos(photosArray.filter((url): url is string => typeof url === "string" && isValidPhotoUrl(url)));
      setShowStatusDropdown(false);
      setShowDamageDialog(false);
      setSelectedDamageReason("");
      setDamageConfirmed(false);
      setLoadedImages(new Set()); // Reset loaded images tracking
      setLocalPickup(restoration.local_pickup ?? null);
    }
  }, [restoration]);

  // Compute hasChanges as a derived value (avoids extra render cycle from useState + useEffect)
  const hasChanges = useMemo(() => {
    if (!restoration) return false;
    const notesChanged = notes !== (restoration.notes || "");
    // Compare tag_numbers array, fallback to magnet_number for compatibility
    const originalTags = Array.isArray(restoration.tag_numbers) && restoration.tag_numbers.length > 0
      ? restoration.tag_numbers
      : restoration.magnet_number
        ? [restoration.magnet_number]
        : [];
    const tagsChanged = JSON.stringify(tagNumbers) !== JSON.stringify(originalTags);
    // Compare photos using the SAME filtering as when we load them
    // This ensures hasChanges=false when no user action has occurred
    const originalPhotos = Array.isArray(restoration.photos)
      ? restoration.photos.filter((url): url is string => typeof url === "string" && isValidPhotoUrl(url))
      : [];
    const photosChanged = JSON.stringify(photos) !== JSON.stringify(originalPhotos);
    return notesChanged || tagsChanged || photosChanged;
  }, [notes, tagNumbers, photos, restoration]);

  // IMPORTANT: This useCallback must be BEFORE the early return to comply with Rules of Hooks
  // The callback safely handles restoration being null with an early return inside
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

      // Initialize progress tracking
      setUploadProgress({ current: 0, total: filesToUpload.length });

      for (let i = 0; i < filesToUpload.length; i++) {
        const file = filesToUpload[i];

        // Update progress
        setUploadProgress({ current: i + 1, total: filesToUpload.length });
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
        setUploadProgress(null);
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

  // Toggle local pickup flag
  const handleToggleLocalPickup = async () => {
    if (!restoration || togglingPickup) return;

    const newValue = !localPickup;
    setTogglingPickup(true);
    // Optimistic update
    setLocalPickup(newValue);

    try {
      const res = await fetch(`/api/restorations/${restoration.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ local_pickup: newValue }),
      });

      if (!res.ok) {
        // Revert on failure
        setLocalPickup(!newValue);
        throw new Error("Failed to update local pickup");
      }

      // Refresh parent data to sync state
      onSave();
    } catch (error) {
      console.error("Error toggling local pickup:", error);
      alert("Failed to update pickup setting. Please try again.");
    } finally {
      if (isMountedRef.current) {
        setTogglingPickup(false);
      }
    }
  };

  // Save changes without advancing status
  const handleSave = async () => {
    if (!hasChanges || !restoration) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/restorations/${restoration.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          notes: notes || null,
          tag_numbers: tagNumbers,
          photos: photos,
        }),
      });

      if (!res.ok) throw new Error("Failed to save");

      // Note: hasChanges will automatically recalculate to false once parent
      // refetches and passes updated restoration prop
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
    if (!advanceConfig || !restoration || statusUpdateInProgressRef.current) return;
    statusUpdateInProgressRef.current = true;

    setAdvancing(true);
    try {
      const res = await fetch(`/api/restorations/${restoration.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          status: advanceConfig.nextStatus,
          notes: notes || null,
          tag_numbers: tagNumbers,
          photos: photos,
        }),
      });

      if (!res.ok) throw new Error("Failed to advance status");

      // Note: hasChanges will automatically recalculate to false once parent
      // refetches and passes updated restoration prop
      onSave();
    } catch (error) {
      console.error("Error advancing status:", error);
      alert("Failed to advance status. Please try again.");
    } finally {
      statusUpdateInProgressRef.current = false;
      if (isMountedRef.current) {
        setAdvancing(false);
      }
    }
  };

  // Manual status change
  const handleManualStatusChange = async (newStatus: string, skipConfirm = false) => {
    if (!restoration || statusUpdateInProgressRef.current) return;
    if (newStatus === restoration.status) {
      setShowStatusDropdown(false);
      return;
    }

    // Confirmation for backward movement
    const isBackward = isBackwardTransition(restoration.status, newStatus);
    if (isBackward && !skipConfirm) {
      const confirmed = confirm(
        "Moving backward will clear timestamps for skipped stages. This is recorded in the audit log. Continue?"
      );
      if (!confirmed) return;
    }

    statusUpdateInProgressRef.current = true;
    setSaving(true);
    try {
      const res = await fetch(`/api/restorations/${restoration.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          status: newStatus,
          notes: notes || null,
          tag_numbers: tagNumbers,
          photos: photos,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to change status");
      }

      // Note: hasChanges will automatically recalculate to false once parent
      // refetches and passes updated restoration prop
      setShowStatusDropdown(false);
      onSave();
    } catch (error) {
      console.error("Error changing status:", error);
      alert(error instanceof Error ? error.message : "Failed to change status");
    } finally {
      statusUpdateInProgressRef.current = false;
      if (isMountedRef.current) {
        setSaving(false);
      }
    }
  };

  // Handle marking as damaged
  const handleMarkDamaged = async () => {
    if (!restoration || !selectedDamageReason || statusUpdateInProgressRef.current) return;
    statusUpdateInProgressRef.current = true;

    setSaving(true);
    try {
      const res = await fetch(`/api/restorations/${restoration.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          status: "damaged",
          damage_reason: selectedDamageReason,
          notes: notes || null,
          tag_numbers: tagNumbers,
          photos: photos,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to mark as damaged");
      }

      // Show confirmation state
      setDamageConfirmed(true);
      setSaving(false);
      statusUpdateInProgressRef.current = false;

      // Close modal after brief confirmation display, THEN refresh data
      // Store timeout ref so it can be cleaned up on unmount
      damageSuccessTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          // Call parent callbacks first, then reset local state
          onSave(); // Refresh data in parent
          onClose(); // Close the entire modal - damage is terminal
          // Reset state (after close, but keeps things clean)
          setShowDamageDialog(false);
          setSelectedDamageReason("");
          setDamageConfirmed(false);
        }
      }, 1500);
    } catch (error) {
      console.error("Error marking as damaged:", error);
      alert(error instanceof Error ? error.message : "Failed to mark as damaged");
      statusUpdateInProgressRef.current = false;
      if (isMountedRef.current) {
        setSaving(false);
      }
    }
  };

  // Handle resolving a damaged item (CS has contacted customer)
  const handleResolveDamaged = async () => {
    if (!restoration || resolving) return;

    setResolving(true);
    try {
      const res = await fetch(`/api/restorations/${restoration.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          resolved_at: new Date().toISOString(),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to resolve");
      }

      onSave();
      onClose(); // Close modal after resolving
    } catch (error) {
      console.error("Error resolving damaged item:", error);
      alert(error instanceof Error ? error.message : "Failed to resolve item");
    } finally {
      if (isMountedRef.current) {
        setResolving(false);
      }
    }
  };

  // Tag management handlers
  const handleAddTag = () => {
    const tag = newTagInput.trim().toUpperCase();
    if (!tag) return;
    if (tagNumbers.length >= 10) {
      alert("Maximum 10 tags allowed");
      return;
    }
    if (tagNumbers.includes(tag)) {
      alert("Tag already exists");
      setNewTagInput("");
      return;
    }
    // Validate: alphanumeric + dash, max 20 chars
    if (!/^[A-Z0-9-]+$/i.test(tag) || tag.length > 20) {
      alert("Tags must be alphanumeric with dashes, max 20 characters");
      return;
    }
    setTagNumbers([...tagNumbers, tag]);
    setNewTagInput("");
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTagNumbers(tagNumbers.filter((t) => t !== tagToRemove));
  };

  const handleClose = () => {
    // Check if upload is in progress - warn user before closing
    if (uploading) {
      if (!confirm("Photo upload in progress. Cancel upload and discard unsaved changes?")) {
        return;
      }
      // Abort the upload
      uploadAbortControllerRef.current?.abort();
    }

    // Check for unsaved changes (separate from upload check)
    if (hasChanges && !uploading) {
      if (!confirm("You have unsaved changes. Discard them?")) {
        return;
      }
    }
    onClose();
  };

  // =============================================================================
  // EARLY RETURN - Must come AFTER all hooks to comply with Rules of Hooks
  // =============================================================================
  if (!isOpen || !restoration) return null;

  // =============================================================================
  // COMPUTED VALUES - Safe to access restoration now (guaranteed non-null)
  // =============================================================================

  // Defensive: ensure status is a string for config lookup
  const statusKey = typeof restoration.status === "string" ? restoration.status : "pending_label";
  const config = STAGE_CONFIG[statusKey] || {
    label: "Unknown",
    color: "text-slate-400",
    bgColor: "bg-slate-500/20",
    borderColor: "border-slate-500",
  };

  // Defensive: extract order name safely
  const orderName = typeof restoration.order_name === "string" ? restoration.order_name : null;

  // Use pre-computed values from API (already calculated server-side)
  const daysInStatus = restoration.days_in_status ?? 0;

  // Total time = days since Smithey took possession
  // POS: from order creation (immediate possession)
  // Regular: from warehouse delivery (or received_at as fallback)
  const possessionDate = restoration.is_pos
    ? restoration.order_created_at
    : (restoration.delivered_to_warehouse_at || restoration.received_at);
  const totalDays = possessionDate
    ? Math.floor((Date.now() - new Date(possessionDate).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  // Get advance config for the primary action button (if status can be advanced)
  const advanceConfig = STATUS_ADVANCE[restoration.status] || null;
  const AdvanceIcon = advanceConfig?.icon || null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="restoration-modal-title"
    >
      {/* Backdrop - use onMouseDown to prevent focus-steal from auto-focused inputs */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onMouseDown={handleClose}
        aria-hidden="true"
      />

      {/* Modal - optimized for iPad LANDSCAPE */}
      <div className="relative bg-bg-primary border border-border rounded-2xl shadow-2xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* ================================================================ */}
        {/* HEADER - Status Badge + Close */}
        {/* ================================================================ */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            {/* Status Badge - Tappable for manual override */}
            <div className="relative group">
              <button
                onClick={() => setShowStatusDropdown(!showStatusDropdown)}
                aria-expanded={showStatusDropdown}
                aria-haspopup="listbox"
                aria-label={`Current status: ${config.label}. Tap to change status`}
                className={`inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider px-3 py-2 rounded-lg ${config.bgColor} ${config.color} min-h-[44px] active:opacity-80 transition-all border-2 border-transparent hover:border-current/30`}
              >
                <span className="w-2 h-2 rounded-full bg-current" aria-hidden="true" />
                {config.label}
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showStatusDropdown ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>
              {/* Hint tooltip on hover */}
              <div className="absolute -bottom-6 left-0 text-[10px] text-text-muted opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                Tap to change status
              </div>
            </div>
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
            {/* Backdrop - closes just the dropdown when clicked outside */}
            <div
              className="fixed inset-0 z-[5]"
              onMouseDown={() => setShowStatusDropdown(false)}
              aria-hidden="true"
            />
            <div
              role="listbox"
              aria-label="Status options"
              className="absolute top-[68px] left-4 right-4 sm:right-auto sm:min-w-[240px] z-10 bg-bg-primary border border-border rounded-xl shadow-xl py-1 max-h-[50vh] overflow-y-auto scrollbar-thin"
            >
              {/* Forward transition - primary action */}
              {getForwardTransitions(restoration.status).map((statusValue) => (
                <button
                  key={statusValue}
                  role="option"
                  aria-selected={false}
                  onClick={() => handleManualStatusChange(statusValue)}
                  disabled={saving}
                  className="w-full text-left px-4 py-3 text-sm font-medium text-emerald-400 hover:bg-emerald-500/10 transition-colors min-h-[44px] flex items-center gap-2"
                >
                  <ChevronRight className="w-4 h-4" />
                  {STATUS_LABELS[statusValue]}
                </button>
              ))}

              {/* Backward transition - just ONE step back */}
              {getBackwardTransition(restoration.status) && (
                <>
                  <div className="border-t border-border/30 my-1" />
                  <button
                    role="option"
                    aria-selected={false}
                    onClick={() => handleManualStatusChange(getBackwardTransition(restoration.status)!)}
                    disabled={saving}
                    className="w-full text-left px-4 py-3 text-sm text-amber-300/80 hover:bg-amber-500/10 transition-colors min-h-[44px] flex items-center gap-2"
                  >
                    <ArrowLeft className="w-4 h-4 text-amber-400" />
                    Undo → {STATUS_LABELS[getBackwardTransition(restoration.status)!]}
                  </button>
                </>
              )}

              {/* Terminal statuses - compact, less prominent */}
              {(VALID_TRANSITIONS[restoration.status] || []).some(s => s === "cancelled" || s === "damaged") && (
                <>
                  <div className="border-t border-border/30 my-1" />
                  <div className="flex gap-1 px-3 py-2">
                    {(VALID_TRANSITIONS[restoration.status] || []).includes("cancelled") && (
                      <button
                        role="option"
                        aria-selected={false}
                        onClick={() => handleManualStatusChange("cancelled")}
                        disabled={saving}
                        className="flex-1 text-center px-3 py-2 text-xs text-rose-400/70 hover:bg-rose-500/10 hover:text-rose-400 rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                    {(VALID_TRANSITIONS[restoration.status] || []).includes("damaged") && (
                      <button
                        role="option"
                        aria-selected={false}
                        onClick={() => {
                          setShowStatusDropdown(false);
                          setShowDamageDialog(true);
                        }}
                        disabled={saving}
                        className="flex-1 text-center px-3 py-2 text-xs text-rose-400/70 hover:bg-rose-500/10 hover:text-rose-400 rounded-lg transition-colors"
                      >
                        Damaged
                      </button>
                    )}
                  </div>
                </>
              )}

              {/* No transitions available */}
              {(VALID_TRANSITIONS[restoration.status] || []).length === 0 && (
                <div className="px-4 py-3 text-sm text-text-muted italic">
                  This is a terminal status
                </div>
              )}
            </div>
          </>
        )}

        {/* ================================================================ */}
        {/* CONTENT - 2-Column Grid for iPad Landscape */}
        {/* ================================================================ */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* ============================================================ */}
            {/* LEFT COLUMN - Order Info, Inputs */}
            {/* ============================================================ */}
            <div className="space-y-5">
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
                    {orderName || `#${restoration.id}`}
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

              {/* Key Metrics Row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-bg-secondary rounded-xl p-4 border border-border">
                  <div className="flex items-center gap-2 text-text-tertiary text-xs mb-1">
                    <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>In Stage</span>
                  </div>
                  <div
                    className={`text-2xl font-bold tabular-nums ${
                      daysInStatus <= 3
                        ? "text-emerald-400"
                        : daysInStatus <= 7
                        ? "text-amber-400"
                        : "text-red-400"
                    }`}
                  >
                    {daysInStatus}d
                  </div>
                </div>
                <div className="bg-bg-secondary rounded-xl p-4 border border-border">
                  <div className="flex items-center gap-2 text-text-tertiary text-xs mb-1">
                    <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Total Time</span>
                  </div>
                  <div
                    className={`text-2xl font-bold tabular-nums ${
                      totalDays <= 14
                        ? "text-emerald-400"
                        : totalDays <= 21
                        ? "text-amber-400"
                        : "text-red-400"
                    }`}
                  >
                    {totalDays}d
                  </div>
                </div>
              </div>

              {/* Tag Numbers - PRIMARY IDENTIFIER */}
              {/* Enhanced visual treatment when tag is required for check-in */}
              {(() => {
                const isCheckInState = restoration.status === "delivered_warehouse";
                const needsTag = isCheckInState && tagNumbers.length === 0;

                return (
                  <div className={`rounded-xl p-4 transition-all ${
                    needsTag
                      ? "bg-emerald-500/10 border-2 border-emerald-500/50 ring-2 ring-emerald-500/20"
                      : "bg-transparent"
                  }`}>
                    <label className={`flex items-center justify-between text-xs uppercase tracking-wider mb-3 ${
                      needsTag ? "text-emerald-400" : "text-text-tertiary"
                    }`}>
                      <span className="flex items-center gap-2">
                        <Tag className="w-3.5 h-3.5" aria-hidden="true" />
                        Tag Number{tagNumbers.length !== 1 ? "s" : ""} ({tagNumbers.length}/10)
                      </span>
                      {needsTag && (
                        <span className="flex items-center gap-1.5 text-emerald-400 font-semibold animate-pulse">
                          <CheckCircle className="w-3.5 h-3.5" />
                          REQUIRED FOR CHECK IN
                        </span>
                      )}
                    </label>

                    {/* Tag Chips Display */}
                    {tagNumbers.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-3" role="list" aria-label="Current tag numbers">
                        {tagNumbers.map((tag) => (
                          <div
                            key={tag}
                            role="listitem"
                            className="inline-flex items-center gap-2 px-3 py-2 bg-accent-blue/20 border border-accent-blue/40 rounded-lg text-accent-blue font-mono font-semibold text-lg"
                          >
                            <span>{tag}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveTag(tag)}
                              aria-label={`Remove tag ${tag}`}
                              className="p-0.5 hover:bg-accent-blue/30 rounded transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add Tag Input - Enhanced when required */}
                    {tagNumbers.length < 10 && (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          inputMode="text"
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="characters"
                          autoFocus={needsTag}
                          value={newTagInput}
                          onChange={(e) => setNewTagInput(e.target.value.toUpperCase())}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleAddTag();
                            }
                          }}
                          placeholder={needsTag ? "Enter tag # to check in..." : "e.g., M-042"}
                          aria-label="Add new tag number"
                          aria-required={needsTag}
                          className={`flex-1 px-4 py-3 text-lg font-mono font-semibold rounded-xl
                            text-text-primary placeholder-text-muted focus:outline-none transition-all min-h-[52px]
                            ${needsTag
                              ? "bg-bg-primary border-2 border-emerald-500/60 focus:border-emerald-400 placeholder-emerald-400/50"
                              : "bg-bg-secondary border-2 border-border focus:border-accent-blue"
                            }`}
                        />
                        <button
                          type="button"
                          onClick={handleAddTag}
                          disabled={!newTagInput.trim()}
                          aria-label="Add tag"
                          className={`px-4 py-3 font-semibold rounded-xl
                            active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed
                            transition-all min-w-[52px] min-h-[52px] flex items-center justify-center
                            ${needsTag
                              ? "bg-emerald-500 text-white hover:bg-emerald-600"
                              : "bg-accent-blue text-white hover:bg-accent-blue/90"
                            }`}
                        >
                          <Plus className="w-5 h-5" />
                        </button>
                      </div>
                    )}

                    {/* Contextual hint */}
                    {tagNumbers.length === 0 && !needsTag && (
                      <p className="text-xs text-text-muted mt-2">
                        Add tag numbers to identify this item (Enter to add)
                      </p>
                    )}
                  </div>
                );
              })()}

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
                  className="w-full px-4 py-3 text-sm bg-bg-secondary border border-border rounded-xl
                    text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-blue
                    resize-none transition-colors min-h-[88px]"
                />
              </div>

              {/* Local Pickup Toggle - Override for customers picking up at warehouse */}
              <button
                onClick={handleToggleLocalPickup}
                disabled={togglingPickup}
                aria-pressed={localPickup ?? false}
                aria-label={localPickup ? "Local pickup enabled - tap to disable" : "Enable local pickup"}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all min-h-[52px] active:scale-[0.99] ${
                  localPickup
                    ? "bg-amber-500/15 border-amber-500/50 hover:bg-amber-500/20"
                    : "bg-bg-secondary border-border hover:border-border-hover"
                } ${togglingPickup ? "opacity-50 cursor-wait" : ""}`}
              >
                <div className="flex items-center gap-3">
                  <Package className={`w-5 h-5 ${localPickup ? "text-amber-400" : "text-text-muted"}`} />
                  <span className={`text-sm font-medium ${localPickup ? "text-amber-300" : "text-text-secondary"}`}>
                    Local Pickup
                  </span>
                </div>
                {/* Toggle Switch */}
                <div className={`relative w-11 h-6 rounded-full transition-colors ${
                  localPickup ? "bg-amber-500" : "bg-bg-tertiary"
                }`}>
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                    localPickup ? "translate-x-6" : "translate-x-1"
                  }`} />
                </div>
              </button>

              {/* Timeline - Compact Horizontal Stepper */}
              {(() => {
                // Build timeline entries dynamically based on available dates
                const entries: { label: string; date: string; color: string; dotColor: string }[] = [];

                if (restoration.order_created_at) {
                  entries.push({ label: "Created", date: formatDate(restoration.order_created_at), color: "text-text-muted", dotColor: "bg-slate-500" });
                }
                if (restoration.delivered_to_warehouse_at) {
                  entries.push({ label: "Delivered", date: formatDate(restoration.delivered_to_warehouse_at), color: "text-orange-400", dotColor: "bg-orange-500" });
                }
                if (restoration.received_at) {
                  entries.push({ label: "Checked In", date: formatDate(restoration.received_at), color: "text-emerald-400", dotColor: "bg-emerald-500" });
                }
                if (restoration.sent_to_restoration_at) {
                  entries.push({ label: "At Resto", date: formatDate(restoration.sent_to_restoration_at), color: "text-purple-400", dotColor: "bg-purple-500" });
                }
                if (restoration.back_from_restoration_at) {
                  entries.push({ label: "Ready", date: formatDate(restoration.back_from_restoration_at), color: "text-blue-400", dotColor: "bg-blue-500" });
                }
                if (restoration.shipped_at) {
                  entries.push({ label: "Shipped", date: formatDate(restoration.shipped_at), color: "text-cyan-400", dotColor: "bg-cyan-500" });
                }

                if (entries.length === 0) return null;

                return (
                  <div className="pt-3 border-t border-border/50">
                    <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">
                      Timeline
                    </h3>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {entries.map((entry, idx) => (
                        <div key={entry.label} className="flex items-center">
                          {/* Entry */}
                          <div className="flex items-center gap-1.5 px-2 py-1 bg-bg-secondary/50 rounded">
                            <div className={`w-1.5 h-1.5 rounded-full ${entry.dotColor}`} />
                            <span className={`text-[11px] font-medium ${entry.color}`}>{entry.label}</span>
                            <span className="text-[11px] text-text-tertiary">{entry.date}</span>
                          </div>
                          {/* Arrow connector (except last) */}
                          {idx < entries.length - 1 && (
                            <ChevronRight className="w-3 h-3 text-text-muted/50 mx-0.5 shrink-0" />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Return Tracking - Inline */}
              {restoration.return_tracking_number && (
                <div className="flex items-center gap-2 px-3 py-2 bg-bg-secondary rounded-lg border border-border text-sm">
                  <Truck className="w-4 h-4 text-text-tertiary shrink-0" aria-hidden="true" />
                  <span className="font-mono text-text-primary truncate">
                    {restoration.return_tracking_number}
                  </span>
                  {restoration.return_carrier && (
                    <span className="text-text-tertiary shrink-0">
                      ({restoration.return_carrier})
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* ============================================================ */}
            {/* RIGHT COLUMN - Photos (Prominent) */}
            {/* ============================================================ */}
            <div className="space-y-4">
              <span className="flex items-center gap-2 text-xs text-text-tertiary uppercase tracking-wider">
                <Camera className="w-3.5 h-3.5" aria-hidden="true" />
                Photos ({photos.length}/{MAX_PHOTOS})
              </span>

              {/* Photo Grid - Larger squares for iPad */}
              <div className="grid grid-cols-2 gap-3" role="group" aria-label="Restoration photos">
                {/* Existing Photos */}
                {photos.map((photoUrl, index) => (
                  <div
                    key={photoUrl}
                    className="group relative aspect-square bg-bg-secondary rounded-xl border border-border overflow-hidden cursor-pointer"
                    onClick={() => setLightboxIndex(index)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setLightboxIndex(index))}
                    aria-label={`View photo ${index + 1} fullscreen`}
                  >
                    {/* Loading skeleton */}
                    {!loadedImages.has(photoUrl) && (
                      <div className="absolute inset-0 flex items-center justify-center bg-bg-secondary animate-pulse">
                        <Loader2 className="w-8 h-8 text-text-muted animate-spin" aria-hidden="true" />
                        <span className="sr-only">Loading photo {index + 1}</span>
                      </div>
                    )}
                    {/* Only render img if URL is valid (defense in depth) */}
                    {isValidPhotoUrl(photoUrl) && (
                      <img
                        src={photoUrl}
                        alt={`Restoration photo ${index + 1} of ${photos.length}`}
                        loading="lazy"
                        onLoad={() => {
                          // Check mount state before updating state (prevents memory leak)
                          if (isMountedRef.current) {
                            setLoadedImages((prev) => new Set(prev).add(photoUrl));
                          }
                        }}
                        className={`w-full h-full object-cover transition-opacity duration-200 ${
                          loadedImages.has(photoUrl) ? "opacity-100" : "opacity-0"
                        }`}
                      />
                    )}
                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                      <ZoomIn className="w-8 h-8 text-white opacity-0 group-hover:opacity-80 transition-opacity" />
                    </div>
                    {/* Delete Button */}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRemovePhoto(photoUrl); }}
                      type="button"
                      aria-label={`Remove photo ${index + 1}`}
                      className="absolute top-2 right-2 w-11 h-11 bg-red-500/90 text-white rounded-xl
                        flex items-center justify-center shadow-lg
                        opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity
                        hover:bg-red-600 active:bg-red-700 active:scale-95"
                    >
                      <Trash2 className="w-5 h-5" aria-hidden="true" />
                    </button>
                  </div>
                ))}

                {/* Add Photo Button */}
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
                      active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="w-10 h-10 animate-spin text-accent-blue" aria-hidden="true" />
                        {uploadProgress && (
                          <span className="text-sm font-semibold text-accent-blue">
                            {uploadProgress.current}/{uploadProgress.total}
                          </span>
                        )}
                        <span className="sr-only">Uploading photo {uploadProgress?.current} of {uploadProgress?.total}...</span>
                      </>
                    ) : (
                      <>
                        <Camera className="w-10 h-10" aria-hidden="true" />
                        <span className="text-sm font-semibold">Add Photo</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Hidden file input - capture="environment" opens rear camera directly on iPad */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                onChange={handlePhotoUpload}
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
              />

              {/* ARIA live region for upload progress - announces to screen readers */}
              <div
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className="sr-only"
              >
                {uploading && uploadProgress
                  ? `Uploading photo ${uploadProgress.current} of ${uploadProgress.total}`
                  : uploading
                  ? "Upload in progress"
                  : null}
              </div>

              {/* Empty state hint */}
              {photos.length === 0 && !uploading && (
                <p className="text-sm text-text-muted text-center py-4">
                  Tap above to add photos of the item
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ================================================================ */}
        {/* FOOTER - iPad-Optimized Button Hierarchy */}
        {/* ================================================================ */}
        <div className="px-5 py-4 border-t border-border bg-bg-secondary/50">
          {/* Primary Action: Advance Status (if available) */}
          {advanceConfig && (
            <button
              onClick={handleAdvanceStatus}
              disabled={advancing || saving || uploading || (restoration.status === "delivered_warehouse" && tagNumbers.length === 0)}
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
              ) : restoration.status === "delivered_warehouse" && tagNumbers.length === 0 ? (
                <>
                  <Tag className="w-5 h-5" aria-hidden="true" />
                  <span>Add Tag # to Check In</span>
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

          {/* Primary Action: Mark Resolved (for damaged items) */}
          {restoration.status === "damaged" && !restoration.resolved_at && (
            <button
              onClick={handleResolveDamaged}
              disabled={resolving || saving}
              aria-busy={resolving}
              aria-label="Mark as resolved - confirms CS has contacted customer about damage"
              className="w-full flex items-center justify-center gap-3 px-6 py-4 text-base font-bold text-white rounded-xl
                bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed
                min-h-[56px] mb-3 transition-all active:scale-[0.98]"
            >
              {resolving ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                  <span>Resolving...</span>
                </>
              ) : (
                <>
                  <CheckCircle className="w-5 h-5" aria-hidden="true" />
                  <span>Mark Resolved</span>
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
                  Save Changes
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ================================================================ */}
      {/* DAMAGE CONFIRMATION DIALOG */}
      {/* ================================================================ */}
      {showDamageDialog && (
        <div
          className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4"
          onMouseDown={() => {
            if (!damageConfirmed && !saving) {
              setShowDamageDialog(false);
              setSelectedDamageReason("");
            }
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="damage-dialog-title"
        >
          <div
            className="bg-bg-secondary rounded-2xl border border-border w-full max-w-md overflow-hidden"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* SUCCESS STATE - Show after damage confirmed */}
            {damageConfirmed ? (
              <div className="px-6 py-10 flex flex-col items-center justify-center text-center">
                <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mb-4 animate-bounce">
                  <CheckCircle className="w-10 h-10 text-emerald-400" />
                </div>
                <h3 className="text-xl font-semibold text-text-primary mb-2">
                  Damage Confirmed
                </h3>
                <p className="text-sm text-text-secondary">
                  Item moved to damaged section.
                </p>
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="px-6 py-4 border-b border-border bg-rose-500/10">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-rose-500/20 flex items-center justify-center">
                      <AlertTriangle className="w-5 h-5 text-rose-400" />
                    </div>
                    <div>
                      <h3 id="damage-dialog-title" className="text-lg font-semibold text-text-primary">
                        Mark as Damaged
                      </h3>
                      <p className="text-sm text-text-secondary">This action cannot be undone</p>
                    </div>
                  </div>
                </div>

                {/* Content */}
                <div className="px-6 py-5 space-y-4">
                  <p className="text-sm text-text-secondary">
                    Select a reason for marking this restoration as damaged. The item will be removed from the active pipeline.
                  </p>

                  {/* Reason Selection */}
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
                      Damage Reason
                    </label>
                    <div className="space-y-2">
                      {DAMAGE_REASONS.map((reason) => (
                        <button
                          key={reason.value}
                          onClick={() => setSelectedDamageReason(reason.value)}
                          className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                            selectedDamageReason === reason.value
                              ? "border-rose-500 bg-rose-500/10 text-text-primary"
                              : "border-border hover:border-border-hover bg-bg-tertiary/50 text-text-secondary hover:text-text-primary"
                          }`}
                        >
                          {reason.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-border bg-bg-tertiary/30 flex items-center justify-end gap-3">
                  <button
                    onClick={() => {
                      setShowDamageDialog(false);
                      setSelectedDamageReason("");
                    }}
                    className="px-4 py-2.5 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleMarkDamaged}
                    disabled={!selectedDamageReason || saving}
                    className={`px-5 py-2.5 text-sm font-semibold rounded-xl transition-all ${
                      selectedDamageReason && !saving
                        ? "bg-rose-500 text-white hover:bg-rose-600 active:scale-95"
                        : "bg-rose-500/30 text-rose-300/50 cursor-not-allowed"
                    }`}
                  >
                    {saving ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Processing...
                      </span>
                    ) : (
                      "Confirm Damage"
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* LIGHTBOX MODAL - Keyboard navigable (Escape, Arrow keys) */}
      {/* ================================================================ */}
      {lightboxIndex !== null && photos[lightboxIndex] && isValidPhotoUrl(photos[lightboxIndex]) && (
        <div
          className="fixed inset-0 z-[60] bg-black/95 flex items-center justify-center"
          onMouseDown={() => setLightboxIndex(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setLightboxIndex(null);
            } else if (e.key === "ArrowLeft" && photos.length > 1) {
              setLightboxIndex((prev) => (prev !== null ? (prev - 1 + photos.length) % photos.length : 0));
            } else if (e.key === "ArrowRight" && photos.length > 1) {
              setLightboxIndex((prev) => (prev !== null ? (prev + 1) % photos.length : 0));
            }
          }}
          tabIndex={0}
          role="dialog"
          aria-modal="true"
          aria-label={`Photo lightbox viewer. Photo ${lightboxIndex + 1} of ${photos.length}. Press Escape to close${photos.length > 1 ? ", arrow keys to navigate" : ""}.`}
        >
          {/* Close button */}
          <button
            onClick={() => setLightboxIndex(null)}
            className="absolute top-4 right-4 p-3 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-xl transition-colors min-w-[44px] min-h-[44px]"
            aria-label="Close lightbox (Escape)"
          >
            <X className="w-6 h-6" />
          </button>

          {/* Previous button */}
          {photos.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex((prev) => (prev !== null ? (prev - 1 + photos.length) % photos.length : 0));
              }}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-3 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-xl transition-colors min-w-[44px] min-h-[44px]"
              aria-label="Previous photo (Left arrow)"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}

          {/* Image */}
          <img
            src={photos[lightboxIndex]}
            alt={`Restoration photo ${lightboxIndex + 1} of ${photos.length}`}
            className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />

          {/* Next button */}
          {photos.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex((prev) => (prev !== null ? (prev + 1) % photos.length : 0));
              }}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-3 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-xl transition-colors min-w-[44px] min-h-[44px]"
              aria-label="Next photo (Right arrow)"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          )}

          {/* Photo counter */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-white/10 text-white/80 text-sm font-medium rounded-full" aria-hidden="true">
            {lightboxIndex + 1} / {photos.length}
          </div>
        </div>
      )}
    </div>
  );
}
