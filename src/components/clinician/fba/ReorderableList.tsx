"use client";

import type { ReactNode } from "react";
import { ChevronUp, ChevronDown, Trash2, Plus } from "lucide-react";

// Generic repeatable-entry list shared by Target Behaviours, Triggers,
// Setting Events, and the three Recommendations groups. No drag library
// exists anywhere else in this codebase (confirmed -- nothing uses
// pointer/touch drag), so reordering is up/down buttons: simpler, and
// works the same on mobile as desktop without extra libraries.
//
// Move/delete are structural edits with no natural "blur" moment, so the
// caller's `onChange` is expected to persist immediately. Field-level
// edits inside `renderItem` are the caller's own inputs -- those should
// keep the usual auto-save-on-blur behaviour, not save on every keystroke.
export function ReorderableList<T extends { id: string }>({
  items,
  onChange,
  onAdd,
  addLabel,
  emptyLabel,
  readOnly,
  renderItem,
}: {
  items: T[];
  onChange: (next: T[]) => void;
  onAdd: () => void;
  addLabel: string;
  emptyLabel: string;
  readOnly: boolean;
  renderItem: (item: T, index: number) => ReactNode;
}) {
  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function remove(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-brand-pastel-blue bg-white/60 p-6 text-center">
          <p className="text-sm text-brand-neutral-black/70">{emptyLabel}</p>
        </div>
      )}

      {items.map((item, index) => (
        <div key={item.id} className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">{renderItem(item, index)}</div>
            {!readOnly && (
              <div className="flex flex-shrink-0 flex-col items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Move up"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  className="text-brand-prussian-blue disabled:opacity-20"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  disabled={index === items.length - 1}
                  onClick={() => move(index, 1)}
                  className="text-brand-prussian-blue disabled:opacity-20"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Delete entry"
                  onClick={() => remove(index)}
                  className="mt-1.5 text-red-500"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      ))}

      {!readOnly && (
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-brand-pastel-blue py-3 text-sm font-semibold text-brand-prussian-blue"
        >
          <Plus className="h-4 w-4" /> {addLabel}
        </button>
      )}
    </div>
  );
}
