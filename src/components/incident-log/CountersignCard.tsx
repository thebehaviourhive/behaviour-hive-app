"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { AddAmendmentSheet } from "@/components/incident-log/AddAmendmentSheet";

// Phase 4, piece 3. Rendered for a principal (or countersign_incident
// grant holder) once the incident is teacher-signed. Self-hides
// entirely (returns null) for anyone who can't countersign -- the same
// idiom as AttestationCard -- rather than the parent page trying to
// pre-determine who can_countersign_incident() before rendering.
//
// The teacher's full record is already rendered read-only above this
// card by the parent page (can_view_incident()'s countersigner branch
// covers that) -- this card doesn't repeat it. What it DOES show is
// everything get_countersign_summary() carries that the teacher's own
// stage-two form doesn't: who attested, who didn't, who couldn't, any
// addendum in full, and any withdrawal with its reason -- prominently,
// not a footnote. A countersign screen that shows less than the
// teacher saw is a rubber stamp.
//
// Countersign is a procedural close-out, not a personal endorsement --
// the copy here is deliberate about that distinction (confirmed
// wording). "Add an amendment" sits at equal visual weight next to
// "Countersign", same size, same solid treatment, distinguished only
// by colour -- disagreement has to be as easy as agreement.

interface StaffAttestation {
  incident_staff_id: string;
  name: string;
  involvement: string | null;
  has_account: boolean;
  status: string;
  status_label: string;
  addendum: string | null;
  attested_at: string | null;
  withdrawal_reason: string | null;
  withdrawn_at: string | null;
}

interface CountersignSummary {
  staff_attestations: StaffAttestation[];
  teacher_signed_at: string;
  teacher_signed_by_name: string | null;
  anyone_injured: { value: boolean | null; note: string | null };
  already_countersigned: boolean;
  countersigned_at: string | null;
  countersigned_by_name: string | null;
  countersigned_role_at_time: string | null;
  countersigned_via: string | null;
}

const STATUS_PILL_CLASS: Record<string, string> = {
  not_attested: "bg-black/5 text-brand-neutral-black/60",
  stale: "bg-brand-golden-brown/15 text-brand-golden-brown",
  withdrawn: "bg-black/5 text-brand-neutral-black/60",
  current: "bg-brand-pastel-blue/20 text-brand-prussian-blue",
};

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return (
    d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" })
  );
}

// Only worth stating when it adds information beyond the role itself --
// "principal, as principal" is a tautology, but "class_teacher, via a
// countersign grant" tells the reader something the role alone doesn't
// (a grant holder countersigning outside their ordinary role).
function ViaLabel(via: string | null): string {
  if (via === "grant") return "via a countersign grant";
  return "";
}

// A staff member can carry BOTH an attested_at and a withdrawn_at at
// once (withdrew, then re-attested, or attested after an earlier
// withdrawal) -- both genuinely happened. Rendered as a sequence in
// chronological order, never as two simultaneous, contradictory
// "current" states.
function StaffHistory({ staff }: { staff: StaffAttestation }) {
  const events: { at: string; node: React.ReactNode }[] = [];
  if (staff.attested_at) {
    events.push({
      at: staff.attested_at,
      node: (
        <p key="attested" className="text-sm text-brand-neutral-black">
          Attested {formatDateTime(staff.attested_at)}
          {staff.addendum && (
            <span className="mt-1 block italic text-brand-neutral-black/70">&quot;{staff.addendum}&quot;</span>
          )}
        </p>
      ),
    });
  }
  if (staff.withdrawn_at) {
    events.push({
      at: staff.withdrawn_at,
      node: (
        <div key="withdrawn" className="rounded-xl border border-brand-golden-brown/30 bg-brand-golden-brown/10 p-3">
          <p className="text-sm font-semibold text-brand-golden-brown">Withdrew {formatDateTime(staff.withdrawn_at)}</p>
          {staff.withdrawal_reason && (
            <p className="mt-1 text-sm italic text-brand-neutral-black">&quot;{staff.withdrawal_reason}&quot;</p>
          )}
        </div>
      ),
    });
  }
  events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  if (events.length === 0) return null;
  return <div className="mt-2 flex flex-col gap-2">{events.map((e) => e.node)}</div>;
}

interface CountersignCardProps {
  incidentId: string;
  userId: string;
  onCountersigned: () => void;
}

export function CountersignCard({ incidentId, userId, onCountersigned }: CountersignCardProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [summary, setSummary] = useState<CountersignSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notPermitted, setNotPermitted] = useState(false);

  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [isAmendOpen, setIsAmendOpen] = useState(false);

  // Pure fetch, no setState of its own -- deliberately separated from
  // the setters so both the mount effect and the post-amendment reload
  // in onAdded can call it without the effect itself reaching into a
  // component-scope function that sets state (react-hooks/set-state-in-effect
  // flags that shape even though it's safely async; see AttestationCard
  // for the same fix, established earlier this session).
  type CountersignData =
    | { kind: "ok"; summary: CountersignSummary }
    | { kind: "not_permitted" }
    | { kind: "error"; message: string };

  async function fetchCountersignData(): Promise<CountersignData> {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_countersign_summary", { p_incident_id: incidentId });
    if (error) {
      // Distinguishes "not yours to countersign" from a genuine load
      // failure -- the former is expected for most viewers of this page
      // and should self-hide silently, same as AttestationCard does for
      // someone not named on the incident.
      if (/permission|may view/i.test(error.message)) {
        return { kind: "not_permitted" };
      }
      return { kind: "error", message: error.message };
    }
    return { kind: "ok", summary: data as CountersignSummary };
  }

  function applyCountersignData(result: CountersignData) {
    setNotPermitted(result.kind === "not_permitted");
    setLoadError(result.kind === "error" ? result.message : null);
    setSummary(result.kind === "ok" ? result.summary : null);
    setIsLoading(false);
  }

  useEffect(() => {
    let isMounted = true;
    async function load() {
      const result = await fetchCountersignData();
      if (!isMounted) return;
      applyCountersignData(result);
    }
    load();
    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId]);

  async function handleConfirmCountersign() {
    setIsSigning(true);
    setSignError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("countersign_incident", { p_incident_id: incidentId });
    setIsSigning(false);
    if (error) {
      setSignError(error.message);
      return;
    }
    setIsConfirmOpen(false);
    onCountersigned();
  }

  if (isLoading) {
    return <div className="h-32 animate-pulse rounded-2xl bg-brand-off-white/60" />;
  }

  if (notPermitted) {
    return null;
  }

  if (loadError || !summary) {
    return (
      <p role="alert" className="text-sm font-medium text-red-600">
        Couldn&apos;t load the countersign summary: {loadError ?? "unknown error"}
      </p>
    );
  }

  const notAttested = summary.staff_attestations.filter((s) => !s.attested_at && !s.withdrawn_at);

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <div>
        <h2 className="font-heading text-lg font-bold text-brand-prussian-blue">Countersign</h2>
        <p className="mt-1 text-sm text-brand-neutral-black/70">
          Signed off by {summary.teacher_signed_by_name ?? "the owning teacher"} on {formatDateTime(summary.teacher_signed_at)}.
        </p>
      </div>

      {summary.staff_attestations.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">Staff attestations</p>
          {summary.staff_attestations.map((s) => (
            <div key={s.incident_staff_id} className="rounded-xl border border-black/5 bg-black/[0.015] p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-brand-neutral-black">
                  {s.name}
                  {s.involvement && <span className="font-normal text-brand-neutral-black/50"> · {s.involvement}</span>}
                </p>
                <span className={`flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_PILL_CLASS[s.status] ?? ""}`}>
                  {s.status_label}
                </span>
              </div>
              <StaffHistory staff={s} />
            </div>
          ))}
        </div>
      )}

      {notAttested.length > 0 && (
        <p className="text-xs text-brand-neutral-black/50">
          {notAttested.length} of the above {notAttested.length === 1 ? "has" : "have"} not attested -- this does not block countersigning.
        </p>
      )}

      {summary.already_countersigned ? (
        <p className="rounded-2xl border border-brand-pastel-blue/40 bg-brand-pastel-blue/10 p-4 text-sm text-brand-neutral-black">
          Countersigned by {summary.countersigned_by_name ?? "someone"} ({summary.countersigned_role_at_time ?? "unknown role"}
          {ViaLabel(summary.countersigned_via) && <>, {ViaLabel(summary.countersigned_via)}</>}) on{" "}
          {summary.countersigned_at && formatDateTime(summary.countersigned_at)}.
        </p>
      ) : (
        <>
          <p className="text-sm text-brand-neutral-black/80">
            Countersigning confirms the sign-off process was correctly followed. It is not a statement that you agree
            with everything written here.
          </p>
          <p className="text-sm text-brand-neutral-black/80">
            If any part of this account doesn&apos;t match your understanding, add an amendment -- attributed to
            you, dated, sitting alongside the record without changing a word of the teacher&apos;s account.
            Countersigning is still required either way.
          </p>

          <div className="flex gap-2">
            <Button type="button" onClick={() => setIsConfirmOpen(true)} className="flex-1">
              Countersign
            </Button>
            <Button type="button" onClick={() => setIsAmendOpen(true)} className="flex-1 !bg-brand-golden-brown">
              Add an amendment
            </Button>
          </div>
        </>
      )}

      <BottomSheet isOpen={isConfirmOpen} onClose={() => !isSigning && setIsConfirmOpen(false)}>
        <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Countersign this incident?</h2>
        <p className="mt-2 text-sm text-brand-neutral-black/70">
          This is permanent and cannot be undone. The record is closed and can never be edited again. Amendments can
          still be added afterwards.
        </p>

        {signError && (
          <p role="alert" className="mt-3 text-sm font-medium text-red-600">
            {signError}
          </p>
        )}

        <Button type="button" onClick={handleConfirmCountersign} disabled={isSigning} className="mt-6">
          {isSigning ? "Countersigning…" : "Countersign"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setIsConfirmOpen(false)}
          disabled={isSigning}
          className="mt-2 !border-black/10 !text-black/60"
        >
          Cancel
        </Button>
      </BottomSheet>

      <AddAmendmentSheet
        incidentId={incidentId}
        authorId={userId}
        isOpen={isAmendOpen}
        onClose={() => setIsAmendOpen(false)}
        onAdded={async () => {
          setIsAmendOpen(false);
          applyCountersignData(await fetchCountersignData());
        }}
      />
    </div>
  );
}
