import { createPrivateKey, sign } from "node:crypto";

// PRD 9, Stage 1 -- Domain-Wide Delegation. Deliberately no google-auth-
// library/googleapis dependency: DWD impersonation is a plain RS256-
// signed JWT exchanged for an access token at Google's own token
// endpoint (the "JWT Bearer" OAuth2 flow), both steps trivially doable
// with Node's built-in crypto plus fetch. This project has never taken
// a dependency for something this small (see src/lib/supabase/admin.ts's
// own single-function shape) -- adding a ~200KB SDK for two HTTP calls
// would be the odd choice here, not the safe one.
//
// GOOGLE_SERVICE_ACCOUNT_KEY holds the FULL downloaded service-account
// JSON key, as one string, in Vercel's environment variables -- never
// in the repo, never sent to the browser, exactly the same posture
// SUPABASE_SERVICE_ROLE_KEY already has.

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function getServiceAccountKey(): ServiceAccountKey {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set. Scheduling cannot reach Google until it is.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON -- paste the full downloaded key file's contents verbatim.");
  }
  const key = parsed as Partial<ServiceAccountKey>;
  if (!key.client_email || !key.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is missing client_email or private_key -- it may be a different file.");
  }
  return key as ServiceAccountKey;
}

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

// Mints a short-lived (1 hour) access token acting AS `subjectEmail` --
// the specific clinician being impersonated -- for the given scope.
// Deliberately takes a subject per call rather than a fixed identity:
// see freebusy.ts's own header for why each clinician is always
// impersonated to check their OWN calendar, never a shared "scheduling"
// identity checking someone else's.
//
// No caching. A serverless function invocation is too short-lived for
// an in-memory cache to reliably help, and at PRD 9's own stated cost
// ("a million queries a day, free") there's nothing to save by adding
// one -- simplicity wins here, not premature optimisation.
export async function getImpersonatedAccessToken(subjectEmail: string, scope: string): Promise<string> {
  const key = getServiceAccountKey();
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: key.client_email,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    sub: subjectEmail,
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claimSet))}`;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), createPrivateKey(key.private_key));
  const jwt = `${unsigned}.${base64url(signature)}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Google token exchange failed for ${subjectEmail} (${response.status}): ${body || "no response body"}. ` +
        `If this is a brand-new Domain-Wide Delegation grant, it can take several minutes to propagate.`
    );
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error(`Google token exchange for ${subjectEmail} returned no access_token.`);
  }
  return data.access_token;
}
