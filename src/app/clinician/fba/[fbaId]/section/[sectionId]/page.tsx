"use client";

import { useParams, useRouter } from "next/navigation";
import { FbaSectionEditor } from "@/components/clinician/fba/FbaSectionEditor";

// FBA section rail, 15 Sept 2026 -- thin route shell, same shape as
// clinician/passport/[passportId]/page.tsx's own shell around
// ClinicalFileDetail. All fetching, all fourteen sections' content, and
// the flush-before-navigate machinery live in FbaSectionEditor; this
// file only supplies real router.push navigation, since this is the
// genuine standalone route (below lg, or a direct/deep link at any
// width) where there's no rail alongside it to switch in place.
export default function FbaSectionEditorPage() {
  const { fbaId, sectionId } = useParams<{ fbaId: string; sectionId: string }>();
  const router = useRouter();

  return (
    <FbaSectionEditor
      fbaId={fbaId}
      sectionId={sectionId}
      onNavigateBack={() => router.push(`/clinician/fba/${fbaId}`)}
      onNavigateSection={(slug) => router.push(`/clinician/fba/${fbaId}/section/${slug}`)}
    />
  );
}
