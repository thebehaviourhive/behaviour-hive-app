"use client";

import { useState } from "react";
import { ConsentScreenShell, ConsentTick, ConsentEmphasis } from "@/components/consent/ConsentScreenShell";
import type { InstitutionType } from "@/lib/institutionType";

// Principal's own screen -- not a variant of teacher's. Copy below is
// final, signed off, reproduced verbatim -- do not rewrite, shorten,
// or improve it.
//
// PRD 5 Stage 2: found while drafting the two genuinely new screens,
// not asked for by name -- role = 'principal' is reused for clinical
// director, and this screen's own emphasis line ("Countersigning an
// incident closes it permanently") centres on a concept with no
// clinic equivalent at all. A real clinical director's first-ever
// consent screen would have opened on it. Daniel's own framing:
// finding this now, rather than a director hitting it live, was "the
// right catch." Deliberately did NOT invent a dramatic "this closes
// permanently" moment for the clinic branch to mirror the school
// version's shape -- manufacturing a parallel where none is decided
// would have been worse than its absence.
export function PrincipalAgreementScreen({
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
  const [useTick, setUseTick] = useState(false);
  const [confidentialityTick, setConfidentialityTick] = useState(false);
  const [accountTick, setAccountTick] = useState(false);
  const allTicked = useTick && confidentialityTick && accountTick;
  const isClinic = institutionType === "clinic";

  return (
    <ConsentScreenShell
      onContinue={onContinue}
      continueDisabled={!allTicked}
      isSubmitting={isSubmitting}
      error={error}
      onOpenPrivacy={onOpenPrivacy}
      // The general footer wording ("speak to your principal"/"your
      // clinical director") doesn't hold for THIS role's own screen
      // either way -- there's no one above a principal or a director
      // to escalate to. Behaviour Hive is the real, honest equivalent
      // contact for this one role, at both institution types.
      footerNote="If you do not agree, close the app and contact Behaviour Hive."
      lede={
        isClinic
          ? "You can see every client at your clinic and everything recorded about them, and you decide who else can."
          : "You can see every child enrolled at your school and everything recorded about them, and you decide who else can."
      }
      body={
        isClinic
          ? [
              <>
                <ConsentEmphasis>
                  You are accountable for who has access to every client record at your clinic.
                </ConsentEmphasis>{" "}
                Approving staff, assigning caseloads, and configuring how the team is organised are all your
                decisions to make and revisit. Records are kept in line with the clinic&apos;s own retention
                policy.
              </>,
            ]
          : [
              <>
                <ConsentEmphasis>Countersigning an incident closes it permanently.</ConsentEmphasis>{" "}
                You are confirming the process was followed, not that you agree with every word - if you
                disagree, add an amendment. Records are kept in line with your school&apos;s own retention
                policy.
              </>,
            ]
      }
      ticks={
        <>
          <ConsentTick id="principal-use" checked={useTick} onChange={setUseTick}>
            {isClinic
              ? "I will use this only for clients at my clinic, and only for their clinical care and its administration."
              : "I will use this only for children at my school, and only for their support and safeguarding."}
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
