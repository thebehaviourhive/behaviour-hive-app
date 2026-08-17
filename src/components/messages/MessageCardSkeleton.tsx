// Loading placeholder matching MessageCard's compact collapsed row (Change
// 4), so a list's first paint doesn't jump once real cards arrive. Same
// animate-pulse idiom as MorningPupilCardSkeleton.
export function MessageCardSkeleton() {
  return (
    <div className="flex animate-pulse items-center gap-2 rounded-2xl border border-black/5 bg-white px-4 py-3 shadow-sm">
      <span className="h-2 w-2 flex-shrink-0 rounded-full bg-black/10" />
      <span className="h-4 w-16 flex-shrink-0 rounded-full bg-black/5" />
      <span className="h-3 min-w-0 flex-1 rounded bg-black/5" />
      <span className="h-3 w-10 flex-shrink-0 rounded bg-black/5" />
    </div>
  );
}
