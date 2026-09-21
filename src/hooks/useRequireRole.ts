"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { getPostAuthRedirect } from "@/lib/roleRedirect";
import { hasConsented } from "@/lib/hasConsented";

interface UseRequireRoleOptions {
  // Named for what it grants, not what it skips -- a page passing this
  // is declaring "I am part of onboarding itself, reachable before
  // consent is recorded", not quietly opting out of a check. Onboarding
  // restructure, Sept 2026: only /clinician/specialty passes this
  // (picking a specialty is now the clinician's own "joining" moment,
  // gated BEFORE consent, matching institution-code entry for staff).
  // Every other call site -- every dashboard, every deeper page,
  // /teacher/join-institution, /clinician/verify, /passport/welcome,
  // /passport/claim -- omits it and keeps the full gate. If you're
  // adding a second call site here, that's the one thing to get right:
  // this must never reach a page an unconsented user shouldn't see.
  allowBeforeConsent?: boolean;
  // Director/lead clinical work, 21 Sept 2026. Named the same way --
  // for what it grants. A clinic director or lead has no verified
  // clinicians row until AFTER they've visited /clinician/specialty
  // (select_director_specialty(), 0266) -- if this page required the
  // fully-verified admission (see below) like every other clinician
  // page, a bootstrap director could never reach the one screen that
  // creates the row in the first place. Only /clinician/specialty
  // passes this; every other clinician page keeps the full, verified-
  // row-required check. The condition here checks institution type
  // ONLY (no verified row exists yet by definition) -- a raw client
  // query, safe because it only ever reads the CALLER'S OWN
  // institution_staff row (self-scoped RLS, 0009) and institutions'
  // own `using (true)` read policy, never another institution's data.
  allowUnverifiedClinicLeadership?: boolean;
}

export function useRequireRole(role: string | string[], options?: UseRequireRoleOptions) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isReady, setIsReady] = useState(false);
  const allowBeforeConsent = options?.allowBeforeConsent ?? false;
  const allowUnverifiedClinicLeadership = options?.allowUnverifiedClinicLeadership ?? false;

  // A caller passing an inline array literal (e.g. useRequireRole(["class_teacher", "sna"]))
  // gets a new array reference every render -- using that directly as a dependency
  // would re-fire this effect (and its network calls) every render, forever.
  // Joining to a string gives a value that's stable across renders as long as the
  // actual allowed roles don't change, which is all the effect needs to depend on.
  const allowedRoles = Array.isArray(role) ? role : [role];
  const roleKey = allowedRoles.join(",");

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
      const requestedRoles = roleKey.split(",");
      let admitted = Boolean(userRole && requestedRoles.includes(userRole));

      // THE FBA REMAINS UNTOUCHED. STANDING. A director or lead reaches
      // clinical work by this gate answering differently for them --
      // never by any clinician-track file (FBA included) changing what
      // it asks for. Both branches below fire ONLY when the ordinary
      // membership check above has already failed AND the page asked
      // for "clinician" specifically -- zero added query for every
      // other role check in this app, and zero added query for an
      // ordinary clinician (already admitted above).
      if (!admitted && userRole && ["principal", "clinical_lead"].includes(userRole) && requestedRoles.includes("clinician")) {
        if (allowUnverifiedClinicLeadership) {
          // The bootstrap case (/clinician/specialty only) -- no
          // verified clinicians row can exist yet by definition, so this
          // checks institution type alone: is this caller CURRENTLY an
          // active principal/clinical_lead at a clinic. A raw client
          // read of the caller's own institution_staff row (self-scoped
          // RLS) joined to institutions (open read) -- never another
          // institution's data, never another user's row.
          const { data: staffRows } = await supabase
            .from("institution_staff")
            .select("role, institutions(type)")
            .eq("user_id", user.id)
            .is("deactivated_at", null)
            .not("approved_at", "is", null);
          admitted = (staffRows ?? []).some((row) => {
            const institution = row.institutions as unknown as { type: string } | { type: string }[] | null;
            const type = Array.isArray(institution) ? institution[0]?.type : institution?.type;
            return ["principal", "clinical_lead"].includes(row.role) && type === "clinic";
          });
        } else {
          // Every other clinician page: the full, two-independent-
          // layers check (0266) -- institution type = clinic AND a
          // genuinely verified clinicians row, checked together,
          // server-side, in one call. See is_verified_clinic_director_
          // or_lead()'s own header for why both layers are required
          // rather than trusting the clinicians row alone.
          const { data: isVerifiedLeadership } = await supabase.rpc("is_verified_clinic_director_or_lead");
          admitted = Boolean(isVerifiedLeadership);
        }
      }

      if (!admitted) {
        router.replace(getPostAuthRedirect(userRole));
        return;
      }

      // CRITICAL BUG fix: role alone was being treated as "onboarded" by
      // every page that gates on it -- nothing here previously verified
      // consent had actually been confirmed, which is what let a user
      // reach any role-gated page (via any path: a stray Back button, a
      // deep link, a force-quit reopen) without ever ticking the consent
      // checkbox. This is the one gate every role-protected page in the
      // app already goes through, so fixing it here closes every path at
      // once rather than just the one where the bug was first found.
      //
      // allowBeforeConsent is the one deliberate exception to that --
      // see the option's own doc comment above for exactly which page
      // uses it and why.
      if (!allowBeforeConsent) {
        const consented = await hasConsented(supabase, user.id);
        if (!isMounted) return;
        if (!consented) {
          router.replace("/consent");
          return;
        }
      }

      setUser(user);
      setIsReady(true);
    }

    checkAccess();
    return () => {
      isMounted = false;
    };
  }, [router, roleKey, allowBeforeConsent, allowUnverifiedClinicLeadership]);

  return { user, isReady };
}
