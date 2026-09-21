"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { WorkQueueRow } from "@/components/shared/WorkQueueRow";
import { formatWaitingSince } from "@/lib/workQueueFormatting";

// PRD 10 Stage 3, item 4 -- the "My Requests" half of "both options."
// Shared, not duplicated per dashboard: the admin's own dashboard and
// the practitioner's need the identical thing (get_my_tag_change_
// requests(), 0270, every status, most recent first), and a director
// never raises a request at all (section 4: they edit tags directly),
// so this deliberately never mounts on ClinicDirectorDashboard -- an
// always-empty tile there would be clutter, not information.
//
// Renders nothing at all when the caller has no requests of their own --
// same "genuinely absent, not an empty state" posture WorkQueueRow's own
// Context prop already uses.

interface MyRequestRow {
  requestId: string;
  passportId: string;
  childName: string;
  requestedAt: string;
  reason: string;
  status: "pending" | "approved" | "declined";
  declineReason: string | null;
  decidedAt: string | null;
}

export function MyTagChangeRequestsSection({
  recordHref,
}: {
  // Each caller's own client-record route differs -- the admin's is
  // /clinic-admin/client/[passportId] (Stage 3's own new, deliberately
  // non-clinical view), a practitioner's is /clinician/passport/
  // [passportId] (ClinicalFileDetail). Never guessed at here.
  recordHref: (passportId: string) => string;
}) {
  const [requests, setRequests] = useState<MyRequestRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();
    supabase.rpc("get_my_tag_change_requests").then(({ data, error }) => {
      if (!isMounted) return;
      if (!error) {
        setRequests(
          (data ?? []).map(
            (r: {
              request_id: string;
              passport_id: string;
              child_name: string;
              requested_at: string;
              reason: string;
              status: "pending" | "approved" | "declined";
              decline_reason: string | null;
              decided_at: string | null;
            }) => ({
              requestId: r.request_id,
              passportId: r.passport_id,
              childName: r.child_name,
              requestedAt: r.requested_at,
              reason: r.reason,
              status: r.status,
              declineReason: r.decline_reason,
              decidedAt: r.decided_at,
            })
          )
        );
      }
      setIsLoading(false);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  if (isLoading || requests.length === 0) {
    return null;
  }

  return (
    <section className="mt-8 px-4 lg:max-w-[66.6667%]">
      <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-prussian-blue">
        My Requests
      </h2>
      <div className="flex flex-col gap-2">
        {requests.map((r) => (
          <WorkQueueRow
            key={r.requestId}
            entity={r.childName}
            exception={
              r.status === "pending"
                ? `"${r.reason}"`
                : r.status === "approved"
                  ? "Approved"
                  : `Declined${r.declineReason ? ` — ${r.declineReason}` : ""}`
            }
            context={r.decidedAt ? undefined : formatWaitingSince(r.requestedAt)}
            actionLabel="View"
            href={recordHref(r.passportId)}
            urgent={r.status === "pending"}
          />
        ))}
      </div>
    </section>
  );
}
