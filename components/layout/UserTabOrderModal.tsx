"use client";

import { useState, useCallback, useEffect } from "react";
import { X, GripVertical, RotateCcw } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAuth } from "@/lib/auth";
import { DashboardTab, TAB_CONFIG } from "@/lib/auth/permissions";

interface SortableTabItemProps {
  tab: DashboardTab;
}

function SortableTabItem({ tab }: SortableTabItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const config = TAB_CONFIG[tab];

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        flex items-center gap-3 px-4 py-3 rounded-lg bg-bg-tertiary border border-border/30
        transition-all duration-150
        ${isDragging ? "opacity-50 scale-[1.02] shadow-lg z-10" : ""}
      `}
    >
      <button
        className="touch-none p-1 text-text-muted hover:text-text-secondary cursor-grab active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <span className="text-sm font-medium text-text-primary flex-1">
        {config.label}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-text-muted px-2 py-0.5 rounded bg-bg-secondary">
        {config.group}
      </span>
    </div>
  );
}

interface UserTabOrderModalProps {
  onClose: () => void;
}

export default function UserTabOrderModal({ onClose }: UserTabOrderModalProps) {
  const { accessibleTabs, userTabOrder, updateUserTabOrder } = useAuth();

  // Local state for tabs being reordered (initialized from accessibleTabs which already respects userTabOrder)
  const [orderedTabs, setOrderedTabs] = useState<DashboardTab[]>(accessibleTabs);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Track if user has a custom order
  const hasCustomOrder = userTabOrder !== null && userTabOrder.length > 0;

  // Check for changes compared to original
  useEffect(() => {
    if (!hasCustomOrder) {
      // If no custom order, any reordering is a change
      const originalOrder = accessibleTabs.join(",");
      const currentOrder = orderedTabs.join(",");
      setHasChanges(originalOrder !== currentOrder);
    } else {
      // Compare to saved custom order
      const savedOrder = userTabOrder.filter(t => accessibleTabs.includes(t)).join(",");
      const currentOrder = orderedTabs.join(",");
      setHasChanges(savedOrder !== currentOrder);
    }
  }, [orderedTabs, userTabOrder, accessibleTabs, hasCustomOrder]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setOrderedTabs((items) => {
        const oldIndex = items.indexOf(active.id as DashboardTab);
        const newIndex = items.indexOf(over.id as DashboardTab);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  }, []);

  const handleReset = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    try {
      await updateUserTabOrder(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset order");
    } finally {
      setIsSaving(false);
    }
  }, [updateUserTabOrder, onClose]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    try {
      await updateUserTabOrder(orderedTabs);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save order");
    } finally {
      setIsSaving(false);
    }
  }, [updateUserTabOrder, orderedTabs, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-bg-secondary rounded-xl border border-border shadow-xl w-full max-w-md max-h-[85vh] overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
          <div>
            <h3 className="text-lg font-medium text-text-primary">
              Customize Tab Order
            </h3>
            <p className="text-xs text-text-muted mt-0.5">
              Drag tabs to reorder your navigation
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-text-muted hover:text-text-secondary rounded-lg hover:bg-white/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5 overflow-y-auto max-h-[50vh] space-y-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={orderedTabs}
              strategy={verticalListSortingStrategy}
            >
              {orderedTabs.map((tab) => (
                <SortableTabItem key={tab} tab={tab} />
              ))}
            </SortableContext>
          </DndContext>
        </div>

        {/* Error */}
        {error && (
          <div className="px-6 py-2 text-sm text-status-bad bg-status-bad/10">
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border/50 bg-bg-tertiary/30">
          <div>
            {hasCustomOrder && (
              <button
                onClick={handleReset}
                disabled={isSaving}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-muted hover:text-status-warning transition-colors disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset to Default
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
              className={`
                px-4 py-2 rounded-lg text-sm font-medium transition-all
                ${hasChanges && !isSaving
                  ? "bg-accent-blue text-white hover:bg-accent-blue/90"
                  : "bg-bg-tertiary text-text-muted cursor-not-allowed"
                }
              `}
            >
              {isSaving ? "Saving..." : "Save Order"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
