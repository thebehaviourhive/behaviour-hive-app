"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { getChildFirstName } from "@/lib/childDisplayName";
import { EodWizardForChild } from "@/components/teacher/EodWizardForChild";

// Single-child EOD -- now a thin wrapper. The wizard itself (every
// step, the already-submitted-today guard, the success animation) is
// EodWizardForChild.tsx, shared with the new bulk flow at
// /teacher/eod/bulk. This route's own behaviour is unchanged: resolve
// the one child's name, then hand off. onMarkAbsent is deliberately
// omitted here -- "Absent" is scoped to the bulk walk-through only, see
// that route's own header comment for why.
export default function TeacherEodPage() {
  const router = useRouter();
  const params = useParams<{ passportId: string }>();
  const passportId = params.passportId;
  const { user, isReady } = useRequireRole("class_teacher");

  const [childName, setChildName] = useState("this child");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!passportId) return;
    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const { data: passport } = await supabase
        .from("passports")
        .select("child_name")
        .eq("id", passportId)
        .maybeSingle();

      if (!isMounted) return;
      setChildName(getChildFirstName(passport?.child_name));
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [passportId]);

  if (!isReady || !user || isLoading) {
    return null;
  }

  return (
    <EodWizardForChild
      key={passportId}
      passportId={passportId}
      teacherId={user.id}
      childName={childName}
      onDone={() => router.push("/teacher/dashboard")}
    />
  );
}
