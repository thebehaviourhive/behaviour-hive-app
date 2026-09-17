"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { hasConsented } from "@/lib/hasConsented";
import { hasJoined } from "@/lib/hasJoined";
import { getPostAuthRedirect } from "@/lib/roleRedirect";
import { CURRENT_CONSENT_VERSION } from "@/lib/consentVersion";
import { ParentConsentScreen } from "@/components/consent/ParentConsentScreen";
import { TeacherAgreementScreen } from "@/components/consent/TeacherAgreementScreen";
import { SnaAgreementScreen } from "@/components/consent/SnaAgreementScreen";
import { PrincipalAgreementScreen } from "@/components/consent/PrincipalAgreementScreen";
import { ClinicianAgreementScreen } from "@/components/consent/ClinicianAgreementScreen";
import { ClinicalLeadAgreementScreen } from "@/components/consent/ClinicalLeadAgreementScreen";
import { ClinicAdminAgreementScreen } from "@/components/consent/ClinicAdminAgreementScreen";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { PrivacyPolicyContent } from "@/components/PrivacyPolicyContent";
import { Button } from "@/components/ui/Button";
import type { InstitutionType } from "@/lib/institutionType";

// Consent/agreement screens rebuild. This page owns auth/routing/
// submission only -- no copy, no per-role card/label lookup tables
// (that was the old screen's own shape; deliberately not rebuilding
// it). Each role renders its own screen component, each of which
// hardcodes its own final copy -- "same visual shape, different
// verbs," never one component that takes a role prop and swaps text.
// PRD 5 Stage 2: two of those components (clinician, principal) now
// take an institutionType prop too and pick their own school/clinic
// variant internally -- still no shared lookup table, each screen
// still owns its own copy in full, for both variants.

type ConsentRole = "parent" | "class_teacher" | "clinician" | "sna" | "principal" | "clinical_lead" | "clinic_admin";

export default function ConsentPage() {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<ConsentRole | null>(null);
  // Resolved from whichever institution_staff row this user actually
  // has, if any -- the record, not the viewer (RoleLabel's own rule,
  // Stage 1). An independent/manually-verified clinician with no
  // institution_staff row at all has no clinic to resolve and falls
  // back to 'school' -- the same copy that's been live and approved
  // for that path all along.
  const [institutionType, setInstitutionType] = useState<InstitutionType>("school");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPrivacyOpen, setIsPrivacyOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function checkAccess() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!isMounted) return;

      if (!user) {
        router.replace("/login");
        return;
      }

      const userRole = user.app_metadata?.role;
      if (
        userRole !== "parent" &&
        userRole !== "clinician" &&
        userRole !== "class_teacher" &&
        userRole !== "sna" &&
        userRole !== "principal" &&
        userRole !== "clinical_lead" &&
        userRole !== "clinic_admin"
      ) {
        router.replace("/");
        return;
      }

      // Onboarding restructure, Sept 2026: consent now sits AFTER
      // joining, not before -- so this page's own precondition is the
      // NEW thing to check, not just role. A role-holder who hasn't
      // entered a code yet (staff) or picked a specialty yet
      // (clinician) shouldn't be shown consent copy about an
      // organisation they haven't actually joined; send them back to
      // finish that first. Parents have no joining precondition, same
      // as before this change. clinical_lead/clinic_admin always join
      // by institution code (PRD 5 Stage 2) -- no specialty-picker
      // equivalent exists for either, so both fall to /role-select,
      // same as class_teacher/sna/principal already do.
      if (!(await hasJoined(supabase, user.id, userRole))) {
        if (!isMounted) return;
        router.replace(userRole === "clinician" ? "/clinician/specialty" : "/role-select");
        return;
      }

      // PRD 5 Stage 2: institutionType is resolved from whichever
      // institution_staff row this user actually has -- the record,
      // not the viewer (RoleLabel's own rule, Stage 1). hasJoined()
      // just confirmed one of two things is true for 'clinician': an
      // institution_staff row (clinic path) or a clinicians.specialty
      // (independent/manually-verified path, no institution at all).
      // Only the first gives an institution to resolve a type from;
      // the second correctly falls through to the 'school' default
      // already set above -- the same copy that path has always shown.
      const { data: staffRow } = await supabase
        .from("institution_staff")
        .select("institution_id, institutions(type)")
        .eq("user_id", user.id)
        .is("deactivated_at", null)
        .limit(1)
        .maybeSingle();
      if (!isMounted) return;
      const institutionRecord = staffRow?.institutions as unknown as { type: InstitutionType } | { type: InstitutionType }[] | null;
      const resolvedType = Array.isArray(institutionRecord) ? institutionRecord[0]?.type : institutionRecord?.type;
      if (resolvedType) setInstitutionType(resolvedType);

      // Someone who already has a CURRENT-version consents row (real
      // prior completion at the version now live, not a stale one)
      // shouldn't sit through the form again just because they landed
      // on this URL -- resume sends them straight to their REAL
      // dashboard now, not back to code-entry (getPostConsentDestination's
      // whole reason to exist -- routing PAST consent to code-entry --
      // is backwards now that code-entry precedes consent; removed).
      if (await hasConsented(supabase, user.id)) {
        if (!isMounted) return;
        router.replace(getPostAuthRedirect(userRole));
        return;
      }

      if (!isMounted) return;
      setUserId(user.id);
      setRole(userRole);
      setIsReady(true);
    }

    checkAccess();
    return () => {
      isMounted = false;
    };
  }, [router]);

  async function handleAccept() {
    if (!userId || !role) return;

    setError(null);
    setIsSubmitting(true);

    const supabase = createClient();
    const { error: insertError } = await supabase.from("consents").insert({
      user_id: userId,
      role,
      consent_version: CURRENT_CONSENT_VERSION,
      marketing_accepted: false,
    });

    setIsSubmitting(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    router.push(getPostAuthRedirect(role));
  }

  if (!isReady || !role) {
    return null;
  }

  const screenProps = {
    onContinue: handleAccept,
    isSubmitting,
    error,
    onOpenPrivacy: () => setIsPrivacyOpen(true),
  };

  let screen: React.ReactNode;
  switch (role) {
    case "parent":
      screen = <ParentConsentScreen {...screenProps} />;
      break;
    case "class_teacher":
      screen = <TeacherAgreementScreen {...screenProps} />;
      break;
    case "sna":
      screen = <SnaAgreementScreen {...screenProps} />;
      break;
    case "principal":
      screen = <PrincipalAgreementScreen {...screenProps} institutionType={institutionType} />;
      break;
    case "clinician":
      screen = <ClinicianAgreementScreen {...screenProps} institutionType={institutionType} />;
      break;
    case "clinical_lead":
      screen = <ClinicalLeadAgreementScreen {...screenProps} />;
      break;
    case "clinic_admin":
      screen = <ClinicAdminAgreementScreen {...screenProps} />;
      break;
  }

  return (
    <>
      {screen}

      {/* The privacy sheet opens OVER the consent screen rather than
          navigating to /privacy -- this screen's own React state (the
          ticked/unticked boxes) never unmounts, so there's nothing for
          a Back/dismiss action to skip past. Same pattern the old
          screen used, restored here (round 2) after being dropped in
          round 1 only because the layout brief was given literally. */}
      <BottomSheet isOpen={isPrivacyOpen} onClose={() => setIsPrivacyOpen(false)}>
        <h2 className="mb-4 font-heading text-xl font-semibold text-brand-neutral-black">Privacy Policy</h2>
        <PrivacyPolicyContent />
        <Button type="button" onClick={() => setIsPrivacyOpen(false)} className="mt-5">
          Close
        </Button>
      </BottomSheet>
    </>
  );
}
