import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// PRD 9, Stage 1 -- closes the "orphaned pending row" gap: if the
// process dies between inserting a bookings row and the Google API
// call that's meant to follow it, the row would otherwise sit
// `google_sync_status = 'pending'` forever, looking like a real
// booking to nobody in particular. This never deletes it -- a booking
// attempt that failed is a real fact worth keeping, same as everywhere
// else in this schema -- it just reclassifies it as `sync_failed` once
// it's been pending longer than any real Google round-trip should ever
// take, which puts it in front of the clinician via
// get_my_bookings_needing_attention() with no separate mechanism
// needed.
//
// Same shape as /api/cron/purge-app-events -- NOT wired into
// vercel.json yet. To activate: add {"path":
// "/api/cron/fail-stale-bookings", "schedule": "*/5 * * * *"} to
// vercel.json's crons array (this one wants minutes, not once a day --
// a pending row should never realistically survive more than a few
// seconds, so five minutes is already a generous margin, not a tight
// one) and confirm CRON_SECRET is set (already required by the
// app-events route above, reused here rather than adding a second
// secret for the same purpose).
const STALE_AFTER_MINUTES = 5;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("fail_stale_pending_bookings", {
    p_older_than_minutes: STALE_AFTER_MINUTES,
  });

  if (error) {
    console.error("fail_stale_pending_bookings failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, failedRows: data });
}
