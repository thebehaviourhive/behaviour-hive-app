import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// "clinician" was deliberately dropped here Sept 2026 (the onboarding
// restructure's own model correction: no INDEPENDENT self-service
// clinician -- every clinician belongs to an organisation, joins by
// its code, same as class_teacher/sna/principal). That reasoning was
// right; this list was just never widened for the case it was
// describing. PRD 5 Stage 2 built exactly that organisation-code path
// for clinics (institution_staff.role in ('clinician', 'clinical_lead',
// 'clinic_admin', 'principal')), but SchoolStaffRoleSelectContent.tsx's
// own clinic role picker sat behind a placeholder screen until 21 Sept
// 2026, so nothing in the app's UI ever actually POSTed one of these
// three roles here -- the gap in this allow-list was invisible until
// the picker existed to hit it. The INDEPENDENT path (no institution
// code at all, role-select/no-code/page.tsx) still never sends
// "clinician" -- that correction stands unchanged; this widening only
// covers the code-gated, institution_staff-backed path, same posture
// as class_teacher/sna/principal always had.
// centre_manager/care_staff added, PRD 11 Stage 2, 24 Sept 2026 --
// found live, by the very first real signup attempt through the real
// respite role picker, exactly the shape this file's own comment above
// already warns about: a role-tile picker existing with no matching
// entry here fails at the LAST step, after institution lookup, role
// selection, and everything else already worked. Same lesson, same
// mistake, made a second time -- recorded here rather than only
// fixed, so a fourth institution type doesn't repeat it a third time.
const SELF_SERVICE_ROLES = [
  "parent",
  "class_teacher",
  "sna",
  "principal",
  "clinician",
  "clinical_lead",
  "clinic_admin",
  "centre_manager",
  "care_staff",
] as const;
type SelfServiceRole = (typeof SELF_SERVICE_ROLES)[number];

function isSelfServiceRole(value: unknown): value is SelfServiceRole {
  return (
    typeof value === "string" &&
    (SELF_SERVICE_ROLES as readonly string[]).includes(value)
  );
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
