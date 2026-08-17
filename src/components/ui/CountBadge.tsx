// The waiting-count badge (Messages refinements, Change 3) -- a scoped,
// one-time amendment to the zero-urgency rule: a count is allowed to
// render now, but ONLY in Prussian Blue with a white numeral, never red
// (red stays reserved app-wide for genuine alerts -- the Red Alerts row,
// the Calm escalation notice). No sounds, no pulsing, nothing else
// changes. Renders nothing at 0 -- a badge that can read "0" isn't
// quieter than no badge, it's a worse one.
//
// One component, two call sites: the dashboard quick-action tiles
// ("default") and the bottom-nav Messages icon ("small", NAV + HEADER
// round) -- same visual language, scaled to fit.
export function CountBadge({
  count,
  size = "default",
}: {
  count: number | null | undefined;
  size?: "default" | "small";
}) {
  if (!count || count <= 0) return null;

  const sizeClassName =
    size === "small"
      ? "-right-1 -top-1 h-3.5 min-w-[0.875rem] px-0.5 text-[8px]"
      : "-right-1.5 -top-1.5 h-5 min-w-[1.25rem] px-1 text-[11px]";

  return (
    <span
      aria-label={`${count} awaiting your action`}
      className={`absolute flex items-center justify-center rounded-full bg-brand-prussian-blue font-bold text-white shadow-sm ${sizeClassName}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
