"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { ChildDetail } from "@/components/principal/directory/ChildDetail";

export default function PrincipalPassportDetailPage() {
  const params = useParams();
  const passportId = params.passportId as string;

  // The child's name lives inside ChildDetail's own fetch (the roster
  // lookup keyed on passportId); it's surfaced up here purely so the
  // header title can show it, via ChildDetail's onChildNameChange.
  const [childName, setChildName] = useState<string | null>(null);

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-10">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <Link
          href="/principal/directory?segment=children"
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </Link>
        <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">{childName ?? "Child"}</h1>
      </header>

      {/* No px-4 here -- ChildDetail owns its own horizontal padding on
          both the tab-strip (flush under the header) and the content
          below it, since those need independent spacing, not one
          shared wrapper value. */}
      <main className="flex-1">
        <ChildDetail passportId={passportId} onChildNameChange={setChildName} />
      </main>
    </div>
  );
}
