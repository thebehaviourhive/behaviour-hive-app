export function getPostAuthRedirect(role: string | null | undefined): string {
  switch (role) {
    case "parent":
      return "/parent-dashboard";
    case "class_teacher":
      return "/teacher-dashboard";
    case "clinician":
      return "/dashboard";
    default:
      return "/role-select";
  }
}
