// Stage 3 additions on top of seed.mjs: an in_progress FBA (with just
// enough content_data to pass the Finalize completeness gate) so the
// real "Finalize & Lock" -> "Notify the team?" flow can be exercised
// live, plus a throwaway unrelated passport+log to construct the "log
// no longer available" state (per the brief: "construct via test
// data" -- a persisting participant losing access to just the log,
// independent of their message access, doesn't occur through any real
// revocation path in this schema; a cross-passport reference is the
// honest way to reproduce the same RLS-miss the UI has to handle).
//
// Run with: node --env-file=.env.local scripts/messages-test/seed-stage3.mjs (after seed.mjs)

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const seed = JSON.parse(readFileSync(new URL("./seed-output.json", import.meta.url)));

function id() {
  return crypto.randomUUID();
}

async function main() {
  console.log("== In-progress FBA (passes the Finalize completeness gate) ==");
  const triggerId = id();
  const targetBehaviourId = id();
  const content = {
    clinicalOverview: "Elopement risk during unstructured transitions.",
    hypothesisedFunctions: "Escape from demand.",
    conclusion: "Assessment complete; trial recommendations across settings.",
    triggers: [{ id: triggerId, title: "Unplanned transitions", description: "Sudden routine changes." }],
    settingEvents: [],
    targetBehaviours: [
      { id: targetBehaviourId, name: "Elopement", operationalDefinition: "Leaving the area without permission.", howItPresents: "Bolting toward the door." },
    ],
    recommendationsHome: [{ id: id(), title: "2-minute transition warning", details: ["Visual countdown before ending an activity."] }],
    recommendationsSchool: [{ id: id(), title: "Visual transition timer", details: ["Same countdown cue, classroom version."] }],
    recommendationsShared: [],
  };

  const { data: fba, error: fbaError } = await supabase
    .from("fba_reports")
    .insert({
      passport_id: seed.passportId,
      clinician_id: seed.clinician1.id,
      status: "in_progress",
      content_data: content,
    })
    .select("id")
    .single();
  if (fbaError) throw fbaError;
  console.log("fba (in_progress):", fba.id);

  console.log("== Unrelated throwaway passport + log (for 'no longer available') ==");
  const { data: orphanParent } = await supabase.auth.admin.createUser({
    email: "msgtest.orphanparent@thebehaviourhive.com",
    password: "MsgTest-2026!",
    email_confirm: true,
    user_metadata: { full_name: "Orphan Parent Msgtest" },
    app_metadata: { role: "parent" },
  }).then(
    (r) => r,
    async () => {
      const { data: list } = await supabase.auth.admin.listUsers({ perPage: 200 });
      return { data: { user: list.users.find((u) => u.email === "msgtest.orphanparent@thebehaviourhive.com") } };
    }
  );

  const { data: orphanPassport, error: orphanPassportError } = await supabase
    .from("passports")
    .upsert(
      {
        user_id: orphanParent.user.id,
        child_name: "Orphan Test Child",
        passport_status: "complete",
        section_a_complete: true,
      },
      { onConflict: "user_id" }
    )
    .select("id")
    .single();
  if (orphanPassportError) throw orphanPassportError;

  const { data: orphanLog, error: orphanLogError } = await supabase
    .from("abc_logs")
    .insert({
      passport_id: orphanPassport.id,
      logged_by: orphanParent.user.id,
      logged_by_role: "parent",
      incident_date: "2026-01-01",
      incident_time: "10:00",
      intensity: 2,
      antecedents: ["Other"],
      antecedent_other: "Unrelated to msgtest passports",
      behaviours: ["Other"],
      behaviour_other: "n/a",
      consequences: ["Other"],
      consequence_other: "n/a",
    })
    .select("id")
    .single();
  if (orphanLogError) throw orphanLogError;
  console.log("orphan log id (no msgtest.* viewer can ever see this one):", orphanLog.id);

  // A real send_message call (as parent, so it goes through the normal
  // RPC) referencing THIS passport's own log, then a service-role swap
  // of abc_log_id onto the orphan log afterward -- send_message's own
  // same-passport check would correctly reject the orphan id outright
  // (already verified at the RPC level separately), so this step
  // deliberately bypasses the RPC via a raw update to reach the "exists
  // in the DB, but this viewer's RLS can't see it" state the UI has to
  // degrade for.
  const parentClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await parentClient.auth.signInWithPassword({ email: seed.parent.email, password: "MsgTest-2026!" });
  const { data: categories } = await supabase.from("message_categories").select("id, label");
  const incidentNoteId = categories.find((c) => c.label === "Incident note").id;
  const { data: realLog } = await supabase
    .from("abc_logs")
    .insert({
      passport_id: seed.passportId,
      logged_by: seed.parent.id,
      logged_by_role: "parent",
      incident_date: "2026-01-02",
      incident_time: "09:00",
      intensity: 3,
      antecedents: ["Other"],
      antecedent_other: "placeholder for orphan-swap message",
      behaviours: ["Other"],
      behaviour_other: "n/a",
      consequences: ["Other"],
      consequence_other: "n/a",
    })
    .select("id")
    .single();

  const { data: orphanRefMsgId, error: sendError } = await parentClient.rpc("send_message", {
    p_passport_id: seed.passportId,
    p_category_id: incidentNoteId,
    p_body: "This log reference will be swapped to point at an unreachable log.",
    p_response_required: false,
    p_recipient_ids: [seed.teacher1.id],
    p_abc_log_id: realLog.id,
  });
  if (sendError) throw sendError;

  const { error: swapError } = await supabase
    .from("messages")
    .update({ abc_log_id: orphanLog.id })
    .eq("id", orphanRefMsgId);
  if (swapError) throw swapError;
  console.log("message with now-unreachable log reference:", orphanRefMsgId);

  const summary = { ...seed, inProgressFbaId: fba.id, orphanRefMessageId: orphanRefMsgId, orphanParentId: orphanParent.user.id };
  writeFileSync(new URL("./seed-output.json", import.meta.url), JSON.stringify(summary, null, 2));
  console.log("\n== Stage 3 seed complete ==");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
