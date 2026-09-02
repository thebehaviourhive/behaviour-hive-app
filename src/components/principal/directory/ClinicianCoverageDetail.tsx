"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { ReasonConfirmSheet } from "@/components/shared/ReasonConfirmSheet";
import { CLINICIAN_SPECIALTY_LABEL, type ClinicianSpecialty } from "@/lib/clinicianSpecialties";
import type { ClinicianRow } from "./ClinicianList";

// Directory's fifth segment -- right pane. One screen, two ways in:
//
// 1. EXISTING: selected from ClinicianList -- clinician already known,
//    no code. Every Apply call uses p_clinician_id (migration 0151's
//    "already engaged" auth path).
// 2. NEW: "Engage a New Clinician" -- a code is entered ONCE, looked up
//    (lookup_clinician_by_code, same read-only preview
//    GrantClinicianAccessSheet already uses), and then kept in this
//    component's own state for the rest of the session -- every Apply
//    call for a brand-new clinician uses p_clinician_code, never asked
//    for again. Once engaged, the clinician moves onto ClinicianList's
//    own left-pane rows for next time (the "already engaged" path).
//
// Both converge on the SAME coverage checklist: every currently-enrolled
// child, covered or not (get_institution_clinician_coverage, 0151).
// coverage_source distinguishes 'institution' (this school's own grant --
// checked, selectable, revocable) from 'parent' (covered, but not this
// school's to touch -- shown, never checkable) from null (not covered --
// selectable). Select-all is tri-state over the SELECTABLE rows only;
// parent-covered rows are never included in "all".
//
// Apply computes the diff against the loaded state and, in one action:
//   - newly-checked rows -> bulk_grant_clinician_access() (one call, one
//     outcome per child -- a collision on one never blocks the rest)
//   - newly-unchecked rows -> revoke_clinician_access(), looped, sharing
//     ONE reason from a single prompt (revoking doesn't have the same
//     per-row collision risk granting does, so no batch RPC needed for
//     this half)
// One combined outcome message, naming who was skipped and why -- never
// a toast per child.

type CoverageState = "covered_by_us" | "covered_by_parent" | "not_covered";

interface CoverageRow {
  passportId: string;
  childName: string;
  state: CoverageState;
  clinicianAccessId: string | null;
  // Local, editable -- only meaningful when state !== "covered_by_parent".
  checked: boolean;
}

type ClinicianCoverageDetailProps =
  | {
      institutionId: string;
      mode: "existing";
      clinician: ClinicianRow;
      onCoverageChanged: () => void;
    }
  | {
      institutionId: string;
      mode: "new";
      onCoverageChanged: () => void;
    };

export function ClinicianCoverageDetail(props: ClinicianCoverageDetailProps) {
  const { institutionId, onCoverageChanged } = props;

  // "new" mode starts with no resolved clinician -- a code-entry step
  // fills this in, then the rest of the component behaves identically
  // to "existing" mode, just remembering the code instead of nothing.
  const [resolved, setResolved] = useState<{ clinicianId: string; fullName: string; specialty: string; code: string | null } | null>(
    props.mode === "existing" ? { ...props.clinician, code: null } : null
  );

  const [codeInput, setCodeInput] = useState("");
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [rows, setRows] = useState<CoverageRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [outcomeSummary, setOutcomeSummary] = useState<string | null>(null);
  const [isRemoveConfirmOpen, setIsRemoveConfirmOpen] = useState(false);

  // Reset when switching which clinician is selected (a different key
  // each time -- existing mode only, "new" mode's identity is set once
  // by the lookup below).
  useEffect(() => {
    function resetForNewSelection() {
      if (props.mode === "existing") {
        setResolved({ ...props.clinician, code: null });
        setOutcomeSummary(null);
        setApplyError(null);
      }
    }
    resetForNewSelection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mode === "existing" ? props.clinician.clinicianId : null]);

  const loadCoverage = useCallback(async (instId: string, clinicianId: string) => {
    setIsLoading(true);
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_institution_clinician_coverage", {
      p_institution_id: instId,
      p_clinician_id: clinicianId,
    });
    if (error) {
      setLoadError("Could not load this clinician's coverage.");
      setIsLoading(false);
      return;
    }
    setRows(
      (
        (data ?? []) as { passport_id: string; child_name: string; coverage_source: string | null; clinician_access_id: string | null }[]
      ).map((r) => ({
        passportId: r.passport_id,
        childName: r.child_name,
        state:
          r.coverage_source === "institution"
            ? "covered_by_us"
            : r.coverage_source === "parent"
              ? "covered_by_parent"
              : "not_covered",
        clinicianAccessId: r.clinician_access_id,
        checked: r.coverage_source === "institution",
      }))
    );
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (!resolved) return;
    async function run() {
      await loadCoverage(institutionId, resolved!.clinicianId);
    }
    run();
  }, [institutionId, resolved, loadCoverage]);

  async function handleLookup() {
    if (!codeInput.trim()) return;
    setIsLookingUp(true);
    setLookupError(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("lookup_clinician_by_code", { code: codeInput.trim() });
    setIsLookingUp(false);
    if (error) {
      setLookupError(error.message);
      return;
    }
    const clinician = data?.[0] ?? null;
    if (!clinician) {
      setLookupError("We couldn't find a clinician with that code. Please check with them and try again.");
      return;
    }
    setResolved({
      clinicianId: clinician.user_id,
      fullName: clinician.full_name ?? "This clinician",
      specialty: clinician.specialty,
      code: codeInput.trim(),
    });
  }

  const selectableRows = useMemo(() => rows.filter((r) => r.state !== "covered_by_parent"), [rows]);
  const allSelected = selectableRows.length > 0 && selectableRows.every((r) => r.checked);
  const someSelected = selectableRows.some((r) => r.checked);

  function toggleRow(passportId: string) {
    setRows((prev) => prev.map((r) => (r.passportId === passportId ? { ...r, checked: !r.checked } : r)));
  }

  function toggleSelectAll() {
    const next = !allSelected;
    setRows((prev) => prev.map((r) => (r.state === "covered_by_parent" ? r : { ...r, checked: next })));
  }

  const toGrant = rows.filter((r) => r.state === "not_covered" && r.checked);
  const toRevoke = rows.filter((r) => r.state === "covered_by_us" && !r.checked);
  const hasChanges = toGrant.length > 0 || toRevoke.length > 0;

  async function runGrant(): Promise<string[]> {
    if (!resolved) return [];
    const supabase = createClient();
    const params: { p_institution_id: string; p_passport_ids: string[]; p_clinician_code?: string; p_clinician_id?: string } = {
      p_institution_id: institutionId,
      p_passport_ids: toGrant.map((r) => r.passportId),
    };
    if (resolved.code) {
      params.p_clinician_code = resolved.code;
    } else {
      params.p_clinician_id = resolved.clinicianId;
    }
    const { data, error } = await supabase.rpc("bulk_grant_clinician_access", params);
    if (error) throw new Error(error.message);

    const byId = Object.fromEntries((toGrant as CoverageRow[]).map((r) => [r.passportId, r.childName]));
    const granted = (data ?? []).filter((r: { status: string }) => r.status === "granted" || r.status === "already_active");
    const skipped = (data ?? []).filter((r: { status: string }) => r.status !== "granted" && r.status !== "already_active");

    const parts: string[] = [];
    if (granted.length > 0) parts.push(`${granted.length} connected`);
    if (skipped.length > 0) {
      const names = skipped.map((r: { passport_id: string; message: string }) => `${byId[r.passport_id] ?? "a child"} (${r.message})`);
      parts.push(`${skipped.length} skipped: ${names.join(", ")}`);
    }
    return parts;
  }

  async function runRevoke(reason: string): Promise<string[]> {
    const supabase = createClient();
    let succeeded = 0;
    const failures: string[] = [];
    for (const row of toRevoke) {
      if (!row.clinicianAccessId) continue;
      const { error } = await supabase.rpc("revoke_clinician_access", {
        p_clinician_access_id: row.clinicianAccessId,
        p_reason: reason,
      });
      if (error) {
        failures.push(`${row.childName} (${error.message})`);
      } else {
        succeeded++;
      }
    }
    const parts: string[] = [];
    if (succeeded > 0) parts.push(`${succeeded} removed`);
    if (failures.length > 0) parts.push(`${failures.length} could not be removed: ${failures.join(", ")}`);
    return parts;
  }

  // Grant-only path (no removals staged) -- runs immediately, no reason
  // needed for a grant.
  async function handleApply() {
    if (toRevoke.length > 0) {
      setIsRemoveConfirmOpen(true);
      return;
    }
    setIsApplying(true);
    setApplyError(null);
    try {
      const parts = await runGrant();
      finishApply(parts);
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setIsApplying(false);
    }
  }

  // Combined path -- removals need a reason first (ReasonConfirmSheet's
  // own onConfirm does the real work and must return {error}; grants
  // have no failure mode worth blocking the sheet's success path on, so
  // they run inside the same onConfirm, after the revokes succeed, and
  // any grant-side skips surface in the SAME summary rather than a
  // second message).
  async function applyWithRemovals(reason: string): Promise<{ error: string | null }> {
    const revokeParts = await runRevoke(reason);
    const grantParts = toGrant.length > 0 ? await runGrant() : [];
    finishApply([...revokeParts, ...grantParts]);
    return { error: null };
  }

  function finishApply(parts: string[]) {
    setOutcomeSummary(parts.length > 0 ? parts.join(". ") + "." : "No changes.");
    if (resolved) loadCoverage(institutionId, resolved.clinicianId);
    onCoverageChanged();
  }

  if (!resolved) {
    // "new" mode, code not yet resolved.
    return (
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="font-heading text-h2 font-bold text-brand-prussian-blue">Engage a New Clinician</h2>
        <p className="mt-2 font-sans text-body text-brand-neutral-black/70">
          Enter the clinician&apos;s own code to engage them at your school. You&apos;ll choose which children they cover next --
          this code won&apos;t be asked for again.
        </p>
        <div className="mt-4">
          <label className="mb-1.5 block font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50" htmlFor="engage-clinician-code">
            Clinician code
          </label>
          <input
            id="engage-clinician-code"
            type="text"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            placeholder="e.g. CL-4821"
            className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 font-sans text-body text-brand-neutral-black"
          />
        </div>
        {lookupError && (
          <p role="alert" className="mt-3 font-sans text-body font-medium text-brand-golden-brown">
            {lookupError}
          </p>
        )}
        <Button type="button" onClick={handleLookup} disabled={isLookingUp || !codeInput.trim()} className="mt-4">
          {isLookingUp ? "Looking up…" : "Look Up Clinician"}
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <h2 className="font-heading text-h2 font-bold text-brand-prussian-blue">{resolved.fullName}</h2>
      <p className="mt-1 font-sans text-body text-brand-neutral-black/50">
        {CLINICIAN_SPECIALTY_LABEL[resolved.specialty as ClinicianSpecialty] ?? resolved.specialty}
      </p>

      {isLoading ? (
        <div className="mt-6 flex flex-col gap-2">
          <div className="h-10 animate-pulse rounded-xl bg-brand-off-white" />
          <div className="h-10 animate-pulse rounded-xl bg-brand-off-white" />
          <div className="h-10 animate-pulse rounded-xl bg-brand-off-white" />
        </div>
      ) : loadError ? (
        <p className="mt-6 font-sans text-body text-brand-neutral-black/60">{loadError}</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center font-sans text-body text-brand-neutral-black/60">
          No currently-enrolled children at this school.
        </p>
      ) : (
        <>
          <div className="mt-6 border-b border-black/10 pb-3">
            <Checkbox
              id="select-all-coverage"
              checked={allSelected}
              indeterminate={someSelected && !allSelected}
              onChange={toggleSelectAll}
              label={<span className="font-semibold">Select all</span>}
            />
          </div>
          <div className="mt-3 flex flex-col gap-3">
            {rows.map((r) => (
              <div key={r.passportId} className="flex items-center justify-between">
                {r.state === "covered_by_parent" ? (
                  <div>
                    <p className="font-sans text-body text-brand-neutral-black/40">{r.childName}</p>
                    <p className="font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-golden-brown">
                      Managed by parent
                    </p>
                  </div>
                ) : (
                  <Checkbox
                    id={`coverage-${r.passportId}`}
                    checked={r.checked}
                    onChange={() => toggleRow(r.passportId)}
                    label={r.childName}
                  />
                )}
              </div>
            ))}
          </div>

          {applyError && (
            <p role="alert" className="mt-4 font-sans text-body font-medium text-brand-golden-brown">
              {applyError}
            </p>
          )}
          {outcomeSummary && (
            <p className="mt-4 rounded-xl bg-brand-off-white/50 px-4 py-3 font-sans text-body text-brand-neutral-black">
              {outcomeSummary}
            </p>
          )}

          <Button type="button" onClick={handleApply} disabled={!hasChanges || isApplying} className="mt-6">
            {isApplying ? "Saving…" : "Save Changes"}
          </Button>
        </>
      )}

      {isRemoveConfirmOpen && (
        <ReasonConfirmSheet
          isOpen={isRemoveConfirmOpen}
          title={`Remove ${resolved.fullName} from ${toRevoke.length} child${toRevoke.length === 1 ? "" : "ren"}'s coverage?`}
          description="This ends their access to these children immediately. This is a revocation, not a delete -- it stays visible in each child's own access history."
          confirmLabel="Remove Coverage"
          submittingLabel="Removing…"
          onClose={() => setIsRemoveConfirmOpen(false)}
          onConfirm={applyWithRemovals}
          onConfirmed={() => setIsRemoveConfirmOpen(false)}
        />
      )}
    </div>
  );
}
