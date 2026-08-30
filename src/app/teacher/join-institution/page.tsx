"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { LockIcon } from "@/components/ui/icons";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { getPostAuthRedirect } from "@/lib/roleRedirect";

// PRD 2, Stage 1: this used to carry its own local, independent copy of
// "where does this role's dashboard live" (getStaffDashboardDestination)
// -- a second hardcoding of the exact same mapping getPostAuthRedirect()
// already owns, with a comment claiming to be "the one place this
// destination lives" while a second one sat in src/lib/roleRedirect.ts
// the whole time. Two independent copies of the same routing decision
// is exactly the shape that drifts silently. Collapsed to call
// getPostAuthRedirect() directly -- this page's own useRequireRole(["class_teacher", "sna", "principal"])
// guarantees staffRole is always one of those three whenever these
// calls actually fire, so the two functions' behavior was already
// identical for every real case; this just removes the second source
// of truth, not a behavior change.

// The one-principal-per-institution constraint (migration 0068,
// deliberately NOT widened for handover -- see 0102's own migration
// comment) is enforced at the database, not the UI -- a second
// principal's self-link fails with a raw Postgres unique-violation,
// which is not something to put in front of someone mid-onboarding.
// Matched on the constraint NAME (stable, chosen by the migration
// itself), not by fragile string-matching against Postgres's own
// message wording. Points at the real mechanism now that Stage 1c
// (hand_over_principal()) exists -- ask the current principal, or join
// as staff instead -- rather than "contact support," which is the
// abandoned-principal path, not the ordinary one.
function friendlyJoinError(rawMessage: string): string {
  if (rawMessage.includes("institution_staff_one_principal_per_institution")) {
    return "This school already has a principal. Ask them to hand over the role to you, or join as a class teacher instead.";
  }
  return rawMessage;
}

// checkExisting()'s own status, four-way since migration 0100 --
// mirrors the client-side "what should this person see on landing"
// resolution the adversarial suite's V10-pre/post checks are written
// against (file:line-matched to this function, per CLAUDE.md's "the
// suite tests the database, not the journey" rule). "none" shows the
// plain join form; "active" redirects onward (unchanged from before
// 0100); "pending" and "rejected" render as overlays on this same page,
// reusing the clinician-verification pattern.
type JoinStatus = "checking" | "none" | "pending" | "rejected" | "active";

interface RejectedInfo {
  institutionName: string | null;
  reason: string | null;
}

export default function TeacherJoinInstitutionPage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole(["class_teacher", "sna", "principal"]);
  const staffRole = user?.app_metadata?.role as string | undefined;

  const [code, setCode] = useState("");
  const [status, setStatus] = useState<JoinStatus>("checking");
  const [pendingInstitutionName, setPendingInstitutionName] = useState<string | null>(null);
  const [rejectedInfo, setRejectedInfo] = useState<RejectedInfo | null>(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [hasDismissedRejection, setHasDismissedRejection] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every non-deactivated row for this person, across however many
  // institutions they've ever attempted -- deactivation is append-only
  // (Stage 1), so a rejoin after deactivation is a fresh row here, same
  // as a fresh request after rejection. An ACTIVE row anywhere takes
  // priority over a stale pending/rejected row elsewhere (a real, if
  // rare, edge case: someone tried a different school once); short of
  // that, the MOST RECENT row decides -- a re-request after rejection
  // is newer than the rejection it replaces, so pending correctly wins.
  const checkExisting = useCallback(async () => {
    if (!user) return "checking" as JoinStatus;
    const supabase = createClient();
    const { data, error: fetchError } = await supabase
      .from("institution_staff")
      .select("institution_id, approved_at, rejected_at, rejection_reason, created_at, institutions(name)")
      .eq("user_id", user.id)
      .is("deactivated_at", null)
      .order("created_at", { ascending: false });

    if (fetchError) {
      setStatus("none");
      return "none" as JoinStatus;
    }

    const rows = data ?? [];
    const activeRow = rows.find((r) => r.approved_at !== null);
    if (activeRow) {
      setStatus("active");
      return "active" as JoinStatus;
    }

    const current = rows[0];
    if (!current) {
      setStatus("none");
      return "none" as JoinStatus;
    }

    const institutionRecord = current.institutions as unknown as { name: string } | { name: string }[] | null;
    const institutionName = Array.isArray(institutionRecord) ? institutionRecord[0]?.name : institutionRecord?.name;

    if (current.rejected_at !== null) {
      setRejectedInfo({ institutionName: institutionName ?? null, reason: current.rejection_reason });
      setStatus("rejected");
      return "rejected" as JoinStatus;
    }

    setPendingInstitutionName(institutionName ?? null);
    setStatus("pending");
    return "pending" as JoinStatus;
  }, [user]);

  // Fetches on mount and whenever checkExisting's identity changes -- a
  // genuine effect for syncing with the external data source, matching
  // the clinician dashboard's own loadProfile pattern.
  useEffect(() => {
    if (!user) return;
    let isMounted = true;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    checkExisting().then((result) => {
      if (!isMounted) return;
      if (result === "active") {
        router.replace(getPostAuthRedirect(staffRole));
      }
    });

    return () => {
      isMounted = false;
    };
  }, [user, router, staffRole, checkExisting]);

  async function handleCheckStatus() {
    setIsCheckingStatus(true);
    const result = await checkExisting();
    setIsCheckingStatus(false);
    if (result === "active") {
      router.replace(getPostAuthRedirect(staffRole));
    }
  }

  async function handleJoin() {
    if (!user || !code.trim()) return;

    setError(null);
    setIsSaving(true);

    const supabase = createClient();
    const { data: institution, error: lookupError } = await supabase
      .from("institutions")
      .select("id, status")
      .ilike("institution_code", code.trim())
      .maybeSingle();

    if (lookupError) {
      setIsSaving(false);
      setError(lookupError.message);
      return;
    }

    if (!institution) {
      setIsSaving(false);
      setError("We couldn't find an institution with that code. Please check and try again.");
      return;
    }

    if (institution.status !== "verified") {
      setIsSaving(false);
      setError("This institution hasn't been verified yet. Please try again later.");
      return;
    }

    // staffRole comes from the server-set app_metadata claim
    // useRequireRole already verified is one of class_teacher/sna --
    // never a client-suppliable value, and the DB's own self-link policy
    // (current_user_role() = role, migration 0033/0065) enforces this
    // independently even if it somehow weren't.
    const { error: staffError } = await supabase.from("institution_staff").insert({
      institution_id: institution.id,
      user_id: user.id,
      role: staffRole,
    });

    setIsSaving(false);

    if (staffError) {
      setError(friendlyJoinError(staffError.message));
      return;
    }

    router.push(getPostAuthRedirect(staffRole));
  }

  if (!isReady || status === "checking" || status === "active") {
    return null;
  }

  // "rejected" starts locked (the overlay below) and unlocks in place once
  // dismissed via "Try Again" -- the SAME form beneath, per Daniel's own
  // decision: re-requesting is just submitting the join form again, old
  // row untouched, no separate flow needed.
  const isLocked = status === "pending" || (status === "rejected" && !hasDismissedRejection);

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
      <div className="relative w-full max-w-sm">
        <div className={isLocked ? "pointer-events-none select-none" : ""}>
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            <BrandMark />
            <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
              Join Your School
            </h1>
          </div>

          <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
            <p className="mb-4 text-sm leading-relaxed text-black/60">
              Enter the institution code your school shared with you to join
              your Hive Dashboard.
            </p>

            <TextField
              label="Institution code"
              type="text"
              placeholder="e.g. 7F3K9Q"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="uppercase tracking-widest"
            />

            {error && (
              <p role="alert" className="mt-4 text-sm font-medium text-red-600">
                {error}
              </p>
            )}

            <Button
              type="button"
              onClick={handleJoin}
              disabled={!code.trim() || isSaving || isLocked}
              className="mt-6"
            >
              {isSaving ? "Joining…" : "Join Institution"}
            </Button>
          </div>
        </div>

        {status === "pending" && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/30 px-2 backdrop-blur-md">
            <div className="w-full max-w-xs rounded-3xl bg-white p-6 text-center shadow-lg">
              <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-pastel-blue/40 text-brand-prussian-blue">
                <LockIcon className="h-6 w-6" />
              </span>
              <p className="mb-4 text-base font-semibold text-brand-neutral-black">
                {`Your request to join ${pendingInstitutionName ?? "this school"} is waiting on your principal's approval. You'll get access as soon as they confirm it.`}
              </p>
              <button
                type="button"
                onClick={handleCheckStatus}
                disabled={isCheckingStatus}
                className="block w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-base font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isCheckingStatus ? "Checking…" : "Check status"}
              </button>
            </div>
          </div>
        )}

        {status === "rejected" && !hasDismissedRejection && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/30 px-2 backdrop-blur-md">
            <div className="w-full max-w-xs rounded-3xl bg-white p-6 text-center shadow-lg">
              <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-pastel-blue/40 text-brand-prussian-blue">
                <LockIcon className="h-6 w-6" />
              </span>
              <p className="mb-2 text-base font-semibold text-brand-neutral-black">
                {rejectedInfo?.institutionName
                  ? `${rejectedInfo.institutionName} didn't approve your request to join.`
                  : "Your request to join wasn't approved."}
              </p>
              {rejectedInfo?.reason && (
                <p className="mb-4 text-sm text-brand-neutral-black/70">
                  &ldquo;{rejectedInfo.reason}&rdquo;
                </p>
              )}
              <button
                type="button"
                onClick={() => setHasDismissedRejection(true)}
                className="block w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-base font-semibold text-white"
              >
                Try Again
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
