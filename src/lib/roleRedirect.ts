export function getPostAuthRedirect(role: string | null | undefined): string {
  switch (role) {
    case "parent":
      return "/parent-dashboard";
    case "class_teacher":
      return "/teacher/dashboard";
    case "sna":
      return "/sna/passports";
    case "clinician":
      return "/clinician/dashboard";
    default:
      return "/role-select";
  }
}
