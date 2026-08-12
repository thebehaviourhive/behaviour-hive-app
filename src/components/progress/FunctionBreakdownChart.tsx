import { HorizontalBarChart } from "@/components/clinician/fba/charts/HorizontalBarChart";
import type { FunctionTally } from "@/lib/progress/function";

// CLINICIAN-ONLY. This component itself has no role check -- the
// guarantee is structural, upstream: it's only ever imported by
// ProgressSurface's clinician-only render branch, and its data comes
// from useAbcFunctionData, which is the only client code path that can
// even fetch perceived_function for Progress. See the Stage B verify
// pass's grep check.
export function FunctionBreakdownChart({ tallies, taggedCount }: { tallies: FunctionTally[]; taggedCount: number }) {
  if (taggedCount === 0) {
    return (
      <p className="text-sm text-brand-neutral-black/50">
        No incidents in this period have a hypothesised function tagged yet.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <HorizontalBarChart bars={tallies} />
      <p className="text-xs text-brand-neutral-black/50">
        {taggedCount} tagged incident{taggedCount === 1 ? "" : "s"}
        {" "}in this period. Untagged incidents aren&apos;t counted here.
      </p>
    </div>
  );
}
