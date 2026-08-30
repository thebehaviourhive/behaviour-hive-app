"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";

// PRD 2, Stage 3. Full-screen, not a bottom sheet -- "Enrolling creates
// the child," per the design's own instruction, a deliberate act
// weighted the same way Handover's own full-screen sheet is (a
// deliberate context switch, not a quick action). Replaces
// EnrolChildSheet.tsx entirely (its own only caller); the write itself
// is unchanged -- create_school_passport() (0113/0121), the same RPC,
// same single required field.

export default function EnrolChildPage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole("principal");
  const [childName, setChildName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEnrol() {
    if (!user || !childName.trim()) return;
    setIsSubmitting(true);
    setError(null);

    const supabase = createClient();
    const { data: staffRow, error: staffError } = await supabase
      .from("institution_staff")
      .select("institution_id")
      .eq("user_id", user.id)
      .eq("role", "principal")
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .maybeSingle();

    if (staffError || !staffRow) {
      setIsSubmitting(false);
      setError("Could not find your institution.");
      return;
    }

    const { data: passportId, error: enrolError } = await supabase.rpc("create_school_passport", {
      p_institution_id: staffRow.institution_id,
      p_child_name: childName.trim(),
    });

    setIsSubmitting(false);

    if (enrolError) {
      setError(enrolError.message);
      return;
    }

    router.push(`/principal/passports/${passportId}`);
  }

  if (!isReady) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <Link
          href="/principal/passports"
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </Link>
        <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">Enrol a Child</h1>
      </header>

      <main className="flex-1 px-4">
        <p className="text-sm text-brand-neutral-black/70">
          Creates a new passport for this child, started by your school. Their parent or guardian claims it later
          using a code you generate from their own passport page — this doesn&apos;t require them to do anything yet.
        </p>

        <label className="mt-6 block text-sm font-semibold text-brand-neutral-black" htmlFor="enrol-child-name">
          Child&apos;s name
        </label>
        <input
          id="enrol-child-name"
          type="text"
          value={childName}
          onChange={(e) => setChildName(e.target.value)}
          placeholder="e.g. Sam Murphy"
          className="mt-1.5 w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
        />

        {error && (
          <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
            {error}
          </p>
        )}

        <Button type="button" onClick={handleEnrol} disabled={!childName.trim() || isSubmitting} className="mt-6">
          {isSubmitting ? "Enrolling…" : "Enrol Child"}
        </Button>
        <Link
          href="/principal/passports"
          className="mt-2 block rounded-2xl border border-black/10 py-3 text-center text-sm font-semibold text-black/60"
        >
          Cancel
        </Link>
      </main>
    </div>
  );
}
