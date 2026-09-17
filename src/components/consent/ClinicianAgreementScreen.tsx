"use client";

import { useState } from "react";
import { ConsentScreenShell, ConsentTick, ConsentEmphasis } from "@/components/consent/ConsentScreenShell";
import type { InstitutionType } from "@/lib/institutionType";

// Clinician's own screen -- not a variant of any other role's. Copy
// below is final, signed off, reproduced verbatim -- do not rewrite,
// shorten, or improve it.
//
// PRD 5 Stage 2: two lines depend on institutionType -- the footer
// ("your principal" -> "your clinical director") and the retention-
// policy clause ("the school's" -> "the clinic's"). The "home logs"
// line is the one Daniel corrected directly, not a mechanical school
// -> clinic swap: "school staff" would have told a clinic user that
// schools use this product, breaking the onboarding restructure's own
// neutrality rule, and was also factually wrong for a clinic (the
// clinical director CAN read session notes, and by extension home
// logs -- a decided fact, not this screen's own guess). The approved
// wording states what DOES cross without naming who's on the other
// side, and holds for both institution types -- it is not itself
// branched.
export function ClinicianAgreementScreen({
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
      footerNote={
        isClinic
          ? "If you do not agree, close the app and speak to your clinical director."
          : "If you do not agree, close the app and speak to your principal."
      }
      lede="You will see the full record for the children on your caseload, including what families share from home."
      body={[
        <>
          <ConsentEmphasis>
            Home logs stay between you and the family. What you publish as clinical guidance may be shared with
            others supporting the child; the raw logs never are.
          </ConsentEmphasis>{" "}
          Records are kept in line with the {isClinic ? "clinic's" : "school's"} own retention policy.
        </>,
      ]}
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
    />
  );
}
