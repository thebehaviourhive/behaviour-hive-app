"use client";

import { useState } from "react";
import { ConsentScreenShell, ConsentTick, ConsentEmphasis } from "@/components/consent/ConsentScreenShell";

// Principal's own screen -- not a variant of teacher's. Copy below is
// final, signed off, reproduced verbatim -- do not rewrite, shorten,
// or improve it.
export function PrincipalAgreementScreen({
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
      // The general footer wording ("speak to your principal") doesn't
      // hold for the principal's own screen -- there's no one above
      // them in the school to escalate to. Behaviour Hive is the real,
      // honest equivalent contact for this one role.
      footerNote="If you do not agree, close the app and contact Behaviour Hive."
      lede="You can see every child enrolled at your school and everything recorded about them, and you decide who else can."
      body={[
        <>
          <ConsentEmphasis>Countersigning an incident closes it permanently.</ConsentEmphasis>{" "}
          You are confirming the process was followed, not that you agree with every word - if you disagree, add
          an amendment. Records are kept in line with your school&apos;s own retention policy.
        </>,
      ]}
      ticks={
        <>
          <ConsentTick id="principal-use" checked={useTick} onChange={setUseTick}>
            I will use this only for children at my school, and only for their support and safeguarding.
          </ConsentTick>
          <ConsentTick id="principal-confidentiality" checked={confidentialityTick} onChange={setConfidentialityTick}>
            I will keep what I read here confidential, and share it only with people who need it.
          </ConsentTick>
          <ConsentTick id="principal-account" checked={accountTick} onChange={setAccountTick}>
            This account is mine. I will not share my login, and I will sign out on shared devices.
          </ConsentTick>
        </>
      }
    />
  );
}
