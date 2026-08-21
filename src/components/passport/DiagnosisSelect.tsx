"use client";

import { useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { DIAGNOSIS_OTHER, TIER_1_DIAGNOSES, TIER_2_DIAGNOSES } from "@/lib/diagnosisOptions";

// Two-tier diagnosis/neurotype picker: Tier 1 is a fixed, always-visible
// quick-select row; Tier 2 is every remaining option (alphabetical, plus
// the free-entry "Other" last) inside a bottom sheet, the app's own
// established pattern for a long, thumb-friendly, focused list (see
// AddChildSheet, ComposeMessageSheet, ShareBottomSheet). Multi-select
// throughout, unchanged from before -- this only restructures which
// options are visible without a tap, never what selecting one means.
//
// One implementation, both surfaces: this is the single component
// src/app/passport/section-a/page.tsx renders, and that one route is
// itself already shared between passport creation (fresh, empty
// `selected`) and the section edit flow (pre-populated from the
// stored passport) -- so no separate "creation vs edit" wiring exists
// to keep in sync.
export function DiagnosisSelect({
  selected,
  onToggle,
  otherValue,
  onOtherChange,
  onOtherBlur,
  readOnly = false,
}: {
  selected: string[];
  onToggle: (value: string) => void;
  otherValue: string;
  onOtherChange: (value: string) => void;
  onOtherBlur?: () => void;
  readOnly?: boolean;
}) {
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  // Anything selected that isn't one of the fixed Tier 1 options -- a
  // Tier 2 pick (including "Other" and, for an existing passport being
  // edited, any value that predates this restructure entirely, e.g.
  // "No Formal Diagnosis"). Rendered as its own row so the parent sees
  // every selection in one place without reopening the sheet -- the
  // "unified selected view" the brief calls for.
  const tier2Selected = selected.filter((value) => !TIER_1_DIAGNOSES.includes(value));

  function chipClass(isSelected: boolean) {
    return `rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
      isSelected
        ? "border-brand-prussian-blue bg-brand-pastel-blue/30 text-brand-prussian-blue"
        : "border-black/10 bg-white text-black/60 hover:bg-black/[0.02]"
    }`;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {TIER_1_DIAGNOSES.map((option) => {
          const isSelected = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              disabled={readOnly}
              onClick={() => onToggle(option)}
              className={chipClass(isSelected)}
            >
              {option}
            </button>
          );
        })}

        {!readOnly && (
          <button
            type="button"
            onClick={() => setIsMoreOpen(true)}
            className="rounded-full border border-dashed border-black/20 bg-white px-3 py-1.5 text-xs font-semibold text-brand-prussian-blue hover:bg-black/[0.02]"
          >
            + More options{tier2Selected.length > 0 ? ` (${tier2Selected.length})` : ""}
          </button>
        )}
      </div>

      {/* Tier 2 picks, surfaced right here too -- selecting from the
          sheet doesn't hide the choice back inside it; it shows up
          alongside Tier 1 like any other selection, and stays tappable
          to remove (unless read-only) without reopening the sheet. */}
      {tier2Selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tier2Selected.map((option) => (
            <button
              key={option}
              type="button"
              disabled={readOnly}
              onClick={() => onToggle(option)}
              className={chipClass(true)}
            >
              {option}
              {!readOnly && <span aria-hidden className="ml-1.5">×</span>}
            </button>
          ))}
        </div>
      )}

      {selected.includes(DIAGNOSIS_OTHER) && (
        <TextField
          label="Please specify"
          type="text"
          placeholder="Diagnosis not listed above"
          value={otherValue}
          onChange={(e) => onOtherChange(e.target.value)}
          onBlur={onOtherBlur}
          readOnly={readOnly}
          className="mt-1"
        />
      )}

      <BottomSheet isOpen={isMoreOpen} onClose={() => setIsMoreOpen(false)}>
        <h2 className="font-heading text-lg font-bold text-brand-neutral-black">
          More diagnosis options
        </h2>
        <div className="mt-4 flex max-h-[55vh] flex-col gap-1 overflow-y-auto">
          {TIER_2_DIAGNOSES.map((option) => {
            const isSelected = selected.includes(option);
            return (
              <button
                key={option}
                type="button"
                onClick={() => onToggle(option)}
                className={`flex items-center justify-between rounded-xl px-3 py-3 text-left text-sm font-medium transition-colors ${
                  isSelected
                    ? "bg-brand-pastel-blue/30 text-brand-prussian-blue"
                    : "text-brand-neutral-black hover:bg-black/[0.02]"
                }`}
              >
                <span>{option}</span>
                {isSelected && (
                  <span aria-hidden className="text-base font-bold">
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <Button type="button" onClick={() => setIsMoreOpen(false)} className="mt-5">
          Done
        </Button>
      </BottomSheet>
    </div>
  );
}
