"use client";

import { useInstitutionType } from "@/hooks/useInstitutionType";
import { usePassportInstitutionVocabulary } from "@/hooks/usePassportInstitutionVocabulary";

// PRD 5 Stage 1. A message thread carries exactly one of
// institutionId/passportId (migration 0168's own comment on
// ThreadMessage) -- a staff thread has institutionId and no
// passportId, a child thread has passportId and no institutionId.
// Picks the matching resolver rather than threading a third prop
// through every message list/card; both underlying hooks already
// no-op cleanly on a null id.
export function useMessageInstitutionVocabulary(message: { institutionId: string | null; passportId: string | null }) {
  const byInstitution = useInstitutionType(message.institutionId);
  const byPassport = usePassportInstitutionVocabulary(message.passportId);
  return message.institutionId ? byInstitution : byPassport;
}
