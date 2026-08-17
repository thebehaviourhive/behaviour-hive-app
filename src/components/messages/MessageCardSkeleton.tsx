// Loading placeholder matching MessageCard's own shape/spacing, so a
// list's first paint doesn't jump once real cards arrive. Same
// animate-pulse idiom as MorningPupilCardSkeleton.
export function MessageCardSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="h-5 w-24 rounded-full bg-black/5" />
        <span className="h-5 w-14 rounded-full bg-black/5" />
      </div>
      <span className="mt-3 block h-3.5 w-32 rounded bg-black/10" />
      <span className="mt-2 block h-3.5 w-full rounded bg-black/5" />
      <span className="mt-1.5 block h-3 w-16 rounded bg-black/5" />
    </div>
  );
}
