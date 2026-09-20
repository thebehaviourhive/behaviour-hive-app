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
// Wired into vercel.json at "0 4 * * *" -- once a day, NOT the "*/5 * * * *"
// the staleness threshold below would ideally want. The Hobby plan
// caps Vercel Cron Jobs at once per day (confirmed: this project is on
// Hobby) -- a five-minute schedule on that plan is configuration that
// does not describe what actually runs, which is worse than an honest
// daily one. STALE_AFTER_MINUTES stays 5 regardless -- that number
// defines what counts as stale once the cron DOES run, not how often
// it runs; it's still correct to flip anything older than a genuine
// Google round-trip the moment the daily sweep gets to it.
//
// The real cost, stated plainly rather than left implied: a booking
// that fails between the row insert and the Google call can now sit
// ambiguously `pending` for up to 24 hours instead of a few minutes,
// before this route ever reclassifies it to `sync_failed` and puts it
// in front of the clinician's own attention queue. Not a lost booking
// -- the parent already saw a plain, synchronous error at the moment
// it failed (see /api/scheduling/book's own all-or-nothing write) -- a
// DELAYED signal to the clinician, not a silent one. Upgrading to the
// Pro plan is what unlocks the tighter, minutes-scale cadence this
// route was originally built for -- a known, named consequence of
// staying on Hobby, not a rediscovery the next time this file is read.
// CRON_SECRET is the same one purge-app-events and sweep-discharged-
// bookings already require -- confirm it's set on Vercel before this
// can fire for real.
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
