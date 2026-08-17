"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { MessageRole } from "@/types/messages";

type Availability = "checking" | "available" | "unavailable";

function buildHref(viewerRole: MessageRole, passportId: string, abcLogId: string): string {
  if (viewerRole === "parent") return `/passport/dashboard#abc-log-${abcLogId}`;
  if (viewerRole === "class_teacher") return `/teacher/passport/${passportId}?tab=incidents&logId=${abcLogId}`;
  return `/clinician/passport/${passportId}?tab=incidents&logId=${abcLogId}`;
}

// Stage 3A: "View log" on an incident-note message. Reuses the
// recipient's EXISTING scoped log view (ABCTimeline, per its own
// viewerRole rendering) -- this component only decides where to point
// and whether to point at all; it never fetches or renders any log
// content of its own, so it cannot widen access by construction.
//
// The availability check is a plain existence query against abc_logs
// under the CURRENT viewer's own RLS (the same row-visibility rules
// get_abc_logs() enforces) -- no column data is requested, so it can't
// leak clinical_notes/perceived_function even incidentally. If a
// participant's log access has since lapsed (e.g. a revoked teacher who
// somehow still... in practice a revoked teacher loses message access
// entirely per Stage 1, but a persisting participant can still lose
// access to just the LOG if their own case link changes independently),
// this renders a quiet fallback instead of a dead/error link.
export function AbcLogReference({
  passportId,
  abcLogId,
  viewerRole,
}: {
  passportId: string;
  abcLogId: string;
  viewerRole: MessageRole;
}) {
  const [availability, setAvailability] = useState<Availability>("checking");

  useEffect(() => {
    let isMounted = true;
    async function check() {
      const supabase = createClient();
      const { count, error } = await supabase
        .from("abc_logs")
        .select("id", { count: "exact", head: true })
        .eq("id", abcLogId);
      if (!isMounted) return;
      setAvailability(!error && (count ?? 0) > 0 ? "available" : "unavailable");
    }
    check();
    return () => {
      isMounted = false;
    };
  }, [abcLogId]);

  if (availability === "checking") return null;

  if (availability === "unavailable") {
    return <p className="mt-2 text-xs text-brand-neutral-black/40">Log no longer available.</p>;
  }

  return (
    <Link
      href={buildHref(viewerRole, passportId, abcLogId)}
      className="mt-2 inline-block text-xs font-semibold text-brand-prussian-blue underline underline-offset-2"
    >
      View log
    </Link>
  );
}
