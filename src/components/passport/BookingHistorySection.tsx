"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// PRD 9, Stage 2 -- the HISTORY half of PRD section 11's own open
// question ("what a parent sees of their own booking history, as
// distinct from what is upcoming"). UpcomingBookingsCard (Home) is the
// other half. A list of past/cancelled sessions is record material --
// this project's own established Home/Passport split decides it
// belongs here, on the deep passport record, not the inbox.

interface HistoryRow {
  bookingId: string;
  clinicianName: string;
  sessionType: string;
  sessionStartAt: string;
  cancelledAt: string | null;
  cancelledVia: string | null;
  googleMeetLink: string | null;
}

const CANCELLED_VIA_LABEL: Record<string, string> = {
  parent: "Cancelled by you",
  clinician: "Cancelled by the clinician",
  clinician_google: "Cancelled by the clinician",
  director: "Cancelled by the clinic",
  discharge: "Cancelled -- care ended",
  rescheduled: "Rescheduled",
  system: "Cancelled",
};

export function BookingHistorySection({ passportId }: { passportId: string | null }) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!passportId) return;
    let isMounted = true;
    createClient()
      .rpc("get_my_booking_history", { p_passport_id: passportId })
      .then(({ data }: { data: unknown }) => {
        if (!isMounted) return;
        const raw = (data ?? []) as {
          booking_id: string;
          clinician_name: string;
          session_type: string;
          session_start_at: string;
          cancelled_at: string | null;
          cancelled_via: string | null;
          google_meet_link: string | null;
        }[];
        setRows(
          raw.map((r) => ({
            bookingId: r.booking_id,
            clinicianName: r.clinician_name,
            sessionType: r.session_type,
            sessionStartAt: r.session_start_at,
            cancelledAt: r.cancelled_at,
            cancelledVia: r.cancelled_via,
            googleMeetLink: r.google_meet_link,
          }))
        );
        setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [passportId]);

  if (isLoading || rows.length === 0) {
    return null;
  }

  return (
    <>
    <section className="rounded-2xl border border-brand-off-white/50 bg-white p-5 shadow-[0_4px_20px_rgba(0,79,113,0.05)]">
      <h2 className="mb-4 font-heading text-xl font-bold text-brand-prussian-blue">Session History</h2>
      <div className="flex flex-col divide-y divide-brand-off-white/50">
        {rows.map((row) => (
          <div key={row.bookingId} className="py-3">
            <p className="font-sans text-base font-bold text-brand-neutral-black">
              {row.sessionType === "online" ? "Online" : "In-person"} with {row.clinicianName}
            </p>
            <p className="mt-0.5 font-sans text-xs text-brand-neutral-black/50">
              {new Date(row.sessionStartAt).toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" })}
              {" · "}
              {new Date(row.sessionStartAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
            {row.cancelledAt && row.cancelledVia && (
              <p className="mt-0.5 font-accent text-[10px] font-bold uppercase tracking-wide text-brand-golden-brown">
                {CANCELLED_VIA_LABEL[row.cancelledVia] ?? "Cancelled"}
              </p>
            )}
            {!row.cancelledAt && row.googleMeetLink && (
              <a
                href={row.googleMeetLink}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 inline-block font-sans text-xs font-semibold text-brand-prussian-blue"
              >
                Video link
              </a>
            )}
          </div>
        ))}
      </div>
    </section>
    {/* This component owns its own trailing divider -- present only
        when there's real content to separate from whatever section
        follows, absent (along with everything above) when there's
        none, so the page never ends up with two dividers back to back
        around an empty gap. */}
    <div aria-hidden className="h-px bg-black/5" />
    </>
  );
}
