"use client";

import { useState } from "react";
import { ConsentScreenShell, ConsentTick } from "@/components/consent/ConsentScreenShell";

// Clinician's own screen -- not a variant of any other role's. Copy
// below is final, signed off, reproduced verbatim -- do not rewrite,
// shorten, or improve it.
export function ClinicianAgreementScreen({
  onContinue,
  isSubmitting,
  error,
}: {
  onContinue: () => void;
  isSubmitting: boolean;
  error: string | null;
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
      footerNote="If you do not agree, close the app and speak to your principal."
      ticks={
        <>
          <ConsentTick id="clinician-use" checked={useTick} onChange={setUseTick}>
            I will use this only for the children on my caseload, and only for their clinical care.
          </ConsentTick>
          <ConsentTick id="clinician-confidentiality" checked={confidentialityTick} onChange={setConfidentialityTick}>
            I will keep what I read here confidential, including keeping families&apos; home records from school
            staff unless I publish them as clinical guidance.
          </ConsentTick>
          <ConsentTick id="clinician-account" checked={accountTick} onChange={setAccountTick}>
            This account is mine. I will not share my login, and I will sign out on shared devices.
          </ConsentTick>
        </>
      }
    >
      <p>You will see the full record for the children on your caseload, including what families share from home.</p>
      <p>
        <strong className="font-semibold">Home logs stay between you and the family. School staff never see them.</strong>{" "}
        What you publish as a strategy or assessment does reach the classroom - so publish the guidance, not the
        raw account. Records are kept in line with the school&apos;s own retention policy.
      </p>
    </ConsentScreenShell>
  );
}
