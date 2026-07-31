import { createClient } from "@supabase/supabase-js";

/**
 * A one-off client used only for the sign-up and resend-confirmation
 * requests. Every other call in the app uses the shared PKCE-configured
 * client from client.ts — this one exists solely so the confirmation
 * email Supabase sends uses the implicit flow (self-contained tokens in
 * the redirect's URL fragment) instead of PKCE (a `?code=` tied to a
 * code_verifier cookie on the browser that initiated sign-up).
 *
 * PKCE requires the browser that opens the confirmation link to be the
 * exact same browser context that started sign-up. On mobile that breaks
 * as soon as a mail client opens the link in a different in-app browser
 * than the one used to register — confirmed in production via the
 * "PKCE code verifier not found in storage" error. The implicit flow has
 * no such requirement since its tokens don't depend on any client-side
 * secret, so it works regardless of which browser context opens the link.
 */
export function createSignUpClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        flowType: "implicit",
        persistSession: false,
        detectSessionInUrl: false,
      },
    }
  );
}
