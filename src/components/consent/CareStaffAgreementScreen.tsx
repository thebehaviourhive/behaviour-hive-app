"use client";

import { useState } from "react";
import { ConsentScreenShell, ConsentTick, ConsentEmphasis } from "@/components/consent/ConsentScreenShell";

// Care staff's own screen -- genuinely new, PRD 11 Stage 2. Close in
// substance to SNA (hands-on, per-child, ABC logs including physical
// intervention), reproduced as its own screen rather than a variant of
// it, matching this codebase's own established convention that every
// role owns its own copy in full. No institutionType branching -- this
// role only ever exists at a respite centre.
//
// The handover half of the emphasis line is section 6's own load-
// bearing point, not invented here: "the acknowledgement is the point
// -- it is the record of who knew what." Stage 2 doesn't build
// activation or handover yet (Stage 3+), but this screen describes the
// real shape of the role truthfully, the same posture every other
// screen in this file already takes.
export function CareStaffAgreementScreen({
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
      footerNote="If you do not agree, close the app and speak to your centre manager."
      lede="You will see a child's record only while they're on site with you. You record what happens during a stay - ABC logs, including any use of physical intervention - and you write and read the handover between shifts."
      body={[
        <>
          <ConsentEmphasis>Acknowledging a handover is the record of who knew what.</ConsentEmphasis>{" "}
          What you write becomes a permanent record, and your name stays on it. Records are kept in line
          with the centre&apos;s own retention policy.
        </>,
      ]}
      ticks={
        <>
          <ConsentTick id="care-staff-use" checked={useTick} onChange={setUseTick}>
            I will use this only for children who are on site with me, and only for their care.
          </ConsentTick>
          <ConsentTick id="care-staff-confidentiality" checked={confidentialityTick} onChange={setConfidentialityTick}>
            I will keep what I read here confidential, and share it only with people who need it to support
            the child.
          </ConsentTick>
          <ConsentTick id="care-staff-account" checked={accountTick} onChange={setAccountTick}>
            This account is mine. I will not share my login, and I will sign out on shared devices.
          </ConsentTick>
        </>
      }
    />
  );
}
