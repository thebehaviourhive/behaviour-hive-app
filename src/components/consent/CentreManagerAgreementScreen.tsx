"use client";

import { useState } from "react";
import { ConsentScreenShell, ConsentTick, ConsentEmphasis } from "@/components/consent/ConsentScreenShell";

// Centre manager's own screen -- genuinely new, PRD 11 Stage 2 (no
// school or clinic role has this shape: several people share the
// authority a school's single principal or a clinic's single director
// holds alone -- institution_staff_one_principal_per_institution is
// exactly why centre_manager could never have reused either role).
// No institutionType branching -- this role only ever exists at a
// respite centre (Stage 2's own self-link policy), so there is no
// school/clinic variant to distinguish it from.
//
// "Countersigns", per Daniel's own answer during Stage 2 scoping,
// means finalising the post-stay report -- never the school incident-
// log RPCs, which stay untouched and out of reach for this role. The
// emphasis line below describes that truthfully, even though
// activation/stays/the post-stay report are Stage 3+ work, not yet
// built -- the same posture PRD 5 Stage 2's own Clinical Lead and
// Clinic Admin screens already took, describing the full shape of a
// role's data handling before every piece of it existed.
export function CentreManagerAgreementScreen({
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
      // Same reasoning as PrincipalAgreementScreen's own footer for
      // Clinical Director: there is no one above a centre manager to
      // escalate to within the app, so Behaviour Hive is the honest
      // real contact.
      footerNote="If you do not agree, close the app and contact Behaviour Hive."
      lede="You activate a child's record when they arrive for a stay, so your team can read it while they're on site. You countersign, and you finalise the report that goes to the family after they leave."
      body={[
        <>
          <ConsentEmphasis>Finalising the post-stay report closes your team&apos;s access to that child&apos;s record.</ConsentEmphasis>{" "}
          Between stays, staff cannot reach it at all -- a child may not have been here for weeks, and the
          record is often the only way to know who they are and what they need. Records are kept in line
          with the centre&apos;s own retention policy.
        </>,
      ]}
      ticks={
        <>
          <ConsentTick id="centre-manager-use" checked={useTick} onChange={setUseTick}>
            I will use this only for children who are on site at the centre, and only for their care.
          </ConsentTick>
          <ConsentTick id="centre-manager-confidentiality" checked={confidentialityTick} onChange={setConfidentialityTick}>
            I will keep what I read here confidential, and share it only with people who need it to support
            the child.
          </ConsentTick>
          <ConsentTick id="centre-manager-account" checked={accountTick} onChange={setAccountTick}>
            This account is mine. I will not share my login, and I will sign out on shared devices.
          </ConsentTick>
        </>
      }
    />
  );
}
