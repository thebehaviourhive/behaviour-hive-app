"use client";

import { useState } from "react";

// Passport ID -- Daniel's own two requirements, built first: named
// distinctly from the claim code (that screen keeps its own "Claim
// code"/"Enter your child's passport code" wording everywhere; this is
// always labelled "Passport ID", never "code" or "passport code", so a
// clinician reading one aloud to a parent can never confuse the two),
// and always the STORED value (passports.passport_reference, migration
// 0289) -- every call site here receives it from a widened RPC/query
// that reads the column directly, never recomputes it, so this badge
// and a real Google Calendar event summary can never disagree.
//
// Clinic-only is enforced by every CALLER, not this component -- the
// same passport_reference column exists on every passport regardless
// of institution type (it's a harmless-to-widen shared RPC return, see
// migration 0290's own header), so this component has no institution-
// type of its own to check. Every render site below only ever renders
// this inside an institutionType === "clinic" branch.
//
// TWO SHAPES, deliberately: `copyable` (default true) renders a real
// button with one-tap copy-to-clipboard, matching this codebase's own
// established pattern (principal/clinic/page.tsx's "Copy Code") --
// used on the detail/header surfaces, where a clinician is actually
// about to go write this into their calendar. `copyable={false}`
// renders plain, still-selectable text with no button at all -- used
// on list/card rows, every one of which is already a whole-row <Link>;
// nesting a <button> inside an <a> is invalid HTML two ways over (a
// browser can close the anchor early, and React's own hydration would
// warn), so a list row gets a readable label, not a tap target, and a
// director/clinician wanting to copy one opens the record itself.
export function PassportIdBadge({
  reference,
  copyable = true,
  size = "sm",
}: {
  reference: string;
  copyable?: boolean;
  size?: "sm" | "lg";
}) {
  const [isCopied, setIsCopied] = useState(false);

  function handleCopy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(reference);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 1500);
  }

  const label = (
    <>
      <span className={`font-accent font-bold uppercase tracking-wide text-brand-neutral-black/40 ${size === "lg" ? "text-eyebrow" : "text-[10px]"}`}>
        Passport ID
      </span>
      <span
        className={`font-heading font-bold tracking-widest text-brand-prussian-blue ${size === "lg" ? "text-sm" : "text-xs"}`}
      >
        {reference}
      </span>
    </>
  );

  if (!copyable) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.04] px-2.5 py-1">
        {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Copy Passport ID"
      className={`inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white text-left ${
        size === "lg" ? "px-3 py-1.5" : "px-2.5 py-1"
      }`}
    >
      {label}
      <span className="text-xs font-semibold text-brand-neutral-black/40">{isCopied ? "Copied!" : "Copy"}</span>
    </button>
  );
}
