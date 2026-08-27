"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";
import { DeactivateStaffSheet } from "@/components/principal/DeactivateStaffSheet";

// Staff Lifecycle Stage 1, Step 3. Minimal by design -- this is not the
// principal dashboard (that's PRD 2). A list, a deactivate action, a
// leaving checklist before it. Nothing else. Tone matches the rest of
// this module's principal-facing surfaces: administrative and precise.

interface StaffRow {
  id: string;
  user_id: string;
  full_name: string;
  role: string;
  is_active: boolean;
}

const ROLE_LABEL: Record<string, string> = {
  class_teacher: "Class Teacher",
  sna: "SNA",
  principal: "Principal",
  institution_admin: "Institution Admin",
};

export default function PrincipalStaffPage() {
  const { user, isReady } = useRequireRole("principal");
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<StaffRow | null>(null);

  const load = useCallback(async (instId: string) => {
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("get_institution_staff_roster", {
      p_institution_id: instId,
      p_include_inactive: true,
    });
    if (rpcError) {
      setError("Could not load the staff list.");
      setIsLoading(false);
      return;
    }
    setStaff((data ?? []) as StaffRow[]);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;

    async function resolveInstitutionAndLoad() {
      const supabase = createClient();
      // deactivated_at is null here even though a deactivated principal
      // isn't reachable yet (see CLAUDE.md, Deferred work) -- Stage 1b
      // makes it reachable, and this lookup should already be correct
      // for that day rather than need a second pass then.
      const { data: staffRow, error: staffError } = await supabase
        .from("institution_staff")
        .select("institution_id")
        .eq("user_id", user!.id)
        .eq("role", "principal")
        .is("deactivated_at", null)
        .maybeSingle();

      if (!isMounted) return;

      if (staffError || !staffRow) {
        setError("Could not find your institution.");
        setIsLoading(false);
        return;
      }

      setInstitutionId(staffRow.institution_id);
      await load(staffRow.institution_id);
    }

    resolveInstitutionAndLoad();
    return () => {
      isMounted = false;
    };
  }, [user, load]);

  if (!isReady) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-10">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <Link
          href="/principal/dashboard"
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </Link>
        <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">Staff</h1>
      </header>

      <main className="flex-1 px-4">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
          </div>
        ) : error ? (
          <p className="text-sm text-brand-neutral-black/60">{error}</p>
        ) : staff.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
            No staff registered at this school yet.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {staff.map((member) => (
              <StaffCard
                key={member.user_id}
                member={member}
                isSelf={member.user_id === user?.id}
                onDeactivate={() => setDeactivateTarget(member)}
              />
            ))}
          </div>
        )}
      </main>

      {deactivateTarget && institutionId && (
        <DeactivateStaffSheet
          member={deactivateTarget}
          isOpen={Boolean(deactivateTarget)}
          onClose={() => setDeactivateTarget(null)}
          onDeactivated={() => {
            setDeactivateTarget(null);
            load(institutionId);
          }}
        />
      )}
    </div>
  );
}

function StaffCard({
  member,
  isSelf,
  onDeactivate,
}: {
  member: StaffRow;
  isSelf: boolean;
  onDeactivate: () => void;
}) {
  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-brand-neutral-black">
            {member.full_name}
            {isSelf && <span className="text-brand-neutral-black/50"> (you)</span>}
          </p>
          <p className="mt-0.5 text-xs text-brand-neutral-black/50">{ROLE_LABEL[member.role] ?? member.role}</p>
        </div>
        <span
          className={`flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
            member.is_active
              ? "bg-brand-pastel-blue/20 text-brand-prussian-blue"
              : "bg-black/5 text-brand-neutral-black/60"
          }`}
        >
          {member.is_active ? "Active" : "Deactivated"}
        </span>
      </div>

      {member.is_active && !isSelf && (
        <button
          type="button"
          onClick={onDeactivate}
          className="mt-3 block w-full rounded-xl border border-brand-golden-brown py-2 text-center text-xs font-semibold text-brand-golden-brown"
        >
          Deactivate
        </button>
      )}
    </div>
  );
}
