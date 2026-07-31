"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

function redirectToLoginWithError(
  router: ReturnType<typeof useRouter>,
  reason: string
) {
  router.replace(
    `/login?error=auth-callback-failed&reason=${encodeURIComponent(reason)}`
  );
}

export default function AuthCallbackCompletePage() {
  const router = useRouter();

  useEffect(() => {
    async function handleHashTokens() {
      const rawHash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;
      const params = new URLSearchParams(rawHash);

      const hashError = params.get("error_description") ?? params.get("error");
      if (hashError) {
        redirectToLoginWithError(router, hashError);
        return;
      }

      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");

      if (!accessToken || !refreshToken) {
        redirectToLoginWithError(
          router,
          "No session information found in the confirmation link."
        );
        return;
      }

      const supabase = createClient();
      const { data, error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (error || !data.user) {
        redirectToLoginWithError(
          router,
          error?.message ?? "Could not establish a session."
        );
        return;
      }

      const hasRole = Boolean(data.user.user_metadata?.role);
      router.replace(hasRole ? "/dashboard" : "/role-select");
    }

    handleHashTokens();
  }, [router]);

  return null;
}
