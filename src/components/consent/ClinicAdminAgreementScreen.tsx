"use client";

import { useState } from "react";
import { ConsentScreenShell, ConsentTick, ConsentEmphasis } from "@/components/consent/ConsentScreenShell";

// Clinic admin's own screen -- genuinely new, PRD 5 Stage 2. Not a
// variant of any other role's: admin is the one role with "no
// clinical content" at all (PRD section 5), "broad access to little"
// rather than any other role's "deep access to few" -- a different
// kind of screen from every other role's, not just different words.
// Copy below is Daniel's own final, approved wording, reproduced
// verbatim after two corrections during review: the em dash removed
// from the lede (this codebase's own established house style is a
// plain hyphen construction, never an em dash -- the five earlier
// screens already do this consistently); and the same fix applied to
// the body's own em-dash parenthetical, found in the same pass and
// flagged rather than left, since the rule clearly generalised beyond
// the one instance named. No institutionType branching -- this role
// only ever exists at a clinic.
export function ClinicAdminAgreementScreen({
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
  const [useTick, setUseTick] = useState(false);
  const [confidentialityTick, setConfidentialityTick] = useState(false);
  const [accountTick, setAccountTick] = useState(false);
  const allTicked = useTick && confidentialityTick && accountTick;

  return (
    <ConsentScreenShell
      onContinue={onContinue}
      continueDisabled={!allTicked}
      isSubmitting={isSubmitting}
      error={error}
      onOpenPrivacy={onOpenPrivacy}
      footerNote="If you do not agree, close the app and speak to your clinical director."
      lede="You will manage client onboarding, records, and data-sharing requests for the clinic. You will not see clinical notes or assessments."
      body={[
        <>
          <ConsentEmphasis>You do not see clinical content.</ConsentEmphasis>{" "}
          What you set at onboarding, such as funding and location, can be changed later, but only as a request
          someone else approves.
        </>,
      ]}
      ticks={
        <>
          <ConsentTick id="clinic-admin-use" checked={useTick} onChange={setUseTick}>
            I will use this only for administrative and onboarding tasks, not clinical content.
          </ConsentTick>
          <ConsentTick id="clinic-admin-confidentiality" checked={confidentialityTick} onChange={setConfidentialityTick}>
            I will keep what I read here confidential, and share it only with people who need it.
          </ConsentTick>
          <ConsentTick id="clinic-admin-account" checked={accountTick} onChange={setAccountTick}>
            This account is mine. I will not share my login, and I will sign out on shared devices.
          </ConsentTick>
        </>
      }
    />
  );
}
