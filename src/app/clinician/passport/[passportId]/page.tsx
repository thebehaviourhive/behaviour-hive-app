"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ClinicalFileDetail } from "@/components/clinician/ClinicalFileDetail";

// Clinician desktop pass, Stage 2 -- thin route shell, same shape as
// principal/passports/[passportId]/page.tsx's own shell around
// ChildDetail. All fetching, tabs, and actions live in
// ClinicalFileDetail; this file owns only the back-chevron + title
// chrome and stays the real, deep-linkable route (below lg, tapping a
// caseload card still lands here exactly as it does today).
export default function ClinicianPassportPage() {
  const params = useParams<{ passportId: string }>();
  const passportId = params.passportId;

  // The child's name lives inside ClinicalFileDetail's own fetch;
  // surfaced up here purely so the header title can show it, via
  // onChildNameChange -- same idiom as ChildDetail's own
  // onChildNameChange.
  const [childName, setChildName] = useState<string | null>(null);

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-28">
      <header className="px-4 pt-6 pb-3">
        <div className="mb-2 flex items-center justify-between">
          <Link
            href="/clinician/passports"
            aria-label="Back"
            className="block w-fit text-2xl leading-none text-brand-prussian-blue"
          >
            ‹
          </Link>
          <Link
            href={`/clinician/passport/${passportId}/export`}
            className="rounded-full border-2 border-brand-prussian-blue px-3 py-1 text-xs font-semibold text-brand-prussian-blue"
          >
            Export
          </Link>
        </div>
        <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
          {childName ? `${childName}'s Clinical File` : "Clinical File"}
        </h1>
      </header>

      <ClinicalFileDetail passportId={passportId} onChildNameChange={setChildName} />
    </div>
  );
}
