"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";

// School staff dashboard, by role -- the one place this destination
// lives, so the "already joined" resume check and the post-join
// routing below can never drift apart. class_teacher's destination is
// the pre-existing one, byte-identical; sna's is new (Phase 3 builds
// its real content -- see src/app/sna/dashboard/page.tsx).
function getStaffDashboardDestination(role: string | undefined): string {
  return role === "sna" ? "/sna/dashboard" : "/teacher/dashboard";
}

export default function TeacherJoinInstitutionPage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole(["class_teacher", "sna"]);
  const staffRole = user?.app_metadata?.role as string | undefined;

  const [code, setCode] = useState("");
  const [isChecking, setIsChecking] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;

    async function checkExisting() {
      const supabase = createClient();
      const { data } = await supabase
        .from("institution_staff")
        .select("institution_id")
        .eq("user_id", user!.id)
        .maybeSingle();

      if (!isMounted) return;

      if (data) {
        router.replace(getStaffDashboardDestination(staffRole));
        return;
      }
      setIsChecking(false);
    }

    checkExisting();
    return () => {
      isMounted = false;
    };
  }, [user, router, staffRole]);

  async function handleJoin() {
    if (!user || !code.trim()) return;

    setError(null);
    setIsSaving(true);

    const supabase = createClient();
    const { data: institution, error: lookupError } = await supabase
      .from("institutions")
      .select("id, status")
      .ilike("institution_code", code.trim())
      .maybeSingle();

    if (lookupError) {
      setIsSaving(false);
      setError(lookupError.message);
      return;
    }

    if (!institution) {
      setIsSaving(false);
      setError("We couldn't find an institution with that code. Please check and try again.");
      return;
    }

    if (institution.status !== "verified") {
      setIsSaving(false);
      setError("This institution hasn't been verified yet. Please try again later.");
      return;
    }

    // staffRole comes from the server-set app_metadata claim
    // useRequireRole already verified is one of class_teacher/sna --
    // never a client-suppliable value, and the DB's own self-link policy
    // (current_user_role() = role, migration 0033/0065) enforces this
    // independently even if it somehow weren't.
    const { error: staffError } = await supabase.from("institution_staff").insert({
      institution_id: institution.id,
      user_id: user.id,
      role: staffRole,
    });

    setIsSaving(false);

    if (staffError) {
      setError(staffError.message);
      return;
    }

    router.push(getStaffDashboardDestination(staffRole));
  }

  if (!isReady || isChecking) {
    return null;
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark />
          <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
            Join Your School
          </h1>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          <p className="mb-4 text-sm leading-relaxed text-black/60">
            Enter the institution code your school shared with you to join
            your Hive Dashboard.
          </p>

          <TextField
            label="Institution code"
            type="text"
            placeholder="e.g. 7F3K9Q"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="uppercase tracking-widest"
          />

          {error && (
            <p role="alert" className="mt-4 text-sm font-medium text-red-600">
              {error}
            </p>
          )}

          <Button
            type="button"
            onClick={handleJoin}
            disabled={!code.trim() || isSaving}
            className="mt-6"
          >
            {isSaving ? "Joining…" : "Join Institution"}
          </Button>
        </div>
      </div>
    </main>
  );
}
