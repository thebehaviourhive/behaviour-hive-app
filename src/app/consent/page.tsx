"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { hasConsented } from "@/lib/hasConsented";
import { CURRENT_CONSENT_VERSION } from "@/lib/consentVersion";
import { ParentConsentScreen } from "@/components/consent/ParentConsentScreen";
import { TeacherAgreementScreen } from "@/components/consent/TeacherAgreementScreen";
import { SnaAgreementScreen } from "@/components/consent/SnaAgreementScreen";
import { PrincipalAgreementScreen } from "@/components/consent/PrincipalAgreementScreen";
import { ClinicianAgreementScreen } from "@/components/consent/ClinicianAgreementScreen";

// Consent/agreement screens rebuild. This page owns auth/routing/
// submission only -- no copy, no per-role card/label lookup tables
// (that was the old screen's own shape; deliberately not rebuilding
// it). Each role renders its own screen component, each of which
// hardcodes its own final copy -- "same visual shape, different
// verbs," never one component that takes a role prop and swaps text.

type ConsentRole = "parent" | "class_teacher" | "clinician" | "sna" | "principal";

// Where accepting (or resuming with it already given) sends each role
// next -- unchanged from the previous screen's own routing.
function getPostConsentDestination(role: ConsentRole): string {
  if (role === "clinician") return "/clinician/specialty";
  if (role === "class_teacher" || role === "sna" || role === "principal") return "/teacher/join-institution";
  return "/parent-dashboard";
}

export default function ConsentPage() {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<ConsentRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
        userRole !== "principal"
      ) {
        router.replace("/");
        return;
      }

      // Someone who already has a CURRENT-version consents row (real
      // prior completion at the version now live, not a stale one)
      // shouldn't sit through the form again just because they landed
      // on this URL -- resume sends them straight to their next step.
      if (await hasConsented(supabase, user.id)) {
        if (!isMounted) return;
        router.replace(getPostConsentDestination(userRole));
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

    router.push(getPostConsentDestination(role));
  }

  if (!isReady || !role) {
    return null;
  }

  const screenProps = { onContinue: handleAccept, isSubmitting, error };

  switch (role) {
    case "parent":
      return <ParentConsentScreen {...screenProps} />;
    case "class_teacher":
      return <TeacherAgreementScreen {...screenProps} />;
    case "sna":
      return <SnaAgreementScreen {...screenProps} />;
    case "principal":
      return <PrincipalAgreementScreen {...screenProps} />;
    case "clinician":
      return <ClinicianAgreementScreen {...screenProps} />;
  }
}
