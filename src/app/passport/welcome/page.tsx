"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useMyPassport } from "@/hooks/useMyPassport";

export default function PassportWelcomePage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole("parent");
  // A parent who already has a passport (self-created OR claimed) has no
  // reason to land on "create a new one" -- CLAUDE.md's own Stage 5 Step
  // 3 entry names this redirect as what contains the "blank create-new
  // form" risk elsewhere. Scoped deliberately: this only redirects AWAY
  // from the create-new form below, never away from /passport/claim
  // itself, which stays independently reachable (a parent with one
  // child already could still be claiming a second's code via a direct
  // link the school sent them -- there's no in-app "add another child"
  // entry point yet, a real, separate gap, not solved here).
  const { passportId: existingPassportId, isLoading: isCheckingExisting } = useMyPassport(user?.id);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isCheckingExisting || !existingPassportId) return;
    router.replace("/passport/dashboard");
  }, [isCheckingExisting, existingPassportId, router]);

  // PRD 3, Stage 1: was .upsert({user_id, passport_status}, {onConflict:
  // "user_id"}) -- .upsert() sends Prefer: return=representation by
  // default, even with no .select() chained, so the new row had to pass
  // passports' own SELECT policy (owns_passport(id), 0117) WITHIN THE
  // SAME STATEMENT. That policy depends on a passport_guardians row a
  // trigger creates AFTER the insert -- invisible to the same-statement
  // check. Every brand-new parent hit this on their very first save,
  // in production, since 0117 shipped -- see CLAUDE.md's new gotcha
  // entry. A plain .insert() closes it -- this handler only ever runs
  // once useMyPassport() above has already confirmed no passport exists
  // yet (the effect at the top of this component redirects away the
  // instant one does), so there is never a real conflict to resolve;
  // onConflict was never doing anything here except triggering the bug.
  async function handleSaveAndExit() {
    if (!user) return;

    setError(null);
    setIsSaving(true);

    const supabase = createClient();
    const { error: insertError } = await supabase
      .from("passports")
      .insert({ user_id: user.id, passport_status: "in_progress" });

    setIsSaving(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    router.push("/parent-dashboard");
  }

  if (!isReady || isCheckingExisting || existingPassportId) {
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

          {/* PRD 1, Stage 5, Step 3, Requirement 3 -- a parallel entry
              point, not a buried fallback: a parent told about this by
              their child's school (Requirement 2's own claim code, from
              a school-created passport) arrives here already knowing
              exactly what they want to do, and shouldn't have to read
              this as an "alternative" to creating a passport from
              scratch. Equal visual weight to "Next" above, its own
              divider rather than grouped with "Save and exit" below. */}
          <div className="my-5 flex items-center gap-3" aria-hidden>
            <div className="h-px flex-1 bg-black/10" />
            <span className="text-xs font-semibold uppercase tracking-wide text-black/30">or</span>
            <div className="h-px flex-1 bg-black/10" />
          </div>

          <p className="text-sm text-black/70">
            Already have a code from your child&apos;s school?
          </p>
          <Link
            href="/passport/claim"
            className="mt-3 flex w-full items-center justify-center rounded-full border-2 border-brand-prussian-blue py-3 text-base font-semibold text-brand-prussian-blue"
          >
            Enter your code
          </Link>

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
