"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";

// TIER 1, item 1 of the reachability pass -- a centre manager had no
// entry point at all to add a client. peek_institution_link_code()/
// redeem_institution_link_code() (0297) already admit
// (inst.type = 'respite_centre' and role = 'centre_manager') at the
// RPC layer -- built for exactly this, never called from anywhere. A
// dedicated component, not a widening of principal/passports/enrol's
// own gate: that page's "new" mode calls onboard_clinic_client()/
// create_school_passport(), neither of which a respite centre ever
// calls (a centre never creates a passport, only redeems a code a
// clinic already generated) -- entangling that page's clinic/school
// branching with a third institution type was the wrong shape.
// Same peek-then-confirm pattern as LinkExistingPassportForm (that
// page's own component), copy adapted to a respite centre.
export function RedeemLinkCodeSheet({
  isOpen,
  onClose,
  institutionId,
  institutionName,
}: {
  isOpen: boolean;
  onClose: () => void;
  institutionId: string;
  institutionName: string | null;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [isPeeking, setIsPeeking] = useState(false);
  const [peekError, setPeekError] = useState<string | null>(null);
  const [peeked, setPeeked] = useState<{ passportId: string; childName: string } | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  function reset() {
    setCode("");
    setIsPeeking(false);
    setPeekError(null);
    setPeeked(null);
    setIsCommitting(false);
    setCommitError(null);
  }

  async function handlePeek() {
    if (!code.trim()) return;
    setIsPeeking(true);
    setPeekError(null);
    const supabase = createClient();
    const { data, error: peekErr } = await supabase.rpc("peek_institution_link_code", {
      p_code: code.trim(),
    });
    setIsPeeking(false);

    if (peekErr) {
      setPeekError(peekErr.message);
      return;
    }
    const rows = (data ?? []) as { passport_id: string; child_name: string }[];
    if (rows.length === 0) {
      setPeekError("We couldn't find a record with that code. Please check with the clinic and try again.");
      return;
    }
    setPeeked({ passportId: rows[0].passport_id, childName: rows[0].child_name });
  }

  async function handleConfirm() {
    setIsCommitting(true);
    setCommitError(null);
    const supabase = createClient();
    // redeem_institution_link_code() returns table (passport_id), not a
    // scalar (migration 0305) -- found live, 25 Sept 2026, building the
    // centre_manager dashboard: this caller was missed when that fix
    // shipped (the grep for "every real client caller" only found
    // principal/passports/enrol/page.tsx's own handleConfirm(), which
    // this file's own real, separate copy of the identical mistake
    // proves was incomplete). Before this fix, `passportId` was the raw
    // returned array, and router.push() built the literal URL
    // `/centre/passport/[object Object]` -- confirmed live, caught by
    // this build's own verification pass, not assumed.
    const { data, error: redeemErr } = await supabase.rpc("redeem_institution_link_code", {
      p_institution_id: institutionId,
      p_code: code.trim(),
    });
    setIsCommitting(false);

    if (redeemErr) {
      setCommitError(redeemErr.message);
      return;
    }
    const rows = (data ?? []) as { passport_id: string }[];
    if (rows.length === 0) {
      setCommitError("We couldn't find a record with that code. Please check with the clinic and try again.");
      return;
    }
    reset();
    onClose();
    router.push(`/centre/passport/${rows[0].passport_id}`);
  }

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={() => {
        reset();
        onClose();
      }}
    >
      <div className="p-4">
        <h2 className="mb-2 font-heading text-xl font-semibold text-brand-neutral-black">Add a client</h2>

        {peeked ? (
          <>
            <p className="text-sm text-brand-neutral-black/70">
              Link <span className="font-semibold text-brand-neutral-black">{peeked.childName}</span> to{" "}
              {institutionName ?? "your centre"}?
            </p>
            <p className="mt-2 text-xs text-brand-neutral-black/50">
              This gives your centre a real placement for this child -- their passport sections and stays. It never
              includes anything clinical from the clinic that generated this code.
            </p>

            {commitError && (
              <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
                {commitError}
              </p>
            )}

            <Button type="button" onClick={handleConfirm} disabled={isCommitting} className="mt-6 lg:w-auto">
              {isCommitting ? "Linking…" : `Link ${peeked.childName}`}
            </Button>
            <button
              type="button"
              onClick={() => {
                setPeeked(null);
                setCode("");
                setCommitError(null);
              }}
              className="mt-2 block w-full lg:inline-block lg:w-auto rounded-2xl border border-black/10 px-6 py-3 text-center text-sm font-semibold text-black/60"
            >
              Not this child? Try a different code
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-brand-neutral-black/70">
              Ask the clinic for the link code they&apos;ve generated for this child. This connects your centre to a
              record that already exists elsewhere -- it never creates a new one.
            </p>

            <label className="mt-6 block text-sm font-semibold text-brand-neutral-black" htmlFor="centre-link-code">
              Link code
            </label>
            <input
              id="centre-link-code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. SAM-1234"
              className="mt-1.5 w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
            />

            {peekError && (
              <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
                {peekError}
              </p>
            )}

            <Button type="button" onClick={handlePeek} disabled={!code.trim() || isPeeking} className="mt-6 lg:w-auto">
              {isPeeking ? "Looking up…" : "Look Up Code"}
            </Button>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
