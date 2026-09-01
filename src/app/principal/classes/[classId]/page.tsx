"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { useRequireRole } from "@/hooks/useRequireRole";
import { ClassDetail } from "@/components/principal/directory/ClassDetail";

// PRD 4, Stage 4 -- thin route wrapper. All the actual content moved,
// verbatim, into ClassDetail (src/components/principal/directory/
// ClassDetail.tsx) so the same detail can render here (375px push-to-
// detail, exactly as before this stage) and in Directory's own split
// view at 1280px (selection, no navigation) without forking it. This
// file owns only the header/back-chevron and the route param.
export default function PrincipalClassDetailPage() {
  const params = useParams();
  const classId = params.classId as string;
  const { isReady } = useRequireRole("principal");
  const [className, setClassName] = useState<string | null>(null);

  if (!isReady) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-10">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <Link
          href="/principal/directory?segment=classes"
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </Link>
        <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">{className ?? "Class"}</h1>
      </header>

      <main className="flex-1 px-4">
        <ClassDetail classId={classId} onNameResolved={setClassName} />
      </main>
    </div>
  );
}
