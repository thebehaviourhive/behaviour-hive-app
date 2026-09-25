"use client";

import { useState } from "react";
import { ConsentScreenShell, ConsentTick } from "@/components/consent/ConsentScreenShell";
import type { InstitutionType } from "@/lib/institutionType";

// The parent's screen is genuine consent, not agreement -- one tick, a
// real decision about their own contributions and who sees them. The
// school-branch copy below is final, signed off, reproduced verbatim --
// do not rewrite, shorten, or improve it.
//
// Tier 1 item 4, 21 Sept 2026 -- this was the FIRST thing a clinic
// parent read, and it described a school that does not exist for them:
// "your child's school creates and keeps their record", "the people
// supporting them AT SCHOOL", "the school records about incidents AT
// SCHOOL", "your school's own retention policy" -- Daniel's own
// framing, not a label mismatch but an accuracy problem about what
// they were actually consenting to. A clinic has no incident-log
// module at all (Tier 1 item 5 guards it as school-only) -- the clinic
// branch below describes what genuinely happens instead: a clinician's
// own clinical record, and their own clinical team deciding what's
// relevant to share more widely (CLAUDE.md's own "home logs reach the
// classroom by design, via the clinician" principle, restated here for
// a clinic's own equivalent -- via the clinician, not automatically).
//
// The centre_manager dashboard build's own ternary sweep, 25 Sept
// 2026 -- `isClinic = institutionType === "clinic"` is the same trap
// this file already fixed once: it silently gives a respite-only
// parent the SCHOOL branch ("your child's school creates and keeps
// their record"), the identical class of false claim Tier 1 item 4
// closed for a clinic-only parent. A respite centre keeps a real
// placement record too, but it is neither a school record nor a
// clinical one -- its own branch below says what's actually true:
// the centre keeps the placement record, home entries reach the staff
// caring for the child during a stay, and nothing here claims a
// "clinical team" or a "classroom" that doesn't exist for this family.
export function ParentConsentScreen({
  onContinue,
  isSubmitting,
  error,
  onOpenPrivacy,
  institutionType,
}: {
  onContinue: () => void;
  isSubmitting: boolean;
  error: string | null;
  onOpenPrivacy: () => void;
  institutionType: InstitutionType;
}) {
  const [agreed, setAgreed] = useState(false);
  const isClinic = institutionType === "clinic";
  const isRespite = institutionType === "respite_centre";

  return (
    <ConsentScreenShell
      onContinue={onContinue}
      continueDisabled={!agreed}
      isSubmitting={isSubmitting}
      error={error}
      onOpenPrivacy={onOpenPrivacy}
      lede={
        isClinic
          ? "Your child's clinic creates and keeps their clinical record. You can add what you know from home, and you choose what you share."
          : isRespite
            ? "Your child's respite centre keeps a record of their stays there. You can add what you know from home, and you choose what you share."
            : "Your child's school creates and keeps their record. You can add what you know from home, and you choose what you share."
      }
      body={
        isClinic
          ? [
              "What you add - how your child slept, what works at home, what to watch for - goes to the practitioners supporting them at your clinic. Their clinical team decides what's relevant to share more widely, and your own home entries always stay yours to see.",
              "Anything you write is kept in line with your clinic's own retention policy.",
            ]
          : isRespite
            ? [
                "What you add - how your child slept, what works at home, what to watch for - goes to the staff caring for them during a stay at the centre. Your own home entries always stay yours to see.",
                "Anything you write is kept in line with the centre's own retention policy.",
              ]
            : [
                "What you add - how your child slept, what works at home, what to watch for - goes to the people supporting them at school. What the school records about incidents at school is their own record, kept under their own obligations, and stays with them.",
                "Anything you write is kept in line with your school's own retention policy.",
              ]
      }
      ticks={
        <ConsentTick id="parent-consent" checked={agreed} onChange={setAgreed}>
          {isClinic
            ? "I understand what this is, and I agree to share what I add here with my child's clinic and any clinician I connect."
            : isRespite
              ? "I understand what this is, and I agree to share what I add here with my child's respite centre and any clinician I connect."
              : "I understand what this is, and I agree to share what I add here with my child's school and any clinician I connect."}
        </ConsentTick>
      }
    />
  );
}
