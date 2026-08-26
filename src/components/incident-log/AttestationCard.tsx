"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { BottomSheet } from "@/components/ui/BottomSheet";

// Phase 4, piece 2. Rendered for ANY named staff member with a real
// account -- not just the owning teacher, who gets their own separate
// Sign-off section (SignOffCard). Deliberately a different card, a
// different voice: this is someone reading an account they didn't
// write and deciding whether to put their name to it, not another
// field in the teacher's form. It sits below the incident's own
// content (already rendered read-only above, for anyone who can see
// this page at all) rather than duplicating it.
//
// Language is plain and first-person throughout, per the brief: "I was
// present and this account is accurate" -- never "confirm", "approve",
// or "acknowledge". Withdrawal is a visible action, not a menu item.

interface AttestationEvent {
  action: "attested" | "withdrawn";
  addendum: string | null;
  withdrawal_reason: string | null;
  created_at: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  narrative: "the narrative",
  children: "a child's distress or whether they remained on site",
  actions: "the actions taken",
  restrictive_practices: "a restrictive practice record",
  injuries: "an injury record",
  body_marks: "a body-map marker",
};

function whatChangedLine(categories: string[] | null): string {
  if (!categories || categories.length === 0) {
    // Pre-category-tracking attestation (see get_stale_categories()'s
    // own honest degrade) -- something changed, which of the six isn't
    // known for this one.
    return "Something on this record has changed since you attested.";
  }
  if (categories.length === 1 && categories[0] === "attestation_reset") {
    return "Attestations were withdrawn and re-requested from scratch since you last attested -- nothing else may have changed.";
  }
  const named = categories.filter((c) => c !== "attestation_reset").map((c) => CATEGORY_LABEL[c] ?? c);
  const prefix = categories.includes("attestation_reset") ? "Attestations were re-requested, and " : "";
  return `${prefix}Changed since you attested: ${named.join(", ")}.`;
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return (
    d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" })
  );
}

interface AttestationCardProps {
  incidentId: string;
  isClosed: boolean;
}

export function AttestationCard({ incidentId, isClosed }: AttestationCardProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [incidentStaffId, setIncidentStaffId] = useState<string | null>(null);
  const [involvement, setInvolvement] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [staleCategories, setStaleCategories] = useState<string[] | null>(null);
  const [latestAttested, setLatestAttested] = useState<AttestationEvent | null>(null);
  const [latestWithdrawn, setLatestWithdrawn] = useState<AttestationEvent | null>(null);

  const [addendum, setAddendum] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  // Pure fetch, no setState of its own -- deliberately separated from
  // the setters so BOTH the mount effect and the post-action refreshes
  // in handleAttest/handleWithdraw can call it without the effect
  // itself reaching into a component-scope function that sets state
  // (react-hooks/set-state-in-effect flags that shape even though it's
  // safely async; every setState call must happen in the caller, gated
  // on the caller's own still-mounted/still-current check).
  type AttestationData = {
    incidentStaffId: string;
    involvement: string | null;
    status: string | null;
    staleCategories: string[] | null;
    latestAttested: AttestationEvent | null;
    latestWithdrawn: AttestationEvent | null;
  };

  async function fetchAttestationData(): Promise<AttestationData | null> {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: staffRow } = await supabase
      .from("incident_staff")
      .select("id, involvement")
      .eq("incident_id", incidentId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!staffRow) {
      // Not named on this incident with a real account -- nothing to
      // show. Named-but-free-text has no account to reach this page
      // with at all, so that case never arises here.
      return null;
    }

    const { data: statusResult } = await supabase.rpc("get_attestation_status", { p_incident_staff_id: staffRow.id });

    let staleCategories: string[] | null = null;
    if (statusResult === "stale") {
      const { data: categories } = await supabase.rpc("get_stale_categories", { p_incident_staff_id: staffRow.id });
      staleCategories = categories ?? null;
    }

    const { data: history } = await supabase
      .from("incident_attestations")
      .select("action, addendum, withdrawal_reason, created_at")
      .eq("incident_staff_id", staffRow.id)
      .order("created_at", { ascending: false });

    return {
      incidentStaffId: staffRow.id,
      involvement: staffRow.involvement,
      status: statusResult ?? null,
      staleCategories,
      latestAttested: (history ?? []).find((h) => h.action === "attested") ?? null,
      latestWithdrawn: (history ?? []).find((h) => h.action === "withdrawn") ?? null,
    };
  }

  function applyAttestationData(result: AttestationData | null) {
    setIncidentStaffId(result?.incidentStaffId ?? null);
    setInvolvement(result?.involvement ?? null);
    setStatus(result?.status ?? null);
    setStaleCategories(result?.staleCategories ?? null);
    setLatestAttested(result?.latestAttested ?? null);
    setLatestWithdrawn(result?.latestWithdrawn ?? null);
    setIsLoading(false);
  }

  useEffect(() => {
    let isMounted = true;
    async function load() {
      const result = await fetchAttestationData();
      if (!isMounted) return;
      applyAttestationData(result);
    }
    load();
    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId]);

  async function handleAttest() {
    if (!incidentStaffId) return;
    setIsSubmitting(true);
    setSubmitError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("attest_to_incident", {
      p_incident_staff_id: incidentStaffId,
      p_addendum: addendum.trim() || null,
    });
    setIsSubmitting(false);
    if (error) {
      setSubmitError(error.message);
      return;
    }
    setAddendum("");
    setIsLoading(true);
    applyAttestationData(await fetchAttestationData());
  }

  async function handleWithdraw() {
    if (!incidentStaffId) return;
    if (!withdrawReason.trim()) {
      setWithdrawError("A reason is required to withdraw.");
      return;
    }
    setIsWithdrawing(true);
    setWithdrawError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("withdraw_attestation", {
      p_incident_staff_id: incidentStaffId,
      p_reason: withdrawReason.trim(),
    });
    setIsWithdrawing(false);
    if (error) {
      setWithdrawError(error.message);
      return;
    }
    setIsWithdrawOpen(false);
    setWithdrawReason("");
    setIsLoading(true);
    applyAttestationData(await fetchAttestationData());
  }

  if (isLoading) {
    return <div className="h-32 animate-pulse rounded-2xl bg-brand-off-white/60" />;
  }

  // Not named on this incident with a real account -- render nothing.
  if (!incidentStaffId || !status) {
    return null;
  }

  const canWithdraw = status === "current" || status === "stale";
  const canAttest = status !== "current"; // not_attested, stale, or withdrawn -- all can (re-)attest.

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <div>
        <h2 className="font-heading text-lg font-bold text-brand-prussian-blue">Your attestation</h2>
        <p className="mt-1 text-sm text-brand-neutral-black/70">
          You&apos;re named as {involvement} on this incident.{" "}
          {isClosed
            ? "This record is closed and read-only."
            : "Read the account above, then decide whether to put your name to it."}
        </p>
      </div>

      {status === "not_attested" && (
        <p className="rounded-2xl border border-dashed border-black/10 bg-black/[0.02] p-4 text-sm text-brand-neutral-black/70">
          You have not attested to this record yet.
        </p>
      )}

      {status === "current" && latestAttested && (
        <p className="rounded-2xl border border-brand-pastel-blue/40 bg-brand-pastel-blue/10 p-4 text-sm text-brand-neutral-black">
          You attested to this record on {formatDateTime(latestAttested.created_at)}.
          {latestAttested.addendum && (
            <span className="mt-2 block italic text-brand-neutral-black/70">&quot;{latestAttested.addendum}&quot;</span>
          )}
        </p>
      )}

      {status === "stale" && (
        <div className="rounded-2xl border border-brand-golden-brown/30 bg-brand-golden-brown/10 p-4">
          <p className="text-sm font-semibold text-brand-golden-brown">This has changed since you attested</p>
          <p className="mt-1 text-sm text-brand-neutral-black">{whatChangedLine(staleCategories)}</p>
          {latestAttested?.addendum && (
            <p className="mt-2 text-xs italic text-brand-neutral-black/60">
              What you said then: &quot;{latestAttested.addendum}&quot;
            </p>
          )}
        </div>
      )}

      {status === "withdrawn" && latestWithdrawn && (
        <p className="rounded-2xl border border-dashed border-black/10 bg-black/[0.02] p-4 text-sm text-brand-neutral-black/70">
          You withdrew your attestation on {formatDateTime(latestWithdrawn.created_at)}.
          <span className="mt-2 block italic">&quot;{latestWithdrawn.withdrawal_reason}&quot;</span>
        </p>
      )}

      {!isClosed && canAttest && (
        <div className="flex flex-col gap-3">
          <Textarea
            label="Optional -- add anything in your own words"
            id="attestation-addendum"
            value={addendum}
            onChange={(e) => setAddendum(e.target.value)}
            placeholder="Optional"
          />
          {submitError && (
            <p role="alert" className="text-sm font-medium text-red-600">
              {submitError}
            </p>
          )}
          <Button type="button" onClick={handleAttest} disabled={isSubmitting}>
            {isSubmitting ? "Recording…" : "I was present and this account is accurate"}
          </Button>
        </div>
      )}

      {!isClosed && canWithdraw && (
        <Button type="button" variant="secondary" onClick={() => setIsWithdrawOpen(true)} className="!border-black/10 !text-black/60">
          Withdraw my attestation
        </Button>
      )}

      <BottomSheet isOpen={isWithdrawOpen} onClose={() => !isWithdrawing && setIsWithdrawOpen(false)}>
        <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Withdraw your attestation?</h2>
        <p className="mt-2 text-sm text-brand-neutral-black/70">
          This does not remove your name from the incident, and it does not change what happened -- it records that
          you no longer stand over this account as it currently reads. A reason is required, and the incident
          cannot be signed off while this is outstanding.
        </p>
        <div className="mt-4">
          <Textarea
            label="Reason for withdrawing"
            id="withdrawal-reason"
            value={withdrawReason}
            onChange={(e) => setWithdrawReason(e.target.value)}
            placeholder="Required"
          />
        </div>
        {withdrawError && (
          <p role="alert" className="mt-3 text-sm font-medium text-red-600">
            {withdrawError}
          </p>
        )}
        <Button type="button" onClick={handleWithdraw} disabled={isWithdrawing} className="mt-4">
          {isWithdrawing ? "Withdrawing…" : "Withdraw"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setIsWithdrawOpen(false)}
          disabled={isWithdrawing}
          className="mt-2 !border-black/10 !text-black/60"
        >
          Cancel
        </Button>
      </BottomSheet>
    </div>
  );
}
