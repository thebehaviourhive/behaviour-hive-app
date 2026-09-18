"use client";

import { useClinicalPlansForPassport } from "@/hooks/useClinicalPlansForPassport";
import { PLAN_TYPE_LABELS } from "@/lib/clinicalPlans";
import { InlineErrorState } from "@/components/ui/InlineErrorState";

// PRD 7 -- the Silo 2 placeholders' own school-facing read surface.
// Mounted alongside ClinicalTeamSection wherever that already sits
// (teacher/principal/SNA's own "Clinical Team" tab) -- a genuinely
// separate table and RPC, not folded into passport_clinical_content,
// so it's its own small section rather than a branch inside
// ClinicalTeamSection's existing item-type switch.
//
// get_clinical_plans_for_passport() already resolves visibility
// (_clinical_plan_is_school_visible(), has_child_access()/principal) --
// this component renders exactly what it returns, nothing filtered a
// second time client-side. A clinic_only plan, or one this viewer has
// no standing to see, simply never appears here at all -- no "hidden"
// placeholder, no count of what's missing, matching the same silent-
// absence posture the rest of this schema's own school-visibility
// surfaces already take.
export function ClinicalPlansSection({ passportId }: { passportId: string }) {
  const { plans, loadError, reload } = useClinicalPlansForPassport(passportId);

  if (plans === null && !loadError) {
    return <div className="h-20 animate-pulse rounded-2xl bg-white" />;
  }

  if (loadError) {
    return <InlineErrorState message={loadError} onRetry={reload} />;
  }

  if ((plans ?? []).length === 0) {
    return null;
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      <p className="font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">Plans</p>
      {(plans ?? []).map((plan) => (
        <div key={plan.id} className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-brand-neutral-black">{plan.name}</p>
            <span className="flex-shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-xs font-semibold text-brand-neutral-black/50">
              {PLAN_TYPE_LABELS[plan.planType]}
            </span>
          </div>
          {plan.body && <p className="mt-1.5 whitespace-pre-wrap text-sm text-brand-neutral-black/70">{plan.body}</p>}
          <p className="mt-1.5 text-xs text-brand-neutral-black/40">
            {new Date(plan.planDate).toLocaleDateString("en-IE")}
            {plan.authorName ? ` · From ${plan.authorName}` : ""}
          </p>
        </div>
      ))}
    </div>
  );
}
