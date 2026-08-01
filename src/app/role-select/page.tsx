"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { getPostAuthRedirect } from "@/lib/roleRedirect";

type Role = "parent" | "class_teacher" | "clinician";

const ROLES: {
  value: Role;
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
    value: "class_teacher",
    icon: "🏫",
    title: "Class teacher",
    subtitle: "Supporting children in school",
  },
  {
    value: "clinician",
    icon: "🧠",
    title: "Clinician",
    subtitle: "BCBA, psychologist, OT, SLT or GP",
  },
];

const ROLE_LABELS: Record<Role, string> = {
  parent: "parent / carer",
  class_teacher: "class teacher",
  clinician: "clinician",
};

export default function RoleSelectPage() {
  const router = useRouter();
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleContinue() {
    if (!selectedRole) return;

    setError(null);
    setIsSubmitting(true);

    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({
      data: { role: selectedRole },
    });

    if (updateError) {
      setIsSubmitting(false);
      setError(updateError.message);
      return;
    }

    // updateUser() changes user_metadata in the database immediately, but
    // the access token already held by the client keeps its old claims
    // until refreshed — the institution_staff insert a teacher makes on
    // the very next screen checks auth.jwt() ->> 'role', which would
    // otherwise still read the pre-selection role.
    await supabase.auth.refreshSession();

    setIsSubmitting(false);

    if (selectedRole === "parent") {
      router.push("/consent");
      return;
    }

    if (selectedRole === "class_teacher") {
      router.push("/teacher/join-institution");
      return;
    }

    // Clinician has no dedicated onboarding entry point yet — land on the
    // same placeholder dashboard a returning login would send them to.
    router.push(getPostAuthRedirect(selectedRole));
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
              : selectedRole
                ? `Continue as ${ROLE_LABELS[selectedRole]}`
                : "Continue"}
          </Button>
        </div>
      </div>
    </main>
  );
}
