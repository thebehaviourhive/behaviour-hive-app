import { createClient } from "@supabase/supabase-js";

// Server-only: uses the service role key, which can write app_metadata
// (unlike the anon key used everywhere else). Never import this into a
// client component.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
