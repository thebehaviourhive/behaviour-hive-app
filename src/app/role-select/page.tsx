"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";

// "school_staff" is a UI-only sentinel, never written anywhere -- it
// exists purely to route Continue to the School Staff sub-select
// instead of calling /api/set-role directly. The two real roles that
// screen can produce (class_teacher, sna) are the only values that
// ever reach set-role for this branch. See ROLES below.
type SelectableValue = "parent" | "school_staff" | "clinician";

const ROLES: {
  value: SelectableValue;
  icon: string;
  title: string;
  subtitle: string;
}[] = [
  {
    value: "parent",
    icon: "❤",
    title: "Parent or carer",
    subtitle: "Building a passport for my child",
  },
  {
    value: "school_staff",
    icon: "🏫",
    title: "School staff",
    subtitle: "Class teacher or SNA supporting children in school",
  },
  {
    value: "clinician",
    icon: "🧠",
    title: "Clinician",
    subtitle: "BCBA, psychologist, OT, SLT or GP",
  },
];

const ROLE_LABELS: Record<SelectableValue, string> = {
  parent: "parent / carer",
  school_staff: "school staff",
  clinician: "clinician",
};

export default function RoleSelectPage() {
  const router = useRouter();
  const [selectedRole, setSelectedRole] = useState<SelectableValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleContinue() {
    if (!selectedRole) return;

    // School staff never writes a role here -- the sub-select screen is
    // where the real class_teacher/sna choice happens and set-role gets
    // called. Never write a placeholder role.
    if (selectedRole === "school_staff") {
      router.push("/role-select/school-staff");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    const response = await fetch("/api/set-role", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: selectedRole }),
    });

    if (!response.ok) {
      const { error: responseError } = await response
        .json()
        .catch(() => ({ error: null }));
      setIsSubmitting(false);
      setError(responseError ?? "Something went wrong. Please try again.");
      return;
    }

    // The role was just written server-side to app_metadata, but the
    // access token already held by the client keeps its old claims until
    // refreshed — the institution_staff insert a teacher makes on the
    // very next screen checks it, which would otherwise still read the
    // pre-selection role.
    const supabase = createClient();
    await supabase.auth.refreshSession();

    setIsSubmitting(false);

    // All roles go through the same consent screen (its own copy and
    // post-accept destination now branch per role -- see
    // src/app/consent/page.tsx); teachers previously skipped consent
    // entirely and went straight to join-institution, which /consent
    // now forwards them to itself once they accept.
    router.push("/consent");
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark />
          <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
            Who are you?
          </h1>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          <p className="mb-4 text-sm leading-relaxed text-black/60">
            Your role determines what you can see and do on the platform.
          </p>

          <div className="flex flex-col gap-3">
            {ROLES.map((role) => {
              const isSelected = selectedRole === role.value;
              return (
                <button
                  key={role.value}
                  type="button"
                  onClick={() => setSelectedRole(role.value)}
                  className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors ${
                    isSelected
                      ? "border-brand-prussian-blue bg-brand-pastel-blue/20"
                      : "border-black/10 bg-white hover:bg-black/[0.02]"
                  }`}
                >
                  <span
                    className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-lg ${
                      isSelected
                        ? "bg-brand-prussian-blue text-white"
                        : "bg-black/5"
                    }`}
                    aria-hidden
                  >
                    {role.icon}
                  </span>
                  <span className="flex-1">
                    <span className="block text-sm font-semibold text-brand-neutral-black">
                      {role.title}
                    </span>
                    <span
                      className={`block text-xs ${isSelected ? "text-brand-prussian-blue" : "text-black/50"}`}
                    >
                      {role.subtitle}
                    </span>
                  </span>
                  {isSelected && (
                    <span
                      className="text-lg font-semibold text-brand-prussian-blue"
                      aria-hidden
                    >
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {error && (
            <p role="alert" className="mt-4 text-sm font-medium text-red-600">
              {error}
            </p>
          )}

          <Button
            type="button"
            onClick={handleContinue}
            disabled={!selectedRole || isSubmitting}
            className="mt-5"
          >
            {isSubmitting
              ? "Saving…"
              : selectedRole === "school_staff"
                ? "Continue"
                : selectedRole
                  ? `Continue as ${ROLE_LABELS[selectedRole]}`
                  : "Continue"}
          </Button>
        </div>
      </div>
    </main>
  );
}
