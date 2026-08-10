"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface CompletedFba {
  id: string;
  clinicianName: string | null;
  childName: string;
  isApproved: boolean;
}

interface TeamMemberRow {
  teacher_id: string;
  full_name: string | null;
  role: string;
}

// Part C's dashboard prompt. Self-contained, same philosophy as
// QuestionnairePromptCard: fetches its own data, renders nothing while
// loading or when there's no completed FBA, fails silently on error
// (this is a nice-to-have surfaced above Recent Activity, not core
// content). The clinician's display name can't be read directly --
// `clinicians` only grants SELECT to the clinician themselves -- so this
// goes through the existing get_passport_team() RPC (already used by
// YourTeamCard for the same reason) instead of adding a new one.
export function FbaCompletedPromptCard() {
  const [fba, setFba] = useState<CompletedFba | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setIsLoading(false);
      return;
    }

    const { data: passport } = await supabase
      .from("passports")
      .select("id, child_name")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!passport) {
      setIsLoading(false);
      return;
    }

    const { data: reportRow } = await supabase
      .from("fba_reports")
      .select("id, clinician_id")
      .eq("passport_id", passport.id)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!reportRow) {
      setIsLoading(false);
      return;
    }

    const [{ data: teamRows }, { count: approvedCount }] = await Promise.all([
      supabase.rpc("get_passport_team", { p_passport_id: passport.id }),
      supabase
        .from("passport_clinical_content")
        .select("id", { count: "exact", head: true })
        .eq("source_document_type", "fba_report")
        .eq("source_document_id", reportRow.id),
    ]);

    const clinicianRow = ((teamRows ?? []) as TeamMemberRow[]).find(
      (row) => row.role === "clinician" && row.teacher_id === reportRow.clinician_id
    );

    setFba({
      id: reportRow.id,
      clinicianName: clinicianRow?.full_name ?? null,
      childName: passport.child_name,
      isApproved: (approvedCount ?? 0) > 0,
    });
    setIsLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (isLoading || !fba) {
    return null;
  }

  if (fba.isApproved) {
    return (
      <Link
        href={`/passport/fba/${fba.id}`}
        className="mb-6 block text-sm font-semibold text-brand-prussian-blue underline underline-offset-2"
      >
        Re-read {fba.childName}&apos;s Functional Behaviour Assessment
      </Link>
    );
  }

  return (
    <div className="mb-6 rounded-2xl border border-brand-off-white/50 border-t-4 border-t-brand-prussian-blue bg-white p-5 shadow-sm">
      <p className="text-sm text-brand-neutral-black">
        <span className="font-semibold">{fba.clinicianName ?? "Your clinician"}</span> has completed{" "}
        <span className="font-semibold">{fba.childName}</span>&apos;s Functional Behaviour Assessment.
      </p>
      <Link
        href={`/passport/fba/${fba.id}`}
        className="mt-3 block w-full rounded-2xl bg-brand-prussian-blue py-3 text-center text-sm font-semibold text-white"
      >
        Read it here
      </Link>
    </div>
  );
}
