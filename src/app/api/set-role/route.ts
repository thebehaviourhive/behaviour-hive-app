import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const SELF_SERVICE_ROLES = ["parent", "class_teacher", "clinician", "sna", "principal"] as const;
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
