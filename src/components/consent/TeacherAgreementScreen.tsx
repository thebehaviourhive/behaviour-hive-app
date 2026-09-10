"use client";

import { useState } from "react";
import { ConsentScreenShell, ConsentTick } from "@/components/consent/ConsentScreenShell";

// Class teacher's own screen -- not a variant of any other role's.
// Copy below is final, signed off, reproduced verbatim -- do not
// rewrite, shorten, or improve it. Staff agree; they do not consent --
// a teacher cannot refuse their school's record-keeping and keep
// working, so this is three separate ticks about how they will behave,
// never a single "I consent" checkbox.
export function TeacherAgreementScreen({
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
          <ConsentTick id="teacher-use" checked={useTick} onChange={setUseTick}>
            I will use this only for the children I work with, and only for their support and safeguarding.
          </ConsentTick>
          <ConsentTick id="teacher-confidentiality" checked={confidentialityTick} onChange={setConfidentialityTick}>
            I will keep what I read here confidential, and share it only with people who need it to support the
            child.
          </ConsentTick>
          <ConsentTick id="teacher-account" checked={accountTick} onChange={setAccountTick}>
            This account is mine. I will not share my login, and I will sign out on shared devices.
          </ConsentTick>
        </>
      }
    >
      <p>
        You will record what happens with the children you work with - end-of-day updates, ABC logs, and
        incidents including any use of physical intervention.
      </p>
      <p>
        <strong className="font-semibold">What you write becomes a permanent record.</strong>{" "}
        Once you sign an incident off it cannot be edited, only added to, and your name stays on it. Records are
        kept in line with your school&apos;s own retention policy.
      </p>
    </ConsentScreenShell>
  );
}
