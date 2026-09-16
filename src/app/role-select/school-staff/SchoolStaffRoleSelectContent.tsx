"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { createClient } from "@/lib/supabase/client";
import { friendlyJoinError } from "@/lib/friendlyJoinError";
import { getInstitutionType } from "@/lib/institutionType";

// Onboarding restructure, Sept 2026: this used to be step two of
// "who are you" (asked BEFORE any institution code existed). Now it's
// the role picker AFTER a code has resolved -- reached only from
// role-select/page.tsx's own successful lookup, carrying the resolved
// institution forward via ?institutionId=. Tapping a real role tile
// now does what teacher/join-institution/page.tsx's own handleJoin()
// used to do as a separate later step: writes the role, then inserts
// institution_staff directly, in one action -- there is no reason to
// ask for the same code twice.
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

export function SchoolStaffRoleSelectContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const institutionId = searchParams.get("institutionId");

  const [error, setError] = useState<string | null>(null);
  const [submittingRole, setSubmittingRole] = useState<StaffRole | null>(null);
  // PRD 5 GREPPABLE PLACEHOLDER 1: an institution-employed clinician
  // joining THIS institution via its own code. Institution-employed
  // clinician self-service was never built (CLAUDE.md: "PARKED,
  // POST-TRIAL... manual path used for the trial instead") -- this is
  // a clear placeholder, not a school screen with the wrong words on
  // it, for the one real gap a fourth tile here would otherwise paper
  // over.
  const [showClinicianPlaceholder, setShowClinicianPlaceholder] = useState(false);

  useEffect(() => {
    if (!institutionId) {
      router.replace("/role-select");
    }
  }, [institutionId, router]);

  if (!institutionId) {
    return null;
  }

  // PRD 5 GREPPABLE PLACEHOLDER 2: a clinic-typed institution. Dead
  // code today -- getInstitutionType() cannot return anything but
  // 'school' without a `type` column this PRD deliberately does not
  // add (see CLAUDE.md's own account of why) -- but the fork stays in
  // place so PRD 5 can wire in a real clinic role picker here instead
  // of discovering this page has no branch for it at all.
  if (getInstitutionType({ id: institutionId }) === "clinic") {
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

  if (showClinicianPlaceholder) {
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
              Clinician accounts through your organisation aren&apos;t available here yet. If you
              work independently rather than through this organisation, go back and choose
              &ldquo;I don&apos;t have a code, or I&apos;m a parent&rdquo; instead.
            </p>
            <button
              type="button"
              onClick={() => setShowClinicianPlaceholder(false)}
              className="mt-6 w-full text-center text-sm font-semibold text-brand-prussian-blue"
            >
              Choose a different role
            </button>
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

            <button
              type="button"
              onClick={() => setShowClinicianPlaceholder(true)}
              disabled={submittingRole !== null}
              className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white p-3 text-left transition-colors hover:bg-black/[0.02] disabled:opacity-60"
            >
              <span
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-black/5 text-lg"
                aria-hidden
              >
                🧠
              </span>
              <span className="flex-1">
                <span className="block text-sm font-semibold text-brand-neutral-black">
                  Clinician
                </span>
                <span className="block text-xs text-black/50">
                  Employed by or working through this organisation
                </span>
              </span>
            </button>
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
