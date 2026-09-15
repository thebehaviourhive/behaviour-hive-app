import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Vercel Cron alternative to pg_cron (migration 0187), prepared
// alongside it since this project's own pg_cron availability wasn't
// confirmed when either was written. NOT currently wired into
// vercel.json's crons array -- deliberately inert until pg_cron is
// confirmed unavailable, so exactly one mechanism is ever the live
// source of truth for "app_events gets purged daily", not both (two
// active schedulers doing the same job is harmless in outcome --
// calling purge_stale_app_events() again in the same window just
// deletes zero rows -- but genuinely confusing for whoever next audits
// retention and finds two places claiming to own it).
//
// To activate: add {"path": "/api/cron/purge-app-events", "schedule":
// "0 3 * * *"} to vercel.json's crons array, set a CRON_SECRET env var
// in the Vercel project, and redeploy. Vercel signs every cron-
// triggered request with `Authorization: Bearer ${CRON_SECRET}`
// automatically once that env var exists -- checked below, the only
// thing standing between this route and anyone who finds the URL.
//
// Deletes ONLY app_events rows older than 90 days -- same function,
// same single DELETE statement (0174), nothing else in the schema is
// reachable from this route.
const RETENTION_DAYS = 90;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("purge_stale_app_events", { p_before: cutoff });

  if (error) {
    console.error("purge_stale_app_events failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, deletedRows: data, cutoff });
}
