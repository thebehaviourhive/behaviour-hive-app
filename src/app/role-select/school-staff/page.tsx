import { Suspense } from "react";
import { SchoolStaffRoleSelectContent } from "./SchoolStaffRoleSelectContent";

export default function SchoolStaffRoleSelectPage() {
  return (
    <Suspense fallback={null}>
      <SchoolStaffRoleSelectContent />
    </Suspense>
  );
}
