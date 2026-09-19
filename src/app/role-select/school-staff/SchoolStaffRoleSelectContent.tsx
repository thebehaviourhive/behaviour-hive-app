"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { createClient } from "@/lib/supabase/client";
import { friendlyJoinError } from "@/lib/friendlyJoinError";
import { getInstitutionType, type InstitutionType } from "@/lib/institutionType";

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
type StaffRole = "class_teacher" | "sna" | "principal";

const STAFF_ROLES: {
  value: StaffRole;
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

  // PRD 5 GREPPABLE PLACEHOLDER 2: a clinic-typed institution. Live now
  // -- institutions.type is real (migration 0200) and role-select/
  // page.tsx forwards it here. Still a placeholder screen, not a real
  // clinic role picker: clinic roles/onboarding are a later PRD 5
  // stage, not this one.
  if (getInstitutionType({ type: institutionTypeParam }) === "clinic") {
    return (
      <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
        <div className="w-full max-w-sm text-center">
          <div className="mb-6 flex flex-col items-center gap-3">
            <BrandMark />
          </div>
          <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
            <h1 className="mb-2 font-heading text-xl font-semibold text-brand-neutral-black">
              Not set up yet
            </h1>
            <p className="text-sm leading-relaxed text-black/60">
              Accounts for this kind of organisation aren&apos;t available here yet. We&apos;ll be
              in touch when they are.
            </p>
          </div>
        </div>
      </main>
    );
  }

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
          <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
            What&apos;s your role at school?
          </h1>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          <p className="mb-4 text-sm leading-relaxed text-black/60">
            This helps us show you the right tools for your role.
          </p>

          <div className="flex flex-col gap-3">
            {STAFF_ROLES.map((role) => (
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
