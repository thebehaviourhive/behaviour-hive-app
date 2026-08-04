"use client";

import { useState, type FormEvent } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { createClient } from "@/lib/supabase/client";
import { getAuthErrorMessage } from "@/lib/authErrorMessage";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback`,
    });

    setIsSubmitting(false);

    if (resetError) {
      setError(
        getAuthErrorMessage(resetError, "Something went wrong — please try again.")
      );
      return;
    }

    setIsSent(true);
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark />
          <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
            Reset your password
          </h1>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          {isSent ? (
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <span aria-hidden className="text-3xl">
                📬
              </span>
              <p className="text-sm text-brand-neutral-black/70">
                If an account exists for <strong>{email}</strong>, we&apos;ve
                sent a link to reset your password.
              </p>
              <a
                href="/login"
                className="mt-2 text-sm font-semibold text-brand-prussian-blue"
              >
                Back to sign in
              </a>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <p className="text-sm text-brand-neutral-black/70">
                Enter the email address on your account and we&apos;ll send
                you a link to reset your password.
              </p>
              <TextField
                label="Email address"
                type="email"
                placeholder="sarah.murphy@email.com"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />

              {error && (
                <p role="alert" className="text-sm font-medium text-red-600">
                  {error}
                </p>
              )}

              <Button type="submit" disabled={isSubmitting} className="mt-2">
                {isSubmitting ? "Sending…" : "Send reset link"}
              </Button>

              <p className="text-center text-sm text-black/60">
                <a href="/login" className="font-semibold text-brand-prussian-blue">
                  Back to sign in
                </a>
              </p>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
