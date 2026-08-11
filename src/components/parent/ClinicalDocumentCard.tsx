import Link from "next/link";
import type { ReactNode } from "react";

type CardAction = { label: string } & ({ href: string; onClick?: never } | { href?: never; onClick: () => void });

// The one generic shell every clinical-document card (FBA today, BSP
// once it's real) renders through -- state-to-copy mapping lives in the
// caller (ClinicalSupportSection), never here, so activating a new
// document type later is purely configuration: a new caller passing
// different props, not a new card design.
export function ClinicalDocumentCard({
  title,
  borderClassName,
  body,
  footnote,
  primaryAction,
  secondaryAction,
  disabled = false,
  disabledPillLabel,
}: {
  title: string;
  // e.g. "border-l-4 border-brand-pastel-blue" for a live state, or
  // undefined for the plain "no coloured border" states (A/B) -- colour
  // is reserved for live/actionable states, per the brand rule.
  borderClassName?: string;
  body: ReactNode;
  footnote?: ReactNode;
  primaryAction?: CardAction;
  secondaryAction?: CardAction;
  disabled?: boolean;
  disabledPillLabel?: string;
}) {
  return (
    <div
      className={`relative rounded-2xl border border-brand-off-white/50 bg-white p-5 shadow-[0_4px_20px_rgba(0,79,113,0.05)] ${borderClassName ?? ""} ${disabled ? "opacity-60" : ""}`}
    >
      {disabled && disabledPillLabel && (
        <span className="absolute right-4 top-4 rounded-full bg-brand-off-white px-3 py-1 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/60">
          {disabledPillLabel}
        </span>
      )}

      <h3 className="pr-24 font-heading text-lg font-bold text-brand-prussian-blue">{title}</h3>
      <div className="mt-2 text-sm text-brand-neutral-black">{body}</div>

      {(primaryAction || secondaryAction) && (
        <div className="mt-4 flex flex-col gap-2">
          {primaryAction &&
            (primaryAction.href ? (
              <Link
                href={primaryAction.href}
                className="block w-full rounded-2xl bg-brand-prussian-blue py-3 text-center text-sm font-semibold text-white"
              >
                {primaryAction.label}
              </Link>
            ) : (
              <button
                type="button"
                onClick={primaryAction.onClick}
                className="w-full rounded-2xl bg-brand-prussian-blue py-3 text-center text-sm font-semibold text-white"
              >
                {primaryAction.label}
              </button>
            ))}
          {secondaryAction &&
            (secondaryAction.href ? (
              <Link
                href={secondaryAction.href}
                className="block w-full text-center text-sm font-semibold text-brand-prussian-blue underline underline-offset-2"
              >
                {secondaryAction.label}
              </Link>
            ) : (
              <button
                type="button"
                onClick={secondaryAction.onClick}
                className="w-full text-center text-sm font-semibold text-brand-prussian-blue underline underline-offset-2"
              >
                {secondaryAction.label}
              </button>
            ))}
        </div>
      )}

      {footnote && <div className="mt-3 font-accent text-xs text-brand-neutral-black/50">{footnote}</div>}
    </div>
  );
}
