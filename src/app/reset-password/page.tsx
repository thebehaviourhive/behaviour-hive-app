"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { createClient } from "@/lib/supabase/client";
import { getPostAuthRedirect } from "@/lib/roleRedirect";
import { getAuthErrorMessage } from "@/lib/authErrorMessage";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDone, setIsDone] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function checkAccess() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!isMounted) return;

      // Reachable only via a valid password-recovery link, which
      // establishes its own short-lived session -- no session here means
      // the link was missing, expired, or already used.
      if (!user) {
        router.replace("/login");
        return;
      }

      setIsReady(true);
    }

    checkAccess();
    return () => {
      isMounted = false;
    };
  }, [router]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setIsSubmitting(true);

    const supabase = createClient();
    const { data, error: updateError } = await supabase.auth.updateUser({ password });

    setIsSubmitting(false);

    if (updateError) {
      setError(
        getAuthErrorMessage(updateError, "Something went wrong — please try again.")
      );
      return;
    }

    setIsDone(true);
    setTimeout(() => {
      router.push(getPostAuthRedirect(data.user?.app_metadata?.role));
    }, 1200);
  }

  if (!isReady) {
    return null;
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark />
          <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
            Set a new password
          </h1>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          {isDone ? (
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <span aria-hidden className="text-3xl">
                ✅
              </span>
              <p className="text-sm text-brand-neutral-black/70">
                Your password has been updated.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <TextField
                label="New password"
                type="password"
                placeholder="••••••••••"
                autoComplete="new-password"
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <TextField
                label="Confirm new password"
                type="password"
                placeholder="••••••••••"
                autoComplete="new-password"
                minLength={8}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />

              {error && (
                <p role="alert" className="text-sm font-medium text-red-600">
                  {error}
                </p>
              )}

              <Button type="submit" disabled={isSubmitting} className="mt-2">
                {isSubmitting ? "Saving…" : "Save new password"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
