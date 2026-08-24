"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { createClient } from "@/lib/supabase/client";

// The second step of the two-step "School staff" flow (see
// src/app/role-select/page.tsx). Landing here writes NOTHING -- no
// placeholder role, nothing -- until one of these two tiles is tapped.
// Tapping a tile is the whole action: it calls /api/set-role directly
// (mirroring role-select's own handleContinue), so this screen carries
// no separate Continue button. That keeps the SNA path to exactly one
// added tap over the existing teacher flow: role-select's "School
// staff" tile + Continue (same two actions a teacher always took) is
// followed by a single tap here.
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

export default function SchoolStaffRoleSelectPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submittingRole, setSubmittingRole] = useState<StaffRole | null>(null);

  async function handleSelect(role: StaffRole) {
    if (submittingRole) return;

    setError(null);
    setSubmittingRole(role);

    const response = await fetch("/api/set-role", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });

    if (!response.ok) {
      const { error: responseError } = await response
        .json()
        .catch(() => ({ error: null }));
      setSubmittingRole(null);
      setError(responseError ?? "Something went wrong. Please try again.");
      return;
    }

    // Same reason as role-select's handleContinue: the access token
    // held by the client still carries the old (missing) role claim
    // until refreshed, and the very next screen (consent, then
    // join-institution) reads it.
    const supabase = createClient();
    await supabase.auth.refreshSession();

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
