"use client";

import { useState } from "react";
import { ConsentScreenShell, ConsentTick, ConsentEmphasis } from "@/components/consent/ConsentScreenShell";

// SNA's own screen -- not a variant of teacher's, even though the two
// are close in substance. Copy below is final, signed off, reproduced
// verbatim -- do not rewrite, shorten, or improve it.
export function SnaAgreementScreen({
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
      footerNote="If you do not agree, close the app and speak to your principal."
      lede="You will record what happens with the children you support - end-of-day updates, ABC logs, and incidents including any use of physical intervention."
      body={[
        <>
          <ConsentEmphasis>What you write becomes a permanent record, and your name stays on it.</ConsentEmphasis>{" "}
          When you are named on someone else&apos;s incident you may be asked to confirm their account is
          accurate - that is your own statement, and you can withdraw it. Records are kept in line with your
          school&apos;s own retention policy.
        </>,
      ]}
      ticks={
        <>
          <ConsentTick id="sna-use" checked={useTick} onChange={setUseTick}>
            I will use this only for the children I support, and only for their support and safeguarding.
          </ConsentTick>
          <ConsentTick id="sna-confidentiality" checked={confidentialityTick} onChange={setConfidentialityTick}>
            I will keep what I read here confidential, and share it only with people who need it to support the
            child.
          </ConsentTick>
          <ConsentTick id="sna-account" checked={accountTick} onChange={setAccountTick}>
            This account is mine. I will not share my login, and I will sign out on shared devices.
          </ConsentTick>
        </>
      }
    />
  );
}
