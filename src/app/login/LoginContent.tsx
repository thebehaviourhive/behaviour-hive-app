"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { createClient } from "@/lib/supabase/client";
import { getPostAuthRedirect } from "@/lib/roleRedirect";

export function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackError = searchParams.get("error");
  const callbackReason = searchParams.get("reason");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const supabase = createClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setIsSubmitting(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    router.push(getPostAuthRedirect(data.user?.user_metadata?.role));
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark />
          <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
            Welcome back
          </h1>
        </div>

        {callbackError && (
          <div
            role="alert"
            className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            <p className="font-semibold">
              We couldn&apos;t confirm your email link.
            </p>
            {callbackReason && (
              <p className="mt-1 text-red-600">{callbackReason}</p>
            )}
          </div>
        )}

        <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <TextField
              label="Email address"
              type="email"
              placeholder="sarah.murphy@email.com"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <div className="flex flex-col gap-1.5">
              <TextField
                label="Password"
                type="password"
                placeholder="••••••••••"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <a
                href="#"
                className="self-end text-xs font-semibold text-brand-prussian-blue"
              >
                Forgot password?
              </a>
            </div>

            {error && (
              <p role="alert" className="text-sm font-medium text-red-600">
                {error}
              </p>
            )}

            <Button type="submit" disabled={isSubmitting} className="mt-2">
              {isSubmitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-black/10" />
            <span className="text-xs font-medium text-black/40">
              or continue with
            </span>
            <div className="h-px flex-1 bg-black/10" />
          </div>

          <div className="flex flex-col gap-3">
            <button
              type="button"
              className="flex items-center justify-center gap-2 rounded-2xl border border-black/10 bg-white py-3 text-sm font-semibold text-brand-neutral-black transition-colors hover:bg-black/[0.02]"
            >
              <span aria-hidden className="text-base font-bold">G</span>
              Continue with Google
            </button>
            <button
              type="button"
              className="flex items-center justify-center gap-2 rounded-2xl border border-black/10 bg-white py-3 text-sm font-semibold text-brand-neutral-black transition-colors hover:bg-black/[0.02]"
            >
              Continue with Apple
            </button>
          </div>

          <p className="mt-5 text-center text-sm text-black/60">
            Don&apos;t have an account?{" "}
            <a href="/register" className="font-semibold text-brand-prussian-blue">
              Register
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
