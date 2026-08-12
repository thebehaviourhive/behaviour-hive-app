// The Progress feature's one reusable empty/sparse-state component,
// covering all three states constraint A3 calls for:
//   - zero data       -> full={true}, no chart rendered alongside it
//   - sparse/below-threshold -> full={false}, rendered ABOVE/BELOW the
//     caller's own partial chart (the chart itself still renders --
//     "honest partial chart", never hidden)
//   - single-source (e.g. no teacher linked yet) -> full={false}, same
//     compact banner, used as an inline note beside whatever data does
//     exist
//
// No illustrated empty state exists anywhere else in this app today --
// every one is a plain dashed-border text box (see EmptyCard,
// RecentUpdatesCard). This is deliberately the first: an emoji-in-circle
// icon, matching the one place the app DOES use that idiom
// (QuestionnairePromptCard's golden prompt-card family), not a new
// illustration asset/pipeline.
export function ProgressEmptyState({
  icon,
  title,
  body,
  full = true,
}: {
  icon: string;
  title: string;
  body: string;
  // false = compact inline banner, paired alongside a partial chart or
  // other real content. true = the only thing rendered in that slot.
  full?: boolean;
}) {
  if (!full) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border-l-4 border-brand-golden-brown bg-brand-safe-ivory/30 p-3.5">
        <span
          aria-hidden
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-brand-golden-brown/20 text-base"
        >
          {icon}
        </span>
        <p className="flex-1 text-xs leading-relaxed text-brand-neutral-black">
          <span className="font-semibold">{title}.</span> {body}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-brand-pastel-blue bg-white/60 px-6 py-10 text-center">
      <span
        aria-hidden
        className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-pastel-blue/30 text-3xl"
      >
        {icon}
      </span>
      <div>
        <p className="font-heading text-base font-bold text-brand-prussian-blue">{title}</p>
        <p className="mt-1 text-sm text-brand-neutral-black/70">{body}</p>
      </div>
    </div>
  );
}
