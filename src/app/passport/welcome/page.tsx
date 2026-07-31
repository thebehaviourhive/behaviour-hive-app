"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";

export default function PassportWelcomePage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole("parent");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSaveAndExit() {
    if (!user) return;

    setError(null);
    setIsSaving(true);

    const supabase = createClient();
    const { error: upsertError } = await supabase
      .from("passports")
      .upsert(
        { user_id: user.id, passport_status: "in_progress" },
        { onConflict: "user_id", ignoreDuplicates: false }
      );

    setIsSaving(false);

    if (upsertError) {
      setError(upsertError.message);
      return;
    }

    router.push("/parent-dashboard");
  }

  if (!isReady) {
    return null;
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
      <div className="w-full max-w-sm text-center">
        <div className="mb-6 flex flex-col items-center gap-3">
          <BrandMark />
          <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
            Behaviour Passport
          </h1>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          <p className="text-sm leading-relaxed text-black/70">
            Create your child&apos;s behaviour passport to help everyone
            around them understand them better — parents, teachers,
            clinicians. Everyone, working together!
          </p>

          {error && (
            <p role="alert" className="mt-4 text-sm font-medium text-red-600">
              {error}
            </p>
          )}

          <Button
            type="button"
            onClick={() => router.push("/passport/section-a")}
            className="mt-6"
          >
            Next
          </Button>

          <button
            type="button"
            onClick={handleSaveAndExit}
            disabled={isSaving}
            className="mt-4 text-sm font-semibold text-black/50 disabled:opacity-50"
          >
            {isSaving ? "Saving…" : "Save and exit"}
          </button>
        </div>
      </div>
    </main>
  );
}
