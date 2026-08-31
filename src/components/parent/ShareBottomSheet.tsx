"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { createClient } from "@/lib/supabase/client";
import { generateUniquePassportCode } from "@/lib/generatePassportCode";
import { logActivity } from "@/lib/logActivity";

// PRD 3, Stage 2 -- handleApprove() (a parent approving a school by
// code, raw client write to passport_institution_links.approved_by_
// parent) and its own entry point (the "Enter your school's institution
// code" input + "Approve school access" button) are removed. The school
// connects itself to a child now (create_school_passport() at creation,
// or a claim code the school issues) -- there is no longer a parent-
// side "approve a school" step to trigger. The outbound passport-code
// section above and handleConnectClinician() below are both unrelated
// to approved_by_parent and are untouched.
export function ShareBottomSheet({
  isOpen,
  onClose,
  passportId,
  childName,
  passportCode,
  focusClinicianCode = false,
  onCodeGenerated,
  onClinicianConnected,
}: {
  isOpen: boolean;
  onClose: () => void;
  passportId: string;
  childName: string;
  passportCode: string | null;
  // Set when this sheet was opened via the Clinical Support card's
  // "Link your clinician" deep-link (?openShare=1) -- scrolls/focuses the
  // clinician-code input so it's immediately visible, rather than landing
  // on the school-code section above it.
  focusClinicianCode?: boolean;
  onCodeGenerated: (code: string) => void;
  onClinicianConnected: () => void;
}) {
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [codeGenerationError, setCodeGenerationError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const hasStartedGenerating = useRef(false);

  // Tracks real unmount only (empty deps) — deliberately separate from any
  // per-effect "isMounted" flag. generateCode() calls onCodeGenerated(),
  // which changes passportCode in the parent, which is one of the values
  // that used to sit in this effect's own dependency array — so the effect
  // would tear itself down and reset a same-named isMounted flag before
  // generateCode()'s own finally block could run, permanently stranding
  // isGeneratingCode at true even though the code had already been saved.
  // Gating on real unmount instead means the effect can be re-triggered by
  // its own success (or any other dependency churn) without that ever
  // discarding the in-flight result.
  const isUnmountedRef = useRef(false);
  useEffect(() => {
    // The reset-on-mount matters, not just the cleanup: dev-mode double-
    // invokes every effect once (mount -> cleanup -> mount) to check
    // exactly this kind of resilience. Without resetting to false here,
    // that synthetic first cleanup would leave the ref stuck at true for
    // the component's entire real lifetime, silently reintroducing the
    // exact "never resets loading state" bug this ref exists to prevent.
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
    };
  }, []);

  const [clinicianCodeInput, setClinicianCodeInput] = useState("");
  const [isConnectingClinician, setIsConnectingClinician] = useState(false);
  const [clinicianError, setClinicianError] = useState<string | null>(null);
  const [clinicianSuccess, setClinicianSuccess] = useState<string | null>(null);
  const clinicianCodeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      hasStartedGenerating.current = false;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !focusClinicianCode) return;
    // Deferred a tick so the sheet has finished its own open animation/
    // mount before scrolling within it.
    const timer = setTimeout(() => {
      clinicianCodeInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      clinicianCodeInputRef.current?.focus();
    }, 150);
    return () => clearTimeout(timer);
  }, [isOpen, focusClinicianCode]);

  const generateCode = useCallback(async () => {
    setIsGeneratingCode(true);
    setCodeGenerationError(null);
    const supabase = createClient();
    try {
      const code = await generateUniquePassportCode(supabase, childName);
      const { error } = await supabase
        .from("passports")
        .update({ passport_code: code })
        .eq("id", passportId);

      if (error) {
        throw new Error(error.message);
      }

      if (isUnmountedRef.current) return;
      onCodeGenerated(code);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        logActivity({
          passportId,
          actorId: user.id,
          eventType: "passport_shared",
          eventDescription: "Passport code generated",
        });
      }
    } catch (e) {
      if (!isUnmountedRef.current) {
        setCodeGenerationError(
          e instanceof Error ? e.message : "Something went wrong generating the code."
        );
      }
    } finally {
      if (!isUnmountedRef.current) setIsGeneratingCode(false);
    }
  }, [childName, passportId, onCodeGenerated]);

  useEffect(() => {
    // hasStartedGenerating (a ref, not state) guards against double-firing
    // this auto-trigger — generateCode's own success changes passportCode,
    // which is a dependency here, so this effect legitimately re-runs after
    // a successful generation. That's fine: the guard just means it does
    // nothing on that re-run rather than starting a second generation.
    if (!isOpen || passportCode || hasStartedGenerating.current) return;
    hasStartedGenerating.current = true;
    generateCode();
  }, [isOpen, passportCode, generateCode]);

  function handleRetryGeneration() {
    generateCode();
  }

  function handleCopy() {
    if (!passportCode) return;
    navigator.clipboard.writeText(passportCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleClose() {
    setClinicianCodeInput("");
    setClinicianError(null);
    setClinicianSuccess(null);
    onClose();
  }

  async function handleConnectClinician() {
    if (!clinicianCodeInput.trim()) return;

    setClinicianError(null);
    setClinicianSuccess(null);
    setIsConnectingClinician(true);

    const supabase = createClient();
    const { data: clinicianRows, error: lookupError } = await supabase.rpc(
      "lookup_clinician_by_code",
      { code: clinicianCodeInput.trim() }
    );

    if (lookupError) {
      setIsConnectingClinician(false);
      setClinicianError(lookupError.message);
      return;
    }

    const clinician = clinicianRows?.[0] ?? null;

    if (!clinician) {
      setIsConnectingClinician(false);
      setClinicianError(
        "We couldn't find a clinician with that code. Please check with them and try again."
      );
      return;
    }

    // connect_clinician() (0123) -- the real write path, converted from
    // this file's own raw insert/update. Handles the existing-row/
    // reactivate/already-active branching internally now, stamps
    // engaged_by='parent', and refuses with a clear explanation (not a
    // bare constraint error) if this clinician is already engaged
    // through the child's school instead.
    const { error: saveError } = await supabase.rpc("connect_clinician", {
      p_passport_id: passportId,
      p_clinician_code: clinicianCodeInput.trim(),
    });

    setIsConnectingClinician(false);

    if (saveError) {
      setClinicianError(saveError.message);
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      logActivity({
        passportId,
        actorId: user.id,
        eventType: "team_linked",
        eventDescription: `${clinician.full_name ?? "A clinician"} linked to passport`,
      });
    }

    setClinicianCodeInput("");
    setClinicianSuccess(`${clinician.full_name ?? "The clinician"} has been connected to ${childName}'s passport.`);
    onClinicianConnected();
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={handleClose}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">
        Share {childName}&apos;s Passport
      </h2>
      {/* Comprehension-check copy (opening lines only, no flow changes):
          a first-time parent's most common confusion is which direction
          each code goes. Two sentences, one per concept, stated plainly
          before either code section so it's read before either one. */}
      <p className="mt-2 text-sm leading-relaxed text-brand-neutral-black/70">
        Your child&apos;s passport code is the one you{" "}
        <strong className="font-semibold text-brand-neutral-black">give</strong>{" "}
        out — share it with a teacher and they&apos;ll enter it to connect. A clinician&apos;s
        code works the other way:{" "}
        <strong className="font-semibold text-brand-neutral-black">enter</strong>{" "}
        theirs below to connect them.
      </p>

      <p className="mt-4 text-sm font-semibold text-brand-neutral-black">
        Your child&apos;s passport code
      </p>
      <div className="mt-1.5 flex items-center justify-between gap-3 rounded-2xl border border-dashed border-brand-golden-brown/40 bg-brand-safe-ivory/30 px-5 py-4">
        {passportCode ? (
          // passportCode is the one authoritative source of truth here — if
          // it's set, a code genuinely exists, full stop, regardless of what
          // isGeneratingCode currently thinks. This ordering is itself the
          // fix for the "stuck on Generating…" class of bug: no combination
          // of stale flags can hide a code that has actually arrived.
          <span className="font-heading text-2xl font-bold tracking-widest text-brand-neutral-black">
            {passportCode}
          </span>
        ) : codeGenerationError ? (
          <div className="flex flex-col items-start gap-1">
            <span className="text-sm font-medium text-red-600">{codeGenerationError}</span>
            <button
              type="button"
              onClick={handleRetryGeneration}
              className="text-xs font-bold text-brand-prussian-blue underline"
            >
              Try again
            </button>
          </div>
        ) : (
          <span className="font-heading text-lg text-black/40">
            {isGeneratingCode ? "Generating…" : "Waiting to generate…"}
          </span>
        )}
        <button
          type="button"
          onClick={handleCopy}
          disabled={!passportCode}
          className="flex-shrink-0 rounded-full bg-brand-golden-brown px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
        >
          {copied ? "Copied!" : "Copy Code"}
        </button>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-black/50">
        Share this code with your child&apos;s class teacher. They will enter
        it in the app to access {childName}&apos;s classroom profile.
      </p>

      <div className="my-5 border-t border-black/5" />

      <p className="text-sm font-semibold text-brand-neutral-black">
        Enter your clinician&apos;s code
      </p>
      <input
        ref={clinicianCodeInputRef}
        type="text"
        value={clinicianCodeInput}
        onChange={(e) => setClinicianCodeInput(e.target.value)}
        placeholder="e.g. CL-4821"
        className="mt-1.5 w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base uppercase tracking-widest text-brand-neutral-black placeholder:normal-case placeholder:tracking-normal placeholder:text-black/30 focus:border-brand-golden-brown focus:outline-none focus:ring-2 focus:ring-brand-golden-brown/30"
      />

      {clinicianError && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-600">
          {clinicianError}
        </p>
      )}
      {clinicianSuccess && (
        <p className="mt-3 rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
          {clinicianSuccess}
        </p>
      )}

      <button
        type="button"
        onClick={handleConnectClinician}
        disabled={!clinicianCodeInput.trim() || isConnectingClinician}
        className="mt-4 w-full rounded-2xl bg-brand-golden-brown py-3.5 text-base font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isConnectingClinician ? "Connecting…" : "Connect clinician"}
      </button>
    </BottomSheet>
  );
}
