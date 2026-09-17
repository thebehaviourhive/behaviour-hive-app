import type { InstitutionType } from "@/lib/institutionType";
import { getRoleLabel, type VocabularyOverrides } from "@/lib/vocabulary";

// PRD 5 Stage 1. The JSX counterpart to getRoleLabel() -- most call
// sites render a label inline in markup, where a component reads more
// naturally than a bare function call. institutionType is required,
// not optional and not read from any implicit context: the correct
// vocabulary is a property of the RECORD being displayed (which
// institution owns this incident/staff row/passport), never of the
// viewer's own identity -- a principal has one obvious institution, a
// clinician with several engagements and a parent do not, so there is
// no session-wide "current institution" this component could safely
// assume. Every real caller already resolves institutionType from the
// specific record on screen (via useInstitutionType or
// usePassportInstitutionVocabulary) and passes it in explicitly --
// making it required means a call site with no institution context in
// hand fails to compile, rather than this component silently guessing.
interface RoleLabelProps {
  role: string;
  institutionType: InstitutionType;
  overrides?: VocabularyOverrides;
  className?: string;
}

export function RoleLabel({ role, institutionType, overrides, className }: RoleLabelProps) {
  const label = getRoleLabel(role, institutionType, overrides);
  return className ? <span className={className}>{label}</span> : <>{label}</>;
}
