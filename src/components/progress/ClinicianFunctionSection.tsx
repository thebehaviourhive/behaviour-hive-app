"use client";

import { useMemo } from "react";
import { useAbcFunctionData } from "@/hooks/useAbcFunctionData";
import { tallyByFunction, taggedIncidentCount } from "@/lib/progress/function";
import { FunctionBreakdownChart } from "./FunctionBreakdownChart";
import type { DateRange } from "@/lib/progress/range";

// CLINICIAN-ONLY, and structurally so: this is the ONLY component in the
// Progress feature that calls useAbcFunctionData (the only hook that can
// fetch perceived_function). ProgressSurface only ever mounts this
// component inside its `role === "clinician"` branch -- for parent/
// teacher, this component is never mounted, so useAbcFunctionData's RPC
// call never fires, not just "renders nothing". That's the "absent
// entirely (UI+query)" guarantee, done at the mounting boundary rather
// than with an internal role check here.
export function ClinicianFunctionSection({ passportId, range }: { passportId: string; range: DateRange }) {
  const { entries, isLoading, loadError } = useAbcFunctionData(passportId);

  const tallies = useMemo(() => tallyByFunction(entries, range), [entries, range]);
  const taggedCount = useMemo(() => taggedIncidentCount(entries, range), [entries, range]);

  if (loadError) return null;
  if (isLoading) return <div className="h-24 animate-pulse rounded-2xl bg-brand-off-white" />;

  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <p className="mb-3 text-sm font-bold text-brand-neutral-black">Hypothesised function</p>
      <FunctionBreakdownChart tallies={tallies} taggedCount={taggedCount} />
    </div>
  );
}
