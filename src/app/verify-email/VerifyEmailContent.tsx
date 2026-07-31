"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { createSignUpClient } from "@/lib/supabase/signup-client";

export function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "your email address";

  const [resendState, setResendState] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");

  async function handleResend() {
    if (resendState === "sending") return;
    setResendState("sending");

    const supabase = createSignUpClient();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    setResendState(error ? "error" : "sent");
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
      <div className="w-full max-w-sm text-center">
        <div className="mb-6 flex flex-col items-center gap-3">
          <BrandMark />
          <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
            Check your email
          </h1>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          <p className="text-sm leading-relaxed text-black/70">
            We sent a confirmation link to{" "}
            <span className="font-semibold text-brand-neutral-black">
              {email}
            </span>
            . Click it to verify your account and get started.
          </p>

          <div className="mt-6 flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={handleResend}
              disabled={resendState === "sending"}
              className="text-sm font-semibold text-brand-prussian-blue disabled:opacity-50"
            >
              {resendState === "sending"
                ? "Resending…"
                : resendState === "sent"
                  ? "Email resent — check your inbox"
                  : "Resend email"}
            </button>

            {resendState === "error" && (
              <p role="alert" className="text-xs font-medium text-red-600">
                Couldn&apos;t resend the email. Please try again shortly.
              </p>
            )}

            <a
              href="/register"
              className="text-sm font-semibold text-black/50"
            >
              Wrong email? Go back
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
