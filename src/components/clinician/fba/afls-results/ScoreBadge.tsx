import { AFLS_BADGES, type AflsBadgeValue } from "@/lib/fba/aflsResults";

// The one badge primitive reused by the legend, the accordion breakdown,
// and the print two-column tables. `print:` overrides drop the fill
// colours in favour of icon + text + a subtle border -- the ink-saving
// treatment the brief asks for on the actual printed page (the on-screen
// print PREVIEW still shows full colour; `print:` only activates for
// real print/print-to-PDF, matching every other print rule already in
// globals.css).
export function ScoreBadge({
  value,
  showLabel = false,
  size = "sm",
  className = "",
}: {
  value: AflsBadgeValue;
  showLabel?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const cfg = AFLS_BADGES[value];
  const dims = size === "md" ? "h-7 w-7 text-sm" : "h-6 w-6 text-xs";

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span
        aria-hidden="true"
        className={`inline-flex ${dims} flex-shrink-0 items-center justify-center rounded-full font-bold leading-none ${cfg.bgClass} ${cfg.textClass} ${cfg.borderClass ?? ""} print:border print:border-black/50 print:bg-transparent print:text-black`}
      >
        {cfg.icon}
      </span>
      {showLabel ? (
        <span className="text-xs font-medium text-brand-neutral-black/70 print:text-black">{cfg.label}</span>
      ) : (
        <span className="sr-only">{cfg.label}</span>
      )}
    </span>
  );
}
