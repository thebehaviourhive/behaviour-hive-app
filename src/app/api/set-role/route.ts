import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Role } from "@/lib/vocabulary";

// This allow-list has now missed a newly-added role TWICE -- once for
// "clinician" (PRD 5 Stage 2's own clinic role picker sat behind a
// placeholder for months, so nothing ever exercised the gap until the
// placeholder was removed), once for "centre_manager"/"care_staff" (PRD
// 11 Stage 2, found live by the very first real signup attempt through
// the real respite role picker -- everything else worked, this was the
// last step and it failed with a bare "Invalid role."). Both times the
// role-tile picker that POSTs here was built and working before this
// list was widened to match.
//
// Fixed as a class, not a third patch: SELF_SERVICE_ROLE is now built
// FROM vocabulary.ts's own Role type via a Record<Role | "parent",
// boolean> literal below, not a hand-typed array. TypeScript refuses to
// compile this file the moment vocabulary.ts's Role union grows and
// this literal doesn't have a matching key -- a build failure, not a
// scan step, and it fires on the SAME PR that adds the role, before
// anyone has to discover it live a third time. "parent" sits outside
// Role (that type is institution_staff_role_check's own vocabulary
// only) so it's added explicitly, not inferred.
//
// Every entry's value is a real decision, not a placeholder default:
// `false` on institution_admin because that role's own self-service
// onboarding is deliberately parked (CLAUDE.md's own "INSTITUTION
// CREATION BEING MANUAL IS DELIBERATE" entry) -- no join screen exists
// that could ever POST this role, and admitting it here would be a
// dead allowance, not a fix. Every other role has a real, working
// role-tile picker that needs it admitted.
const SELF_SERVICE_ROLE: Record<Role | "parent", boolean> = {
  parent: true,
  class_teacher: true,
  sna: true,
  principal: true,
  institution_admin: false,
  clinician: true,
  clinical_lead: true,
  clinic_admin: true,
  centre_manager: true,
  care_staff: true,
};

function isSelfServiceRole(value: unknown): value is Role | "parent" {
  return typeof value === "string" && Boolean(SELF_SERVICE_ROLE[value as Role | "parent"]);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const role = body?.role;

  if (!isSelfServiceRole(role)) {
    return NextResponse.json({ error: "Invalid role." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: { role },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
