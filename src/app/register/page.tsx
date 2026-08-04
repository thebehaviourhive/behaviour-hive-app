"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { createClient } from "@/lib/supabase/client";
import { getAuthErrorMessage } from "@/lib/authErrorMessage";

export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const supabase = createClient();
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    });

    setIsSubmitting(false);

    if (signUpError) {
      setError(
        getAuthErrorMessage(
          signUpError,
          "Something went wrong creating your account — please try again."
        )
      );
      return;
    }

    router.push(`/verify-email?email=${encodeURIComponent(email)}`);
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark />
          <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
            Create your account
          </h1>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <TextField
              label="Full name"
              type="text"
              placeholder="Sarah Murphy"
              autoComplete="name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
            <TextField
              label="Email address"
              type="email"
              placeholder="sarah.murphy@email.com"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <TextField
              label="Password"
              type="password"
              placeholder="••••••••••"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            {error && (
              <p role="alert" className="text-sm font-medium text-red-600">
                {error}
              </p>
            )}

            <Button type="submit" disabled={isSubmitting} className="mt-2">
              {isSubmitting ? "Creating account…" : "Create account"}
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
            Already have an account?{" "}
            <a href="/login" className="font-semibold text-brand-prussian-blue">
              Sign in
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
