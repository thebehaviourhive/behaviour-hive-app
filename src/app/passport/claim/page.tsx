"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";

// PRD 1, Stage 5, Step 3, Requirement 4. One-shot flow, same shape as
// AddChildSheet.tsx's own lookup_passport_by_code() convention (0116's
// own comment names this file explicitly as the precedent):
// redeem_passport_claim_code() both validates AND claims in the same
// call -- there is no separate "preview, then confirm" step server-side,
// so this screen doesn't invent one. What IS a genuine confirmation is
// the RETURNED child_name -- minimal disclosure (first name + last
// initial, the RPC's own v_display_name), shown only after a successful
// claim, never before -- a wrong code never discloses whose child it
// belonged to.
//
// Every refusal message below is redeem_passport_claim_code()'s own
// thrown exception text, shown as-is -- already specific, honest, and
// actionable (0114/0115/0116's own design), not re-worded here. The one
// exception is "not found": that case is a deliberate ZERO-ROW SUCCESS,
// not a thrown error (0116's own fix, so the rate-limit insert ahead of
// it survives) -- this screen supplies its own copy for that one case.
//
// Client Info (clinic-only), Daniel's decisions, Sept 2026. Decision 2:
// the parent can EDIT their contact details here, not just acknowledge
// them -- their own information, Sections A-D are already
// guardian-editable, correcting it is their right under GDPR. A raw
// client_contact_info row is fetched right after a successful claim
// (owns_passport() already covers this the instant redeem_passport_
// claim_code() creates the guardian row); a school-claimed passport, or
// a clinic one where nothing was entered yet, simply has no row -- the
// confirm step is skipped entirely, straight to the existing success
// screen, never an empty form shown for nothing. Plan A, per decision
// 4: clinical intake is never fetched or shown here, at all.
interface ContactInfo {
  guardianFullName: string;
  relationshipToChild: string;
  contactEmail: string;
  contactPhone: string;
  referralSource: string;
  homeAddress: string;
}

export default function PassportClaimPage() {
  const router = useRouter();
  const { isReady } = useRequireRole("parent");
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimedChildName, setClaimedChildName] = useState<string | null>(null);
  const [claimedPassportId, setClaimedPassportId] = useState<string | null>(null);
  // Tier 1 item 4, 21 Sept 2026 -- unknown until AFTER a successful
  // claim (a code could belong to either a school or a clinic; nothing
  // before the claim resolves it), so the pre-lookup copy stays
  // deliberately neutral, matching /role-select's own established
  // "organisation" wording for the identical not-yet-known case. The
  // success screen resolves the real institution(s) this passport is
  // now linked to, exactly once, to say something true instead.
  const [isClinicOnly, setIsClinicOnly] = useState(false);

  const [contact, setContact] = useState<ContactInfo | null>(null);
  const [isSavingContact, setIsSavingContact] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const [hasConfirmedContact, setHasConfirmedContact] = useState(false);

  async function handleClaim() {
    if (!code.trim()) return;

    setError(null);
    setIsSubmitting(true);

    const supabase = createClient();
    const { data, error: claimError } = await supabase.rpc("redeem_passport_claim_code", {
      p_code: code.trim(),
    });

    if (claimError) {
      setIsSubmitting(false);
      setError(claimError.message);
      return;
    }

    const claimed = data?.[0] ?? null;

    if (!claimed) {
      setIsSubmitting(false);
      setError(
        "We couldn't find a passport with that code. Please check with them and try again."
      );
      return;
    }

    const { data: linkRows } = await supabase
      .from("passport_institution_links")
      .select("institution_id")
      .eq("passport_id", claimed.passport_id);
    const institutionIds = Array.from(new Set((linkRows ?? []).map((r) => r.institution_id)));
    if (institutionIds.length > 0) {
      const { data: institutionRows } = await supabase.from("institutions").select("type").in("id", institutionIds);
      const types = new Set((institutionRows ?? []).map((r) => r.type as string));
      setIsClinicOnly(types.has("clinic") && !types.has("school"));
    }

    const { data: contactRows } = await supabase
      .from("client_contact_info")
      .select("guardian_full_name, relationship_to_child, contact_email, contact_phone, referral_source, home_address")
      .eq("passport_id", claimed.passport_id);
    const contactRow = contactRows?.[0] ?? null;
    if (contactRow) {
      setContact({
        guardianFullName: contactRow.guardian_full_name ?? "",
        relationshipToChild: contactRow.relationship_to_child ?? "",
        contactEmail: contactRow.contact_email ?? "",
        contactPhone: contactRow.contact_phone ?? "",
        referralSource: contactRow.referral_source ?? "",
        homeAddress: contactRow.home_address ?? "",
      });
    }

    setIsSubmitting(false);
    setClaimedPassportId(claimed.passport_id);
    setClaimedChildName(claimed.child_name);
  }

  function updateContactField<K extends keyof ContactInfo>(key: K, value: string) {
    setContact((current) => (current ? { ...current, [key]: value } : current));
  }

  async function handleSaveContact() {
    if (!contact || !claimedPassportId) return;
    setIsSavingContact(true);
    setContactError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("client_contact_info")
      .update({
        guardian_full_name: contact.guardianFullName.trim() || null,
        relationship_to_child: contact.relationshipToChild.trim() || null,
        contact_email: contact.contactEmail.trim() || null,
        contact_phone: contact.contactPhone.trim() || null,
        referral_source: contact.referralSource.trim() || null,
        home_address: contact.homeAddress.trim() || null,
      })
      .eq("passport_id", claimedPassportId);
    setIsSavingContact(false);
    if (error) {
      setContactError(error.message);
      return;
    }
    await handleConfirmContact();
  }

  async function handleConfirmContact() {
    if (!claimedPassportId) return;
    setIsSavingContact(true);
    setContactError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("confirm_client_contact_info", { p_passport_id: claimedPassportId });
    setIsSavingContact(false);
    if (error) {
      setContactError(error.message);
      return;
    }
    setHasConfirmedContact(true);
  }

  if (!isReady) {
    return null;
  }

  // Decision 3: confirmation is a shared fact about the family record,
  // not per-guardian -- this screen doesn't need to check whether a
  // DIFFERENT guardian already confirmed it before showing this step;
  // confirm_client_contact_info() itself is a no-op-safe re-confirm if
  // it was already true, and the parent seeing (and being free to
  // correct) the details again on their own first claim is the point.
  if (claimedChildName && contact && !hasConfirmedContact) {
    return (
      <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center gap-3">
            <BrandMark />
            <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black text-center">Confirm your details</h1>
          </div>

          <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
            <p className="text-sm leading-relaxed text-black/70">
              Your clinic already has this on file. Check it&apos;s right -- you can correct anything below.
            </p>

            <div className="mt-4 flex flex-col gap-3">
              <TextField
                label="Your full name"
                value={contact.guardianFullName}
                onChange={(e) => updateContactField("guardianFullName", e.target.value)}
              />
              <TextField
                label="Relationship to the child"
                value={contact.relationshipToChild}
                onChange={(e) => updateContactField("relationshipToChild", e.target.value)}
              />
              <TextField
                label="Contact email"
                type="email"
                value={contact.contactEmail}
                onChange={(e) => updateContactField("contactEmail", e.target.value)}
              />
              <TextField
                label="Phone"
                type="tel"
                value={contact.contactPhone}
                onChange={(e) => updateContactField("contactPhone", e.target.value)}
              />
              <TextField
                label="Home address"
                value={contact.homeAddress}
                onChange={(e) => updateContactField("homeAddress", e.target.value)}
              />
            </div>

            {contactError && (
              <p role="alert" className="mt-3 text-sm font-medium text-red-600">
                {contactError}
              </p>
            )}

            <Button type="button" onClick={handleSaveContact} disabled={isSavingContact} className="mt-5">
              {isSavingContact ? "Saving…" : "This looks right"}
            </Button>
          </div>
        </div>
      </main>
    );
  }

  if (claimedChildName) {
    return (
      <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
        <div className="w-full max-w-sm text-center">
          <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
            <span
              aria-hidden
              className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-3xl"
            >
              ✅
            </span>
            <h1 className="font-heading text-xl font-semibold text-brand-neutral-black">
              You now have access to {claimedChildName}&apos;s passport
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-black/60">
              {isClinicOnly
                ? "You'll see everything your clinic's own team has already added, and you can pick up wherever they left off."
                : "You'll see everything the school and clinical team have already added, and you can pick up wherever they left off."}
            </p>
            <Button
              type="button"
              onClick={() => router.push("/passport/dashboard")}
              className="mt-6"
            >
              Go to {claimedChildName}&apos;s passport
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
      <div className="w-full max-w-sm text-center">
        <div className="mb-6 flex flex-col items-center gap-3">
          <BrandMark />
          <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
            Enter your code
          </h1>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          <p className="text-sm leading-relaxed text-black/70">
            Your child&apos;s organisation gave you a code to link your
            account to the record they&apos;ve already started.
          </p>

          <label className="mt-5 block text-left text-sm font-semibold text-brand-neutral-black">
            Claim code
          </label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. SAM4821"
            autoCapitalize="characters"
            className="mt-1.5 w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base uppercase tracking-widest text-brand-neutral-black placeholder:normal-case placeholder:tracking-normal placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
          />

          {error && (
            <p role="alert" className="mt-3 text-sm font-medium text-red-600">
              {error}
            </p>
          )}

          <Button
            type="button"
            onClick={handleClaim}
            disabled={!code.trim() || isSubmitting}
            className="mt-5"
          >
            {isSubmitting ? "Checking…" : "Claim passport"}
          </Button>

          {/* Stage 2, 15 Sept 2026: self-creation retired -- there is no
              longer an alternative path this could route to, so this is
              now explanatory copy, not a link. Every family gets their
              code from their child's organisation. Deliberately neutral
              -- a code can come from either a school or a clinic, and
              nothing here yet knows which. */}
          <p className="mt-4 text-sm text-black/50">
            Don&apos;t have a code? Ask your child&apos;s organisation --
            they can generate one for you.
          </p>
        </div>
      </div>
    </main>
  );
}
