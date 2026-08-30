"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";
import { ReasonConfirmSheet } from "@/components/shared/ReasonConfirmSheet";
import { GrantPassportAccessSheet } from "@/components/principal/GrantPassportAccessSheet";
import { EndEnrolmentSheet } from "@/components/principal/EndEnrolmentSheet";
import { GrantClinicianAccessSheet } from "@/components/principal/GrantClinicianAccessSheet";
import { CLINICIAN_SPECIALTY_LABEL, type ClinicianSpecialty } from "@/lib/clinicianSpecialties";

// PRD 1, Stage 4, Step 3. Principal's passport detail. PRD 2, Stage 3:
// rewritten into three tabs (Enrolment / Access / Clinical), reusing
// /clinician/passport/[passportId]'s own tab-strip pattern verbatim --
// the same "read ?tab= once, no URL sync-back" lazy-initializer idiom,
// the same border-b-2 scrollable strip. No new visual pattern
// introduced; this page just grew enough content to justify the
// pattern the way that page already did.
//
// Daniel's own instruction 1: HISTORY IS VISIBLE, NOT HIDDEN. Past
// access shows who granted it, who revoked it, when, and why -- the
// whole reason 0111 added granted_by/revoked_by/revoked_at/
// revocation_reason to passport_access in the first place. Collapsed
// by default (matching every other history section in this app -- Past
// Cover, Removed teachers, Previously in this class), never omitted.
//
// Daniel's own instruction 2: an empty state here (no grants at all,
// for a child the roster shows) is legitimate and informative -- it IS
// the gap a principal needs to see, not an error state to explain away.
//
// PRD 2, Stage 3's own instruction, verbatim: the claim-code section
// COEXISTS across three states, because a child can have more than one
// guardian -- one already claimed while a second code is outstanding
// for a co-parent. Migration 0126 made this possible for the first
// time (get_passport_claim_code_status() now returns the code's own
// id, and revoke_passport_claim_code() takes a required reason) --
// before 0126 there was nothing in the client's hands to revoke with.
// The three states below are independently rendered, not branches of
// one if/else chain:
//   1. unclaimed empty state -- ONLY when zero guardians AND no
//      outstanding code.
//   2. claimed guardians -- rendered whenever any exist, regardless of
//      whether a code is also outstanding.
//   3. an outstanding code -- rendered whenever one exists, regardless
//      of whether any guardian has already claimed. Shows EXPIRES IN
//      [X] DAYS and a Revoke action requiring a reason (0126), not a
//      silent "Generate a new code" replace -- revoking is now a
//      recorded act with its own reason, same discipline as every
//      other revoke in this app.
// A "generate a code for another guardian" action appears whenever
// guardians exist and no code is currently outstanding -- the literal
// second-guardian case Daniel named.

interface AccessRow {
  id: string;
  userId: string;
  fullName: string;
  actorRole: string;
  isActive: boolean;
  linkedAt: string;
  grantedByName: string | null;
  revokedAt: string | null;
  revokedByName: string | null;
  revocationReason: string | null;
}

interface StaffRosterRow {
  user_id: string;
  full_name: string;
  is_active: boolean;
}

interface GuardianRow {
  userId: string;
  fullName: string | null;
  claimedAt: string;
}

interface ClaimCodeStatus {
  id: string;
  code: string;
  expiresAt: string;
}

interface EnrolmentRow {
  id: string;
  endedAt: string | null;
  endReason: string | null;
}

// Stage 7, Step 2. Same shape as passport/dashboard's own
// ConnectedClinician -- the principal sees BOTH parent-engaged and
// institution-engaged clinicians (Daniel's decision 4: "the parent
// must ALSO see the school's own engagement -- symmetry matters
// here"), but can only revoke the ones their OWN institution engaged.
// engagedByInstitutionId is compared against this page's own
// institutionId to decide that, not just engagedBy === 'institution'
// alone -- a child linked to two schools could show a clinician
// engaged by the OTHER one, which this principal must see but not act
// on, same "neither authority can revoke the other's" rule as parent
// vs institution.
interface ClinicianRow {
  clinicianAccessId: string;
  clinicianId: string;
  fullName: string;
  specialty: string;
  engagedBy: "parent" | "institution";
  engagedByInstitutionId: string | null;
  engagedByInstitutionName: string | null;
}

type TabKey = "enrolment" | "access" | "clinical";

const TABS: { key: TabKey; label: string }[] = [
  { key: "enrolment", label: "Enrolment" },
  { key: "access", label: "Access" },
  { key: "clinical", label: "Clinical" },
];

const ROLE_LABEL: Record<string, string> = {
  class_teacher: "Class Teacher",
  sna: "SNA",
};

const END_REASON_LABEL: Record<string, string> = {
  graduated: "Graduated",
  left: "Left the school",
  transferred: "Transferred to another school",
};

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function daysRemaining(iso: string): number {
  const diffMs = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(diffMs / 86_400_000));
}

export default function PrincipalPassportDetailPage() {
  const params = useParams();
  const passportId = params.passportId as string;
  const searchParams = useSearchParams();
  const { user, isReady } = useRequireRole("principal");

  // Same lazy-initializer idiom as /clinician/passport/[passportId] --
  // read once on mount, never synced back to the URL on tab change.
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const requested = searchParams.get("tab");
    return TABS.some((t) => t.key === requested) ? (requested as TabKey) : "enrolment";
  });

  const [childName, setChildName] = useState<string | null>(null);
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [access, setAccess] = useState<{ active: AccessRow[]; past: AccessRow[] }>({ active: [], past: [] });
  const [eligibleStaff, setEligibleStaff] = useState<{ userId: string; fullName: string }[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notOnRoster, setNotOnRoster] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const [isGrantOpen, setIsGrantOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<AccessRow | null>(null);

  // Stage 6, Step 2 -- the current (most recent) enrolment at THIS
  // institution, read directly (RLS: "Active institution staff can view
  // enrolments", 0121) rather than through a new RPC -- a plain read,
  // no new mechanism needed for it. null id + not-loading means this
  // passport was linked before Stage 6 existed and has no enrolment row
  // at all yet (same "treat as active" reasoning as the roster RPC's
  // own enrolment_ended_at column, 0122) -- shown as enrolled, no end
  // action offered, since there's no enrolment id to end.
  const [enrolment, setEnrolment] = useState<EnrolmentRow | null>(null);
  const [isEndEnrolmentOpen, setIsEndEnrolmentOpen] = useState(false);

  // Stage 3 -- coexisting, not exclusive. See the header comment above.
  const [guardians, setGuardians] = useState<GuardianRow[]>([]);
  const [claimCode, setClaimCode] = useState<ClaimCodeStatus | null>(null);
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [claimCodeRevokeTarget, setClaimCodeRevokeTarget] = useState<ClaimCodeStatus | null>(null);

  // Stage 7, Step 2 -- Clinical Team.
  const [clinicians, setClinicians] = useState<ClinicianRow[]>([]);
  const [cliniciansError, setCliniciansError] = useState<string | null>(null);
  const [isGrantClinicianOpen, setIsGrantClinicianOpen] = useState(false);
  const [clinicianGrantedNotice, setClinicianGrantedNotice] = useState<string | null>(null);
  const [clinicianRevokeTarget, setClinicianRevokeTarget] = useState<ClinicianRow | null>(null);
  const [clinicianRevokedNotice, setClinicianRevokedNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    setNotOnRoster(false);
    const supabase = createClient();

    const { data: staffRow, error: staffError } = await supabase
      .from("institution_staff")
      .select("institution_id")
      .eq("user_id", user.id)
      .eq("role", "principal")
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .maybeSingle();

    if (staffError || !staffRow) {
      setError("Could not find your institution.");
      setIsLoading(false);
      return;
    }
    setInstitutionId(staffRow.institution_id);

    // Same roster RPC the list page uses -- if this child genuinely
    // isn't on it (a stale link, or a passportId that was never really
    // this institution's), that's shown plainly rather than silently
    // resolving to "Unknown".
    const { data: rosterRows, error: rosterError } = await supabase.rpc("get_institution_child_roster", {
      p_institution_id: staffRow.institution_id,
    });
    if (rosterError) {
      setError("Could not load this child.");
      setIsLoading(false);
      return;
    }
    const rosterMatch = (rosterRows ?? []).find((r: { passport_id: string; child_name: string }) => r.passport_id === passportId);
    if (!rosterMatch) {
      setNotOnRoster(true);
      setIsLoading(false);
      return;
    }
    setChildName(rosterMatch.child_name);

    const [accessResult, staffRosterResult, guardiansResult, claimCodeResult, enrolmentResult, cliniciansResult] = await Promise.all([
      supabase.rpc("get_passport_access_for_child", { p_passport_id: passportId, p_institution_id: staffRow.institution_id }),
      supabase.rpc("get_institution_staff_roster", { p_institution_id: staffRow.institution_id, p_include_inactive: false, p_include_pending: false }),
      supabase.rpc("get_passport_guardians_for_child", { p_institution_id: staffRow.institution_id, p_passport_id: passportId }),
      supabase.rpc("get_passport_claim_code_status", { p_institution_id: staffRow.institution_id, p_passport_id: passportId }),
      supabase
        .from("enrolments")
        .select("id, ended_at, end_reason")
        .eq("passport_id", passportId)
        .eq("institution_id", staffRow.institution_id)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.rpc("get_passport_clinicians", { p_passport_id: passportId }),
    ]);

    if (cliniciansResult.error) {
      console.error("Failed to load connected clinicians:", cliniciansResult.error);
      setCliniciansError("Couldn't load this child's clinical team.");
    } else {
      setCliniciansError(null);
      setClinicians(
        (cliniciansResult.data ?? []).map(
          (row: {
            clinician_access_id: string;
            clinician_id: string;
            full_name: string | null;
            specialty: string;
            engaged_by: "parent" | "institution";
            engaged_by_institution_id: string | null;
            engaged_by_institution_name: string | null;
          }) => ({
            clinicianAccessId: row.clinician_access_id,
            clinicianId: row.clinician_id,
            fullName: row.full_name ?? "A clinician",
            specialty: row.specialty,
            engagedBy: row.engaged_by,
            engagedByInstitutionId: row.engaged_by_institution_id,
            engagedByInstitutionName: row.engaged_by_institution_name,
          })
        )
      );
    }

    if (enrolmentResult.error) {
      console.error("Failed to load enrolment:", enrolmentResult.error);
    }
    setEnrolment(
      enrolmentResult.data
        ? { id: enrolmentResult.data.id, endedAt: enrolmentResult.data.ended_at, endReason: enrolmentResult.data.end_reason }
        : null
    );

    if (accessResult.error) {
      setError("Could not load this child's access history.");
      setIsLoading(false);
      return;
    }

    // Guardian/claim-code load failures don't block the rest of the page
    // (Current Access is the section this page has always guaranteed) --
    // logged and left empty, same posture as the other secondary reads
    // on this page (institutionsError/cliniciansError elsewhere in this
    // app never block their own page's primary content either).
    if (guardiansResult.error) {
      console.error("Failed to load guardians:", guardiansResult.error);
    }
    if (claimCodeResult.error) {
      console.error("Failed to load claim code status:", claimCodeResult.error);
    }
    setGuardians(
      ((guardiansResult.data ?? []) as { user_id: string; full_name: string | null; claimed_at: string }[]).map(
        (g) => ({ userId: g.user_id, fullName: g.full_name, claimedAt: g.claimed_at })
      )
    );
    const claimCodeRow = ((claimCodeResult.data ?? []) as { id: string; code: string; expires_at: string }[])[0];
    setClaimCode(claimCodeRow ? { id: claimCodeRow.id, code: claimCodeRow.code, expiresAt: claimCodeRow.expires_at } : null);

    const activeRows: AccessRow[] = [];
    const pastRows: AccessRow[] = [];
    for (const r of accessResult.data ?? []) {
      const row: AccessRow = {
        id: r.id,
        userId: r.user_id,
        fullName: r.full_name,
        actorRole: r.actor_role,
        isActive: r.is_active,
        linkedAt: r.linked_at,
        grantedByName: r.granted_by_name,
        revokedAt: r.revoked_at,
        revokedByName: r.revoked_by_name,
        revocationReason: r.revocation_reason,
      };
      (r.is_active ? activeRows : pastRows).push(row);
    }
    setAccess({ active: activeRows, past: pastRows });

    const activeUserIds = new Set(activeRows.map((r) => r.userId));
    setEligibleStaff(
      ((staffRosterResult.data ?? []) as StaffRosterRow[])
        .filter((s) => s.is_active && !activeUserIds.has(s.user_id))
        .map((s) => ({ userId: s.user_id, fullName: s.full_name }))
    );

    setIsLoading(false);
  }, [passportId, user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Issues a fresh code -- covers both "the first code for this child"
  // and "a second guardian needs their own code" (the coexistence case
  // this stage exists for). Only reachable from the UI when no code is
  // currently outstanding (see the render below), so this never
  // silently replaces a live one -- revoking a live one is now its own
  // explicit, reasoned action (revoke_passport_claim_code, 0126).
  async function handleGenerateCode() {
    if (!institutionId) return;
    setIsGeneratingCode(true);
    setGenerateError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("generate_passport_claim_code", {
      p_institution_id: institutionId,
      p_passport_id: passportId,
    });
    if (error) {
      setGenerateError(error.message);
      setIsGeneratingCode(false);
      return;
    }
    const { data: statusRows, error: statusError } = await supabase.rpc("get_passport_claim_code_status", {
      p_institution_id: institutionId,
      p_passport_id: passportId,
    });
    if (statusError) {
      console.error("Failed to reload claim code status:", statusError);
    }
    const row = ((statusRows ?? []) as { id: string; code: string; expires_at: string }[])[0];
    setClaimCode(row ? { id: row.id, code: row.code, expiresAt: row.expires_at } : null);
    setIsGeneratingCode(false);
  }

  // revoke_clinician_access() (0123) enforces the authority split
  // server-side (a principal can only revoke their OWN institution's
  // engaged_by='institution' rows) -- this handler is only ever wired
  // up from a button the render below already restricts to those rows,
  // so this is belt-and-braces, not the real gate.
  async function handleRevokeClinician(clinician: ClinicianRow, reason: string) {
    const supabase = createClient();
    const { error } = await supabase.rpc("revoke_clinician_access", {
      p_clinician_access_id: clinician.clinicianAccessId,
      p_reason: reason,
    });
    if (error) {
      return { error: error.message };
    }
    return { error: null };
  }

  if (!isReady) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-10">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <Link
          href="/principal/passports"
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </Link>
        <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">{childName ?? "Passport"}</h1>
      </header>

      {!isLoading && !error && !notOnRoster && (
        <div className="flex gap-1 overflow-x-auto border-b border-black/5 px-4">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={(e) => {
                setActiveTab(tab.key);
                e.currentTarget.scrollIntoView({
                  behavior: "smooth",
                  inline: "center",
                  block: "nearest",
                });
              }}
              className={`flex-shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors ${
                activeTab === tab.key
                  ? "border-brand-prussian-blue text-brand-prussian-blue"
                  : "border-transparent text-black/40"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      <main className="flex-1 px-4 py-4">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
          </div>
        ) : error ? (
          <p className="text-sm text-brand-neutral-black/60">{error}</p>
        ) : notOnRoster ? (
          <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
            This child isn&apos;t on your school&apos;s roster.
          </p>
        ) : (
          <>
            {activeTab === "enrolment" && (
              <>
                <section className="mb-6">
                  <h2 className="mb-2 font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
                    Enrolment
                  </h2>
                  {enrolment?.endedAt ? (
                    <div className="rounded-2xl border border-black/5 bg-white/60 p-4">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-black/5 px-2.5 py-1 text-xs font-semibold text-brand-neutral-black/60">
                        Enrolment ended
                      </span>
                      <p className="mt-2 text-xs text-brand-neutral-black/50">
                        {END_REASON_LABEL[enrolment.endReason ?? ""] ?? enrolment.endReason} · {formatDate(enrolment.endedAt)}
                      </p>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-pastel-blue/20 px-2.5 py-1 text-xs font-semibold text-brand-prussian-blue">
                        Enrolled
                      </span>
                      {enrolment && (
                        <button
                          type="button"
                          onClick={() => setIsEndEnrolmentOpen(true)}
                          className="text-xs font-semibold text-brand-golden-brown"
                        >
                          End Enrolment
                        </button>
                      )}
                    </div>
                  )}
                </section>

                <section>
                  <h2 className="mb-2 font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
                    Parent / Guardian
                  </h2>

                  {guardians.length === 0 && !claimCode && (
                    <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center">
                      <p className="text-sm text-brand-neutral-black/60">Parent claim code required.</p>
                      <p className="mt-1 text-sm text-brand-neutral-black/60">
                        No parent or guardian has claimed {childName}&apos;s passport yet.
                      </p>
                      <button
                        type="button"
                        onClick={handleGenerateCode}
                        disabled={isGeneratingCode}
                        className="mt-3 rounded-full bg-brand-prussian-blue px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                      >
                        {isGeneratingCode ? "Generating…" : "Generate Claim Code"}
                      </button>
                      {generateError && (
                        <p role="alert" className="mt-2 text-xs font-medium text-brand-golden-brown">
                          {generateError}
                        </p>
                      )}
                    </div>
                  )}

                  {guardians.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {guardians.map((g) => (
                        <div key={g.userId} className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-semibold text-brand-neutral-black">{g.fullName ?? "A parent"}</p>
                            <span className="flex-shrink-0 rounded-full bg-brand-pastel-blue/20 px-2.5 py-1 text-xs font-semibold text-brand-prussian-blue">
                              CLAIMED {formatDate(g.claimedAt).toUpperCase()}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {claimCode && (
                    <div className={`rounded-2xl border border-black/5 bg-white p-4 shadow-sm ${guardians.length > 0 ? "mt-2" : ""}`}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/50">
                          Outstanding claim code
                        </p>
                        <span className="flex-shrink-0 rounded-full bg-brand-golden-brown/15 px-2.5 py-1 text-xs font-semibold text-brand-golden-brown">
                          EXPIRES IN {daysRemaining(claimCode.expiresAt)} DAY{daysRemaining(claimCode.expiresAt) === 1 ? "" : "S"}
                        </span>
                      </div>
                      <p className="mt-1 font-heading text-2xl font-bold tracking-widest text-brand-prussian-blue">
                        {claimCode.code}
                      </p>
                      <p className="mt-1 text-xs text-brand-neutral-black/50">
                        Give this code to {childName}&apos;s parent or guardian to link their account.
                      </p>
                      <button
                        type="button"
                        onClick={() => setClaimCodeRevokeTarget(claimCode)}
                        className="mt-3 block w-full rounded-xl border border-brand-golden-brown py-2 text-center text-xs font-semibold text-brand-golden-brown"
                      >
                        Revoke
                      </button>
                    </div>
                  )}

                  {guardians.length > 0 && !claimCode && (
                    <button
                      type="button"
                      onClick={handleGenerateCode}
                      disabled={isGeneratingCode}
                      className="mt-2 block w-full rounded-xl border border-brand-prussian-blue py-2 text-center text-xs font-semibold text-brand-prussian-blue disabled:opacity-50"
                    >
                      {isGeneratingCode ? "Generating…" : "+ Generate a code for another guardian"}
                    </button>
                  )}

                  {guardians.length > 0 && generateError && (
                    <p role="alert" className="mt-2 text-xs font-medium text-brand-golden-brown">
                      {generateError}
                    </p>
                  )}
                </section>
              </>
            )}

            {activeTab === "access" && (
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
                    Current Access ({access.active.length})
                  </h2>
                  <button type="button" onClick={() => setIsGrantOpen(true)} className="text-xs font-semibold text-brand-prussian-blue">
                    + Grant Access
                  </button>
                </div>

                {access.active.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
                    No one currently has passport access to {childName}.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {access.active.map((a) => (
                      <div key={a.id} className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-brand-neutral-black">{a.fullName}</p>
                            <p className="mt-0.5 text-xs text-brand-neutral-black/50">{ROLE_LABEL[a.actorRole] ?? a.actorRole}</p>
                          </div>
                          <span className="flex-shrink-0 rounded-full bg-brand-pastel-blue/20 px-2.5 py-1 text-xs font-semibold text-brand-prussian-blue">
                            Active
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-brand-neutral-black/50">
                          Granted {formatDate(a.linkedAt)}
                          {a.grantedByName ? ` by ${a.grantedByName}` : ""}
                        </p>
                        <button
                          type="button"
                          onClick={() => setRevokeTarget(a)}
                          className="mt-3 block w-full rounded-xl border border-brand-golden-brown py-2 text-center text-xs font-semibold text-brand-golden-brown"
                        >
                          Revoke
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {access.past.length > 0 && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => setShowHistory((v) => !v)}
                      className="flex w-full items-center justify-between rounded-2xl border border-dashed border-black/10 bg-white/60 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/50"
                    >
                      <span>Past access ({access.past.length})</span>
                      <span>{showHistory ? "−" : "+"}</span>
                    </button>
                    {showHistory && (
                      <div className="mt-2 flex flex-col gap-2">
                        {access.past.map((a) => (
                          <div key={a.id} className="rounded-2xl border border-black/5 bg-white/60 p-4">
                            <p className="text-sm font-semibold text-brand-neutral-black">{a.fullName}</p>
                            <p className="mt-0.5 text-xs text-brand-neutral-black/50">{ROLE_LABEL[a.actorRole] ?? a.actorRole}</p>
                            <p className="mt-2 text-xs text-brand-neutral-black/50">
                              Granted {formatDate(a.linkedAt)}
                              {a.grantedByName ? ` by ${a.grantedByName}` : ""}
                            </p>
                            {a.revokedAt && (
                              <p className="mt-0.5 text-xs text-brand-neutral-black/50">
                                Revoked {formatDate(a.revokedAt)}
                                {a.revokedByName ? ` by ${a.revokedByName}` : ""}
                              </p>
                            )}
                            {a.revocationReason && (
                              <p className="mt-2 text-sm text-brand-neutral-black/70">&ldquo;{a.revocationReason}&rdquo;</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {activeTab === "clinical" && (
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
                    Clinical Team ({clinicians.length})
                  </h2>
                  <button
                    type="button"
                    onClick={() => setIsGrantClinicianOpen(true)}
                    className="text-xs font-semibold text-brand-prussian-blue"
                  >
                    + Connect Clinician
                  </button>
                </div>

                {cliniciansError ? (
                  <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
                    {cliniciansError}
                  </p>
                ) : clinicians.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
                    No clinicians connected to {childName} yet.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {clinicians.map((c) => {
                      // Symmetry with the parent's own view: a clinician this
                      // institution engaged is theirs to revoke; a
                      // parent-engaged one, or one engaged by a DIFFERENT
                      // institution (a child linked to two schools), is
                      // shown but read-only -- "neither authority can revoke
                      // the other's".
                      const canRevoke = c.engagedBy === "institution" && c.engagedByInstitutionId === institutionId;
                      return (
                        <div key={c.clinicianAccessId} className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-brand-neutral-black">{c.fullName}</p>
                              <p className="mt-0.5 text-xs text-brand-neutral-black/50">
                                {CLINICIAN_SPECIALTY_LABEL[c.specialty as ClinicianSpecialty] ?? c.specialty}
                              </p>
                            </div>
                          </div>
                          <p className="mt-2 text-xs text-brand-neutral-black/50">
                            {c.engagedBy === "parent"
                              ? "Connected by the family"
                              : canRevoke
                                ? "Connected by your school"
                                : `Connected by ${c.engagedByInstitutionName ?? "another school"}`}
                          </p>
                          {canRevoke ? (
                            <button
                              type="button"
                              onClick={() => setClinicianRevokeTarget(c)}
                              className="mt-3 block w-full rounded-xl border border-brand-golden-brown py-2 text-center text-xs font-semibold text-brand-golden-brown"
                            >
                              Revoke
                            </button>
                          ) : (
                            <p className="mt-3 text-center text-xs text-brand-neutral-black/40">
                              Read-only — managed elsewhere
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {clinicianGrantedNotice && (
                  <p className="mt-3 rounded-xl bg-brand-off-white/50 px-4 py-3 text-sm text-brand-neutral-black">
                    {clinicianGrantedNotice}
                  </p>
                )}
                {clinicianRevokedNotice && (
                  <p className="mt-3 rounded-xl bg-brand-off-white/50 px-4 py-3 text-sm text-brand-neutral-black">
                    {clinicianRevokedNotice}
                  </p>
                )}
              </section>
            )}
          </>
        )}
      </main>

      {institutionId && childName && (
        <GrantPassportAccessSheet
          isOpen={isGrantOpen}
          passportId={passportId}
          institutionId={institutionId}
          childName={childName}
          eligibleStaff={eligibleStaff}
          onClose={() => setIsGrantOpen(false)}
          onGranted={() => {
            setIsGrantOpen(false);
            load();
          }}
        />
      )}

      {enrolment && !enrolment.endedAt && childName && (
        <EndEnrolmentSheet
          isOpen={isEndEnrolmentOpen}
          enrolmentId={enrolment.id}
          childName={childName}
          onClose={() => setIsEndEnrolmentOpen(false)}
          onEnded={() => {
            setIsEndEnrolmentOpen(false);
            load();
          }}
        />
      )}

      {revokeTarget && (
        <ReasonConfirmSheet
          isOpen={Boolean(revokeTarget)}
          title={`Revoke ${revokeTarget.fullName}'s access to ${childName ?? "this child"}?`}
          description="Their access ends immediately. This is a revocation, not a delete -- it stays in this child's access history, visible to you at any time."
          confirmLabel="Revoke Access"
          submittingLabel="Revoking…"
          onClose={() => setRevokeTarget(null)}
          onConfirm={async (reason) => {
            const supabase = createClient();
            const { error } = await supabase.rpc("revoke_passport_access", {
              p_passport_access_id: revokeTarget.id,
              p_reason: reason,
            });
            return { error: error?.message ?? null };
          }}
          onConfirmed={() => {
            setRevokeTarget(null);
            load();
          }}
        />
      )}

      {claimCodeRevokeTarget && (
        <ReasonConfirmSheet
          isOpen={Boolean(claimCodeRevokeTarget)}
          title={`Revoke this claim code for ${childName ?? "this child"}?`}
          description="This code stops working immediately. Nothing about this child's passport or any already-claimed guardian is affected -- you can generate a fresh code at any time."
          confirmLabel="Revoke Code"
          submittingLabel="Revoking…"
          onClose={() => setClaimCodeRevokeTarget(null)}
          onConfirm={async (reason) => {
            const supabase = createClient();
            const { error } = await supabase.rpc("revoke_passport_claim_code", {
              p_claim_code_id: claimCodeRevokeTarget.id,
              p_reason: reason,
            });
            return { error: error?.message ?? null };
          }}
          onConfirmed={() => {
            setClaimCodeRevokeTarget(null);
            load();
          }}
        />
      )}

      {institutionId && childName && (
        <GrantClinicianAccessSheet
          isOpen={isGrantClinicianOpen}
          passportId={passportId}
          institutionId={institutionId}
          childName={childName}
          onClose={() => setIsGrantClinicianOpen(false)}
          onGranted={(clinicianName) => {
            setIsGrantClinicianOpen(false);
            setClinicianGrantedNotice(`${clinicianName} has been connected to ${childName}'s passport.`);
            load();
          }}
        />
      )}

      {clinicianRevokeTarget && (
        <ReasonConfirmSheet
          isOpen={Boolean(clinicianRevokeTarget)}
          title={`Revoke ${clinicianRevokeTarget.fullName}'s access to ${childName ?? "this child"}?`}
          description="Their access ends immediately. Please give a reason."
          confirmLabel="Revoke Access"
          submittingLabel="Revoking…"
          onClose={() => setClinicianRevokeTarget(null)}
          onConfirm={(reason) => handleRevokeClinician(clinicianRevokeTarget, reason)}
          onConfirmed={() => {
            const target = clinicianRevokeTarget;
            setClinicianRevokeTarget(null);
            setClinicianRevokedNotice(
              target ? `Access for ${target.fullName} has been removed.` : null
            );
            load();
          }}
        />
      )}
    </div>
  );
}
