// The Messages dashboard badge (Change 3) -- a scoped, one-time amendment
// to the zero-urgency rule: a count is allowed to render now, but ONLY in
// Prussian Blue with a white numeral, never red (red stays reserved
// app-wide for genuine alerts -- the Red Alerts row, the Calm escalation
// notice). No sounds, no pulsing, nothing else changes. Renders nothing
// at 0 -- a badge that can read "0" isn't quieter than no badge, it's a
// worse one.
export function CountBadge({ count }: { count: number | null | undefined }) {
  if (!count || count <= 0) return null;

  return (
    <span
      aria-label={`${count} awaiting your action`}
      className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-brand-prussian-blue px-1 text-[11px] font-bold text-white shadow-sm"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
