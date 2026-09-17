"use client";

import { useState } from "react";
import { ConsentScreenShell, ConsentTick, ConsentEmphasis } from "@/components/consent/ConsentScreenShell";

// Clinical lead's own screen -- genuinely new, PRD 5 Stage 2 (no
// school role has authority over a slice of an organisation, so no
// existing screen to reuse or branch from). Copy below is Daniel's
// own final, approved wording, reproduced verbatim after two
// corrections during review: "children" and "clients" no longer
// appear together in the same screen (clients throughout, since this
// is a clinic); and the lede now states caseload and scope as two
// separate, both-true facts rather than conflating them -- caseload
// is this person's own practitioner-level relationship to specific
// clients, the same as any practitioner has; scope is separate
// authority that can reach clients never on their personal caseload
// at all. No institutionType branching -- this role only ever exists
// at a clinic (PRD 5 Stage 2's own self-link policy), so there is no
// school variant to distinguish it from.
export function ClinicalLeadAgreementScreen({
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
      lede="You will see the full record for the clients on your own caseload, the same as any practitioner. Within your own scope, you can also reassign or discharge clients who are not on your caseload at all."
      body={[
        <>
          <ConsentEmphasis>Discharging a client closes their episode of care and ends your team&apos;s access.</ConsentEmphasis>{" "}
          The record stays and can still be read. Records are kept in line with the clinic&apos;s own retention
          policy.
        </>,
      ]}
      ticks={
        <>
          <ConsentTick id="clinical-lead-use" checked={useTick} onChange={setUseTick}>
            I will use this only for the clients on my caseload and within my own scope, and only for their
            clinical care and its administration.
          </ConsentTick>
          <ConsentTick id="clinical-lead-confidentiality" checked={confidentialityTick} onChange={setConfidentialityTick}>
            I will keep what I read here confidential, and share it only with people who need it to support the
            client.
          </ConsentTick>
          <ConsentTick id="clinical-lead-account" checked={accountTick} onChange={setAccountTick}>
            This account is mine. I will not share my login, and I will sign out on shared devices.
          </ConsentTick>
        </>
      }
    />
  );
}
