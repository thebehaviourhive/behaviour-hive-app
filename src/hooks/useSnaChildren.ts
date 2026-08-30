"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getChildDisplayName, getChildFirstName } from "@/lib/childDisplayName";
import { useTeacherPassports, type TeacherPassport } from "./useTeacherPassports";
import { getTemporaryAccessWindowStatus, todayLocalDateString } from "@/lib/temporaryAccessTime";

// PRD 1, Stage 2 + 3: the fix for the gap named in CLAUDE.md ("WHEN
// ACCESS OR AUTHORITY IS GRANTED, TEST THE DESTINATION") -- an SNA's
// access to a child has THREE sources (passport_access, Stage 2's
// child_assignments, Stage 3's temporary_access), but /sna/passports
// only ever showed the first. This hook merges all three -- it does
// NOT touch useTeacherPassports itself, which /teacher/dashboard and
// /teacher/students both still rely on staying scoped to passport_
// access only (Stage 2's own deliberate separation, "My Class" is the
// class-derived view for TEACHERS specifically -- this is SNA's
// equivalent problem, not the same one, and gets its own hook rather
// than risk that established boundary).
//
// A temporary-access-derived child is labelled distinctly (isTemporary)
// so it never reads as permanent, and simply STOPS being returned once
// the grant's window closes -- computed fresh on every load, the same
// "no job, no cron" philosophy as everywhere else in this stage. There
// is no live removal mid-session without a reload; this app has no
// push mechanism anywhere, and that's an accepted, named limit on the
// "not silently gone" requirement, not a gap unique to this page.

export interface SnaChild extends TeacherPassport {
  isTemporary: boolean;
  isAssigned: boolean;
}

export interface ActiveCoverage {
  classId: string;
  className: string;
  startTime: string;
  cutoffTime: string;
}

interface UseSnaChildrenResult {
  isLoading: boolean;
  error: string | null;
  institutionId: string | null;
  institutionCode: string | null;
  children: SnaChild[];
  // Feeds TemporaryAccessBanner -- kept here rather than re-derived by
  // each consuming page, since this hook already resolves the exact
  // same activeGrantClassIds/cutoffTime this needs. Empty whenever the
  // caller holds no currently-active grant (an ordinary permanent SNA
  // reads this as [], the banner renders nothing).
  activeCoverage: ActiveCoverage[];
  refresh: () => void;
}

export function useSnaChildren(userId: string | null): UseSnaChildrenResult {
  const {
    isLoading: isLoadingGranted,
    error: grantedError,
    institutionId,
    institutionCode,
    passports: grantedPassports,
    refresh,
  } = useTeacherPassports(userId);

  const [isLoadingExtra, setIsLoadingExtra] = useState(true);
  const [extraError, setExtraError] = useState<string | null>(null);
  const [merged, setMerged] = useState<SnaChild[]>([]);
  const [activeCoverage, setActiveCoverage] = useState<ActiveCoverage[]>([]);

  useEffect(() => {
    if (isLoadingGranted) return;
    if (!userId || !institutionId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMerged(grantedPassports.map((p) => ({ ...p, isTemporary: false, isAssigned: false })));
      setActiveCoverage([]);
      setIsLoadingExtra(false);
      return;
    }

    let isMounted = true;

    async function load() {
      const supabase = createClient();
      setExtraError(null);

      const [assignmentResult, temporaryResult] = await Promise.all([
        supabase
          .from("child_assignments")
          .select("passport_id")
          .eq("user_id", userId)
          .eq("institution_id", institutionId)
          .is("ended_at", null),
        // Mirrors has_sna_access()'s own temporary_access branch
        // exactly: this grant's own class, today, currently within the
        // institution's own start-to-cut-off window -- computed here for
        // DISPLAY only, never the security boundary (RLS is, regardless
        // of what this query returns).
        supabase
          .from("temporary_access")
          .select("class_id, granted_for_date")
          .eq("granted_to", userId)
          .eq("institution_id", institutionId)
          .eq("granted_for_date", todayLocalDateString())
          .is("revoked_at", null),
      ]);

      if (!isMounted) return;

      if (assignmentResult.error || temporaryResult.error) {
        setExtraError((assignmentResult.error ?? temporaryResult.error)?.message ?? "Could not load your children.");
        setIsLoadingExtra(false);
        return;
      }

      const assignedPassportIds = new Set((assignmentResult.data ?? []).map((r) => r.passport_id));

      const { data: instRow } = await supabase
        .from("institutions")
        .select("temporary_access_start_time, temporary_access_cutoff_time")
        .eq("id", institutionId)
        .single();
      const startTime = instRow?.temporary_access_start_time ?? "07:30:00";
      const cutoffTime = instRow?.temporary_access_cutoff_time ?? "15:00:00";
      const windowStatus = getTemporaryAccessWindowStatus(startTime, cutoffTime);

      const activeGrantClassIds = windowStatus.isActive
        ? [...new Set((temporaryResult.data ?? []).map((r) => r.class_id))]
        : [];

      // 0109: class_children's own SELECT policy is deliberately
      // narrower than has_sna_access() -- current class teacher or the
      // principal only, general roster visibility reserved for Stage 4
      // (0104's own comment). A covering SNA is neither, so this can't
      // be a direct table read the way the passports fallback below is
      // -- get_temporary_access_covered_children() re-derives the same
      // live-window check server-side, scoped to one class at a time,
      // and returns full passport fields directly (skipping a second
      // round-trip through the generic extraIds resolution below).
      let temporaryChildren: TeacherPassport[] = [];
      let coverage: ActiveCoverage[] = [];
      if (activeGrantClassIds.length > 0) {
        const [childResults, classNameResult] = await Promise.all([
          Promise.all(
            activeGrantClassIds.map((classId) =>
              supabase.rpc("get_temporary_access_covered_children", { p_class_id: classId })
            )
          ),
          // "Active staff can view their institution's classes" (0104)
          // is institution-wide -- the auto-created row this grant
          // produces (Decision 4) already satisfies it, so this needs
          // no new access path the way the roster read above did.
          supabase.from("classes").select("id, name").in("id", activeGrantClassIds),
        ]);
        const rows = childResults.flatMap((r) => r.data ?? []);
        temporaryChildren = rows.map((row) => ({
          passportId: row.passport_id,
          childName: row.child_name || "This child",
          firstName: getChildFirstName(row.child_name),
          displayName: getChildDisplayName(row.child_name),
          diagnoses: row.diagnoses,
          diagnosisOther: row.diagnosis_other,
        }));
        coverage = (classNameResult.data ?? []).map((c) => ({
          classId: c.id,
          className: c.name,
          startTime,
          cutoffTime,
        }));
      }
      const temporaryPassportIds = new Set(temporaryChildren.map((p) => p.passportId));
      setActiveCoverage(coverage);

      const grantedById = new Map(grantedPassports.map((p) => [p.passportId, p]));
      const extraIds = [...assignedPassportIds].filter(
        (id) => !grantedById.has(id) && !temporaryPassportIds.has(id)
      );

      let extraPassports: TeacherPassport[] = [];
      if (extraIds.length > 0) {
        // Direct passports read -- Stage 2's has_child_access() branch
        // covers assignment-derived standing on this table's own SELECT
        // policy, so this is genuine RLS-granted access, not a
        // roster-RPC workaround (get_institution_child_roster() has no
        // diagnoses column, which the pill display below needs).
        // Temporary-access-derived children never reach here -- they're
        // already fully resolved above, via the RPC that exists
        // specifically because THIS read path doesn't reach them.
        const { data: extraRows, error: extraPassportError } = await supabase
          .from("passports")
          .select("id, child_name, diagnoses, diagnosis_other")
          .in("id", extraIds);
        if (extraPassportError) {
          setExtraError(extraPassportError.message);
        }
        extraPassports = (extraRows ?? []).map((row) => ({
          passportId: row.id,
          childName: row.child_name || "This child",
          firstName: getChildFirstName(row.child_name),
          displayName: getChildDisplayName(row.child_name),
          diagnoses: row.diagnoses,
          diagnosisOther: row.diagnosis_other,
        }));
      }

      const byId = new Map<string, TeacherPassport>();
      for (const p of grantedPassports) byId.set(p.passportId, p);
      for (const p of extraPassports) byId.set(p.passportId, p);
      for (const p of temporaryChildren) byId.set(p.passportId, p);

      const result: SnaChild[] = [...byId.values()].map((p) => ({
        ...p,
        isTemporary: temporaryPassportIds.has(p.passportId),
        isAssigned: assignedPassportIds.has(p.passportId),
      }));

      setMerged(result);
      setIsLoadingExtra(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [userId, institutionId, isLoadingGranted, grantedPassports]);

  return {
    isLoading: isLoadingGranted || isLoadingExtra,
    error: grantedError ?? extraError,
    institutionId,
    institutionCode,
    children: merged,
    activeCoverage,
    refresh,
  };
}
