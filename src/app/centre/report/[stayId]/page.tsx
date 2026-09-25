"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useInstitutionMembership } from "@/hooks/useInstitutionMembership";
import { useRespiteReport } from "@/hooks/useRespiteReport";
import { useMessageThread } from "@/hooks/useMessageThread";
import { CentrePageContent } from "@/components/respite/CentrePageContent";

// TIER 2 of the reachability pass -- a report-drafting surface for
// finalize_respite_stay_report(), which had a real, verified RPC and
// no screen. PRD 11 section 7's own shape: care staff contribute
// during the stay (check-ins, handovers, ABC entries), a manager
// assembles and finalises. This screen is that assembly point --
// reference material read-only above, one body field, one deliberate,
// irreversible Finalise action below (the RPC itself has no separate
// "save draft" -- a manager may revisit and re-finalise the body right
// up until finalized_at is set, but once set, the RPC refuses outright).
//
// Manager-only, matching finalize_respite_stay_report()'s own caller
// check. Handover messages are read here via the same useMessageThread
// component RespiteChildRecord already uses -- deliberately BEFORE
// finalising, since finalize_respite_stay_report() closes this stay's
// open activation in the same transaction, and handover is activation-
// scoped for both roles (Stage 5's own decision). Once closed, this
// same query may return nothing for a past stay -- not distinguishable
// client-side from "there were none," a known limitation.
export default function RespiteReportPage() {
  const params = useParams<{ stayId: string }>();
  const stayId = params.stayId;
  const { user, isReady } = useRequireRole("centre_manager");
  const membership = useInstitutionMembership(user?.id, "centre_manager");
  const router = useRouter();

  const { data, isLoading, loadError, finalize, isFinalizing, finalizeError } = useRespiteReport(stayId);
  const thread = useMessageThread(data?.passportId ?? null);
  const handoverMessages = thread.messages.filter((m) => m.categoryLabel === "Handover");

  const [body, setBody] = useState<string | null>(null);
  const [confirmingFinalize, setConfirmingFinalize] = useState(false);

  if (!isReady || membership.status !== "approved" || !user || !membership.institutionId) {
    return null;
  }
  if (isLoading) return null;
  if (loadError || !data) {
    return (
      <main className="min-h-full bg-brand-off-white/40 px-4 py-4">
        <p className="text-sm text-red-600">{loadError ?? "Couldn't load this stay."}</p>
      </main>
    );
  }

  const isFinalized = Boolean(data.finalizedAt);
  const currentBody = body ?? data.existingBody ?? "";

  async function handleFinalize() {
    const ok = await finalize(currentBody);
    if (ok) setConfirmingFinalize(false);
  }

  return (
    <main className="min-h-full bg-brand-off-white/40 px-4 py-4 pb-24">
      <CentrePageContent>
        <h1 className="mb-1 font-heading text-2xl font-semibold text-brand-neutral-black">
          Post-stay report -- {data.childName ?? "this child"}
        </h1>
        <p className="mb-6 text-sm text-black/60">
          {new Date(data.startsAt).toLocaleDateString()} -- {new Date(data.endsAt).toLocaleDateString()}
        </p>

      <section className="mb-4 rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
        <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
          Check-ins
        </h2>
        {data.checkins.length === 0 ? (
          <p className="text-sm text-black/40">No check-ins recorded.</p>
        ) : (
          <ul className="space-y-1 text-sm text-brand-neutral-black">
            {data.checkins.map((c) => (
              <li key={c.id}>
                {c.checkInType === "morning" ? "Morning" : "End of day"} --{" "}
                {new Date(`${c.checkInDate}T00:00:00`).toLocaleDateString(undefined, {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}
                {c.note ? `: ${c.note}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-4 rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
        <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
          ABC entries during this stay
        </h2>
        {data.abcEntries.length === 0 ? (
          <p className="text-sm text-black/40">No ABC entries recorded during this stay.</p>
        ) : (
          <ul className="space-y-2 text-sm text-brand-neutral-black">
            {data.abcEntries.map((entry) => (
              <li key={entry.id} className="rounded-lg bg-brand-off-white/60 p-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-black/50">
                  {new Date(entry.incidentDate).toLocaleDateString()}
                </p>
                <p>{[...entry.behaviours, ...(entry.behaviourOther ? [entry.behaviourOther] : [])].join(", ")}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-4 rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
        <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
          Handovers written during this stay
        </h2>
        {handoverMessages.length === 0 ? (
          <p className="text-sm text-black/40">
            No handovers currently readable for this stay. (Handover access closes with the stay&apos;s activation --
            read these before finalising.)
          </p>
        ) : (
          <ul className="space-y-2 text-sm text-brand-neutral-black">
            {handoverMessages.map((m) => (
              <li key={m.id} className="rounded-lg bg-brand-off-white/60 p-2">
                {m.body}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
        <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
          Report
        </h2>
        {isFinalized ? (
          <>
            <p className="mb-2 text-xs font-semibold text-brand-golden-brown">
              Finalised {new Date(data.finalizedAt as string).toLocaleDateString()}
            </p>
            <p className="whitespace-pre-wrap text-sm text-brand-neutral-black">{data.existingBody}</p>
          </>
        ) : (
          <>
            <textarea
              value={currentBody}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              placeholder="Summarise how this stay went -- what worked, what changed, anything the family or the next stay should know."
              className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
            />

            {finalizeError && (
              <p role="alert" className="mt-3 text-sm font-medium text-red-600">
                {finalizeError}
              </p>
            )}

            {!confirmingFinalize ? (
              <button
                type="button"
                onClick={() => setConfirmingFinalize(true)}
                disabled={!currentBody.trim()}
                className="mt-4 w-full rounded-full bg-brand-golden-brown px-4 py-3 text-center text-sm font-semibold text-white disabled:bg-black/10 disabled:text-black/40"
              >
                Finalise report
              </button>
            ) : (
              <div className="mt-4 rounded-xl bg-brand-golden-brown/10 p-3">
                <p className="text-sm text-brand-neutral-black">
                  Finalising closes this stay&apos;s activation -- care staff will lose access to this child&apos;s
                  record through this stay. This cannot be undone.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={handleFinalize}
                    disabled={isFinalizing}
                    className="flex-1 rounded-full bg-brand-golden-brown px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {isFinalizing ? "Finalising…" : "Yes, finalise"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingFinalize(false)}
                    className="flex-1 rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-black/60"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>

        <button
          type="button"
          onClick={() => router.push("/centre/dashboard")}
          className="mt-4 w-full text-center text-sm font-semibold text-brand-prussian-blue"
        >
          Back to dashboard
        </button>
      </CentrePageContent>
    </main>
  );
}
