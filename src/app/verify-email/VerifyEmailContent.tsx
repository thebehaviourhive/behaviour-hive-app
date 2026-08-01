"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { getPostAuthRedirect } from "@/lib/roleRedirect";

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_ATTEMPTS = 3;
const LOCKOUT_SECONDS = 5 * 60;
// Supabase's verifyOtp() returns the same "otp_expired" error code whether
// the code was mistyped or has genuinely expired -- there is no way to
// tell the two apart from the API response alone. This threshold is a
// best-effort guess at which one it probably was, based on how long ago
// the code was sent. It should roughly match the "Email OTP Expiry"
// duration configured in Supabase's dashboard (Authentication -> Emails).
const LIKELY_EXPIRED_AFTER_MS = 55 * 60 * 1000;

export function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "your email address";

  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const [isVerifying, setIsVerifying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState(MAX_ATTEMPTS);
  const [lockedSecondsLeft, setLockedSecondsLeft] = useState(0);
  const isLocked = lockedSecondsLeft > 0;

  const [codeSentAt, setCodeSentAt] = useState(() => new Date().getTime());
  const [resendState, setResendState] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (lockedSecondsLeft <= 0) return;
    const timer = setInterval(() => {
      setLockedSecondsLeft((seconds) => {
        const next = Math.max(0, seconds - 1);
        if (next === 0) {
          setAttemptsRemaining(MAX_ATTEMPTS);
          setErrorMessage(null);
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [lockedSecondsLeft]);

  function focusInput(index: number) {
    inputRefs.current[index]?.focus();
  }

  function clearDigits() {
    setDigits(Array(CODE_LENGTH).fill(""));
    focusInput(0);
  }

  function submitIfComplete(candidate: string[]) {
    if (candidate.every((d) => d !== "") && !isVerifying && !isLocked) {
      handleVerify(candidate.join(""));
    }
  }

  function handleDigitChange(index: number, rawValue: string) {
    const value = rawValue.replace(/\D/g, "").slice(-1);

    const next = [...digits];
    next[index] = value;
    setDigits(next);

    if (value && index < CODE_LENGTH - 1) {
      focusInput(index + 1);
    }

    if (value) {
      submitIfComplete(next);
    }
  }

  function handleKeyDown(index: number, event: React.KeyboardEvent) {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      focusInput(index - 1);
    }
  }

  function handlePaste(event: React.ClipboardEvent) {
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "");
    if (!pasted) return;
    event.preventDefault();

    const next = Array(CODE_LENGTH).fill("");
    for (let i = 0; i < Math.min(pasted.length, CODE_LENGTH); i++) {
      next[i] = pasted[i];
    }
    setDigits(next);
    focusInput(Math.min(pasted.length, CODE_LENGTH) - 1);
    submitIfComplete(next);
  }

  async function handleVerify(code: string) {
    setIsVerifying(true);
    setErrorMessage(null);

    const supabase = createClient();
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "signup",
    });

    setIsVerifying(false);

    if (error) {
      handleVerifyError(error.code);
      return;
    }

    if (data.user) {
      router.replace(getPostAuthRedirect(data.user.app_metadata?.role));
    }
  }

  function handleVerifyError(code: string | undefined) {
    if (code !== "otp_expired") {
      setErrorMessage("Something went wrong. Please try again.");
      clearDigits();
      return;
    }

    const codeAgeMs = new Date().getTime() - codeSentAt;
    if (codeAgeMs > LIKELY_EXPIRED_AFTER_MS) {
      setErrorMessage("That code has expired. Please request a new one.");
      clearDigits();
      return;
    }

    const nextAttempts = attemptsRemaining - 1;
    clearDigits();

    if (nextAttempts <= 0) {
      setAttemptsRemaining(0);
      setLockedSecondsLeft(LOCKOUT_SECONDS);
      setErrorMessage(
        "Too many attempts. Please wait 5 minutes before trying again."
      );
      return;
    }

    setAttemptsRemaining(nextAttempts);
    setErrorMessage(
      `That code does not match. Please try again. (${nextAttempts} attempt${nextAttempts === 1 ? "" : "s"} remaining)`
    );
  }

  async function handleResend() {
    if (resendState === "sending" || resendCooldown > 0) return;
    setResendState("sending");
    setErrorMessage(null);

    const supabase = createClient();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
    });

    if (error) {
      setResendState("error");
      return;
    }

    setResendState("sent");
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
    setAttemptsRemaining(MAX_ATTEMPTS);
    setLockedSecondsLeft(0);
    setCodeSentAt(new Date().getTime());
    clearDigits();
  }

  const resendLabel =
    resendState === "sending"
      ? "Sending…"
      : resendCooldown > 0
        ? `Resend in ${resendCooldown}s`
        : resendState === "sent"
          ? "Code resent — check your inbox"
          : "Resend code";

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
            We sent a 6-digit code to{" "}
            <span className="font-semibold text-brand-neutral-black">
              {email}
            </span>
            . Enter it below to verify your account.
          </p>

          <div
            role="group"
            aria-label="6-digit verification code"
            className="mt-6 flex justify-center gap-2"
          >
            {digits.map((digit, index) => (
              <input
                key={index}
                ref={(el) => {
                  inputRefs.current[index] = el;
                }}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={1}
                aria-label={`Digit ${index + 1} of ${CODE_LENGTH}`}
                value={digit}
                disabled={isVerifying || isLocked}
                onChange={(e) => handleDigitChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                onPaste={handlePaste}
                className="h-14 w-11 rounded-xl border border-black/10 text-center font-heading text-2xl font-bold text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue disabled:cursor-not-allowed disabled:opacity-40"
              />
            ))}
          </div>

          {errorMessage && (
            <p role="alert" className="mt-4 text-sm font-medium text-red-600">
              {errorMessage}
            </p>
          )}

          <Button
            type="button"
            onClick={() => handleVerify(digits.join(""))}
            disabled={digits.join("").length !== CODE_LENGTH || isVerifying || isLocked}
            className="mt-5"
          >
            {isVerifying ? "Verifying…" : "Verify"}
          </Button>

          <div className="mt-5 flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={handleResend}
              disabled={resendState === "sending" || resendCooldown > 0}
              className="text-sm font-semibold text-brand-prussian-blue disabled:opacity-50"
            >
              {resendLabel}
            </button>

            {resendState === "error" && (
              <p role="alert" className="text-xs font-medium text-red-600">
                Couldn&apos;t resend the code. Please try again shortly.
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
