"use client";

import { useState } from "react";
import { ConsentScreenShell, ConsentTick } from "@/components/consent/ConsentScreenShell";

// The parent's screen is genuine consent, not agreement -- one tick, a
// real decision about their own contributions and who sees them. Copy
// below is final, signed off, reproduced verbatim -- do not rewrite,
// shorten, or improve it.
export function ParentConsentScreen({
  onContinue,
  isSubmitting,
  error,
  onOpenPrivacy,
}: {
  onContinue: () => void;
  isSubmitting: boolean;
  error: string | null;
  onOpenPrivacy: () => void;
}) {
  const [agreed, setAgreed] = useState(false);

  return (
    <ConsentScreenShell
      onContinue={onContinue}
      continueDisabled={!agreed}
      isSubmitting={isSubmitting}
      error={error}
      onOpenPrivacy={onOpenPrivacy}
      lede="Your child's school creates and keeps their record. You can add what you know from home, and you choose what you share."
      body={[
        "What you add - how your child slept, what works at home, what to watch for - goes to the people supporting them at school. What the school records about incidents at school is their own record, kept under their own obligations, and stays with them.",
        "Anything you write is kept in line with your school's own retention policy.",
      ]}
      ticks={
        <ConsentTick id="parent-consent" checked={agreed} onChange={setAgreed}>
          I understand what this is, and I agree to share what I add here with my child&apos;s school and any
          clinician I connect.
        </ConsentTick>
      }
    />
  );
}
