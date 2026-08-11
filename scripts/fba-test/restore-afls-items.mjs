// Restores fba_instruments AFLS item text from the backup written by
// seed-afls-results.mjs. Run this before/alongside cleanup.mjs once
// verification is done, so the shared item bank is left exactly as it
// was found.
//
// Run with: node --env-file=.env.local scripts/fba-test/restore-afls-items.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, unlinkSync } from "node:fs";

const backupUrl = new URL("./.afls-item-backup.json", import.meta.url);

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  if (!existsSync(backupUrl)) {
    console.log("No .afls-item-backup.json found -- nothing to restore.");
    return;
  }
  const rows = JSON.parse(readFileSync(backupUrl));
  for (const row of rows) {
    const { error } = await supabase.from("fba_instruments").update({ items: row.items }).eq("id", row.id);
    if (error) throw error;
  }
  console.log(`Restored original item text for ${rows.length} AFLS domain rows.`);
  unlinkSync(backupUrl);
  console.log("Removed .afls-item-backup.json.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
