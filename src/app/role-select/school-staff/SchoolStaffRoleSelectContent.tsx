"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { createClient } from "@/lib/supabase/client";
import { friendlyJoinError } from "@/lib/friendlyJoinError";
import { getInstitutionType, type InstitutionType } from "@/lib/institutionType";
import { getRoleLabel } from "@/lib/vocabulary";

// Onboarding restructure, Sept 2026: this used to be step two of
// "who are you" (asked BEFORE any institution code existed). Now it's
// the role picker AFTER a code has resolved -- reached only from
// role-select/page.tsx's own successful lookup, carrying the resolved
// institution forward via ?institutionId=. Tapping a real role tile
// now does what teacher/join-institution/page.tsx's own handleJoin()
// used to do as a separate later step: writes the role, then inserts
// institution_staff directly, in one action -- there is no reason to
// ask for the same code twice.
//
// PRD 5 GREPPABLE PLACEHOLDER 1 (REMOVED, 19 Sept 2026, before the
// school trial): a fourth "Clinician" tile used to sit here, leading to
// a "not set up yet" placeholder -- institution-employed clinician
// self-service is still parked (CLAUDE.md). A real trial user hitting a
// dead end on day one was judged worse than the gap the tile was
// flagging. Re-add the tile (see git history for its exact copy) once
// that self-service path is actually built -- until then a school-
// engaged clinician is onboarded manually, per approve_clinician().
//
// PLACEHOLDER 2 REPLACED, 21 Sept 2026 -- FOUND BY DANIEL'S OWN FIRST
// CLICK, NOT BY REVIEW. A clinic-typed institution used to dead-end
// here on a plain "Not set up yet" screen -- live, deployed, reachable
// by anyone who created a real clinic. PRD 5's seven stages built every
// clinic role's RLS/RPCs/consent screen/dashboard and verified all of
// it through fixtures and direct RPC calls; NONE of it was ever
// verified by a human actually signing up through this screen, because
// this screen never offered a clinic role to sign up as. The clinic
// track was fully built and fully unjoinable. See CLAUDE.md's own
// dedicated entry on this for the standing lesson: a new institution
// TYPE, like a new ROLE, is only proven once someone has signed up
// through the real onboarding screens as each of its roles -- every
// surface after signup can be perfectly correct and it proves nothing
// about whether anyone can ever reach it.
type SchoolRole = "class_teacher" | "sna" | "principal";
type ClinicRole = "principal" | "clinician" | "clinical_lead" | "clinic_admin";
type StaffRole = SchoolRole | ClinicRole;

const SCHOOL_ROLES: {
  value: SchoolRole;
  icon: string;
  title: string;
  subtitle: string;
}[] = [
  {
    value: "class_teacher",
    icon: "🏫",
    title: "Class teacher",
    subtitle: "I have my own class and support children throughout the day",
  },
  {
    value: "sna",
    icon: "🤝",
    title: "Special Needs Assistant",
    subtitle: "I support specific children alongside their class teacher",
  },
  {
    value: "principal",
    icon: "🗝️",
    title: "Principal",
    subtitle: "I oversee incident sign-off and records across the school",
  },
];

// Titles go through getRoleLabel(role, "clinic") -- PRD 5's own
// decided vocabulary (src/lib/vocabulary.ts), never hardcoded here --
// so a future per-institution override (institution_vocabulary_
// overrides) reaches this screen automatically if one is ever added.
// Subtitles are this screen's own descriptive copy, same as the school
// tiles', kept consistent with each role's own consent-screen lede
// (ClinicianAgreementScreen/ClinicalLeadAgreementScreen/
// ClinicAdminAgreementScreen/PrincipalAgreementScreen's clinic branch).
const CLINIC_ROLES: {
  value: ClinicRole;
  icon: string;
  title: string;
  subtitle: string;
}[] = [
  {
    value: "principal",
    icon: "🗝️",
    title: getRoleLabel("principal", "clinic"),
    subtitle: "I oversee clinical governance and countersign records across the clinic",
  },
  {
    value: "clinician",
    icon: "🩺",
    title: getRoleLabel("clinician", "clinic"),
    subtitle: "I hold a caseload and deliver clinical work with specific children",
  },
  {
    value: "clinical_lead",
    icon: "🧭",
    title: getRoleLabel("clinical_lead", "clinic"),
    subtitle: "I oversee a defined scope of the clinic's caseload, not just my own",
  },
  {
    value: "clinic_admin",
    icon: "🗂️",
    title: getRoleLabel("clinic_admin", "clinic"),
    subtitle: "I manage client onboarding and records, not clinical work",
  },
];

function isInstitutionType(value: string | null): value is InstitutionType {
  return value === "school" || value === "clinic";
}

export function SchoolStaffRoleSelectContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const institutionId = searchParams.get("institutionId");
  const institutionTypeParam = searchParams.get("institutionType");

  const [error, setError] = useState<string | null>(null);
  const [submittingRole, setSubmittingRole] = useState<StaffRole | null>(null);

  useEffect(() => {
    if (!institutionId || !isInstitutionType(institutionTypeParam)) {
      router.replace("/role-select");
    }
  }, [institutionId, institutionTypeParam, router]);

  if (!institutionId || !isInstitutionType(institutionTypeParam)) {
    return null;
  }

  const institutionType = getInstitutionType({ type: institutionTypeParam });
  const roles = institutionType === "clinic" ? CLINIC_ROLES : SCHOOL_ROLES;
  const heading =
    institutionType === "clinic" ? "What's your role at the clinic?" : "What's your role at school?";

  async function handleSelect(role: StaffRole) {
    if (submittingRole || !institutionId) return;

    setError(null);
    setSubmittingRole(role);

    const response = await fetch("/api/set-role", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });

    if (!response.ok) {
      const { error: responseError } = await response.json().catch(() => ({ error: null }));
      setSubmittingRole(null);
      setError(responseError ?? "Something went wrong. Please try again.");
      return;
    }

    const supabase = createClient();
    // Same reason role-select's own handleContinue refreshes the
    // session: the access token still carries the old (missing) role
    // claim until refreshed, and the institution_staff insert right
    // below reads it.
    await supabase.auth.refreshSession();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setSubmittingRole(null);
      setError("Something went wrong. Please try again.");
      return;
    }

    // Same insert shape teacher/join-institution/page.tsx's own
    // handleJoin() uses -- role comes from the freshly-refreshed
    // server-set claim, never a client-suppliable value, and the DB's
    // own self-link policy enforces this independently either way.
    // The self-link policy is institution-TYPE-aware (0203/0204): a
    // school only ever accepts its own four historical role values, a
    // clinic only accepts principal plus the three clinic-only ones --
    // this insert will be refused by RLS if role and institutionType
    // ever disagree, not just by this screen's own tile list.
    const { error: staffError } = await supabase.from("institution_staff").insert({
      institution_id: institutionId,
      user_id: user.id,
      role,
    });

    if (staffError) {
      setSubmittingRole(null);
      setError(friendlyJoinError(staffError.message));
      return;
    }

    router.push("/consent");
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark />
          <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">{heading}</h1>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          <p className="mb-4 text-sm leading-relaxed text-black/60">
            This helps us show you the right tools for your role.
          </p>

          <div className="flex flex-col gap-3">
            {roles.map((role) => (
              <button
                key={role.value}
                type="button"
                onClick={() => handleSelect(role.value)}
                disabled={submittingRole !== null}
                className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white p-3 text-left transition-colors hover:bg-black/[0.02] disabled:opacity-60"
              >
                <span
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-black/5 text-lg"
                  aria-hidden
                >
                  {role.icon}
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-semibold text-brand-neutral-black">
                    {role.title}
                  </span>
                  <span className="block text-xs text-black/50">{role.subtitle}</span>
                </span>
                {submittingRole === role.value && (
                  <span className="text-xs font-medium text-brand-prussian-blue">Saving…</span>
                )}
              </button>
            ))}
          </div>

          {error && (
            <p role="alert" className="mt-4 text-sm font-medium text-red-600">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => router.push("/role-select")}
            disabled={submittingRole !== null}
            className="mt-5 w-full text-center text-xs font-semibold text-brand-prussian-blue disabled:opacity-60"
          >
            Back
          </button>
        </div>
      </div>
    </main>
  );
}
