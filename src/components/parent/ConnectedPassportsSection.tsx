"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// A parent can no longer CREATE a passport -- the school or clinic
// owns it (Stage 2, 15 Sept 2026, self-creation retired). This
// replaces the old "Build your child's passport" entry point with the
// real one: connecting to a record someone else already started, by
// code. Multi-child, 21 Sept 2026 -- the entry box stays visible
// regardless of how many passports are already connected, since a
// parent can have more than one child, each with their own code, and
// nothing here should ever look "finished" and stop offering it.
//
// Reuses redeem_passport_claim_code() exactly as /passport/claim
// does -- same RPC, same server-side rate limiting, same refusal
// text shown as-is. This is a new PLACE to enter a code, not a new
// way to redeem one; /passport/claim itself is untouched and still
// the first-time entry point reached from /passport/welcome before
// any dashboard content exists.
//
// Copy stays deliberately neutral -- never "your school", never "your
// clinic" -- matching the onboarding restructure's own standing rule:
// a code can come from either, and nothing here knows which until
// it's redeemed.
interface ConnectedPassport {
  passportId: string;
  childName: string;
}

export function ConnectedPassportsSection() {
  const [passports, setPassports] = useState<ConnectedPassport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justConnectedName, setJustConnectedName] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("get_my_passports");
    if (rpcError) {
      console.error("Failed to load connected passports:", rpcError);
      setIsLoading(false);
      return;
    }
    setPassports(
      ((data ?? []) as { passport_id: string; child_name: string }[]).map((row) => ({
        passportId: row.passport_id,
        childName: row.child_name,
      }))
    );
    setIsLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleConnect() {
    if (!code.trim()) return;
    setError(null);
    setJustConnectedName(null);
    setIsSubmitting(true);

    const supabase = createClient();
    const { data, error: claimError } = await supabase.rpc("redeem_passport_claim_code", {
      p_code: code.trim(),
    });

    if (claimError) {
      setIsSubmitting(false);
      setError(claimError.message);
      return;
    }

    const claimed = data?.[0] ?? null;
    if (!claimed) {
      setIsSubmitting(false);
      setError("We couldn't find a passport with that code. Please check it and try again.");
      return;
    }

    setCode("");
    setJustConnectedName(claimed.child_name);
    setIsSubmitting(false);
    await load();
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-brand-neutral-black">
          Enter your child&apos;s passport code
        </p>
        <p className="mt-1 text-xs text-black/50">
          You&apos;ll be given a code to link your account to your child&apos;s passport. Have a code for
          another child? Enter it here too.
        </p>

        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setError(null);
            }}
            placeholder="e.g. SAM4821"
            autoCapitalize="characters"
            className="min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm uppercase tracking-widest text-brand-neutral-black placeholder:normal-case placeholder:tracking-normal placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
          />
          <button
            type="button"
            onClick={handleConnect}
            disabled={!code.trim() || isSubmitting}
            className="flex-shrink-0 rounded-xl bg-brand-prussian-blue px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            {isSubmitting ? "Connecting…" : "Connect"}
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-2.5 text-xs font-medium text-red-600">
            {error}
          </p>
        )}
        {justConnectedName && (
          <p className="mt-2.5 text-xs font-medium text-green-700">
            Connected to {justConnectedName}&apos;s passport.
          </p>
        )}
      </div>

      {!isLoading && passports.length > 0 && (
        <div className="flex flex-col gap-2">
          {passports.map((p) => (
            <Link
              key={p.passportId}
              href={`/passport/dashboard?passportId=${p.passportId}`}
              className="flex items-center justify-between gap-3 rounded-2xl border border-black/5 bg-white p-4 shadow-sm transition-colors active:bg-black/[0.02]"
            >
              <span className="text-sm font-semibold text-brand-neutral-black">{p.childName}</span>
              <span className="flex-shrink-0 rounded-full bg-brand-pastel-blue/40 px-4 py-1.5 text-xs font-semibold text-brand-prussian-blue">
                View passport
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
