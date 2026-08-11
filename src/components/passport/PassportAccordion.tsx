"use client";

import Link from "next/link";
import { ChevronDown, Pencil } from "lucide-react";
import type { ReactNode } from "react";

// One collapsible content-section card for the passport dashboard.
// Purely presentational -- the page owns which sections are expanded
// (independent toggling, deep-link handling) and passes it down, so
// this component has no state of its own to drift out of sync with
// that.
export function PassportAccordion({
  id,
  title,
  hint,
  editHref,
  isExpanded,
  onToggle,
  children,
}: {
  // Also the deep-link hash target (e.g. "clinical-team" for
  // #clinical-team) -- scroll-mt-24 keeps it clear of the page's own
  // chrome when scrolled into view.
  id: string;
  title: string;
  hint?: string;
  editHref?: string;
  isExpanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      className="scroll-mt-24 rounded-2xl border border-brand-off-white/50 bg-white shadow-[0_4px_20px_rgba(0,79,113,0.05)]"
    >
      <div className="flex items-center gap-2 p-4">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="flex-shrink-0 font-heading text-lg font-bold text-brand-prussian-blue">{title}</span>
          {hint && (
            <span className="min-w-0 truncate rounded-full bg-brand-off-white px-3 py-1 font-accent text-xs font-semibold text-brand-neutral-black/60">
              {hint}
            </span>
          )}
        </button>

        {editHref && (
          <Link
            href={editHref}
            aria-label={`Edit ${title}`}
            className="flex-shrink-0 rounded-full p-1.5 text-brand-prussian-blue/50"
          >
            <Pencil size={16} strokeWidth={2} />
          </Link>
        )}

        <button
          type="button"
          onClick={onToggle}
          aria-label={isExpanded ? `Collapse ${title}` : `Expand ${title}`}
          className="flex-shrink-0"
        >
          <ChevronDown
            size={20}
            strokeWidth={2}
            className={`text-brand-neutral-black/40 transition-transform duration-300 ${isExpanded ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {/* grid-template-rows 0fr -> 1fr is what gives the height
          animation its smoothness without measuring real pixel heights
          -- the inner overflow-hidden wrapper is required for the
          0fr-collapsed row track to actually clip its content. */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-in-out"
        style={{ gridTemplateRows: isExpanded ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
