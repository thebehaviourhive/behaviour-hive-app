"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { TextField } from "@/components/ui/TextField";
import { Button } from "@/components/ui/Button";

// Client Info (clinic-only), Daniel's decisions, Sept 2026. Self-
// contained, same idiom as EpisodeTagsSection -- resolves the caller's
// own institution internally, takes only passportId as a prop, so
// every staff-facing surface (director's ChildDetail, the
// practitioner's ClinicalFileDetail, the admin's own client page) drops
// this in unchanged rather than threading institutionId through three
// different parent components.
//
// Read is never toggle-gated (any current staff can see a family's
// contact details); write goes through set_client_contact_info() only
// -- there is no raw staff UPDATE policy on client_contact_info at all,
// so a caller ineligible to write (e.g. a practitioner at a clinic
// where practitioner_can_onboard is off) sees the RPC's own refusal
// message on save, not a client-side guess at eligibility.

interface ContactInfo {
  guardianFullName: string;
  relationshipToChild: string;
  contactEmail: string;
  contactPhone: string;
  referralSource: string;
  homeAddress: string;
}

const EMPTY: ContactInfo = {
  guardianFullName: "",
  relationshipToChild: "",
  contactEmail: "",
  contactPhone: "",
  referralSource: "",
  homeAddress: "",
};

export function ClientContactInfoSection({ passportId }: { passportId: string }) {
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [fields, setFields] = useState<ContactInfo>(EMPTY);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: staffRow } = await supabase
      .from("institution_staff")
      .select("institution_id")
      .eq("user_id", user.id)
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .in("role", ["principal", "clinic_admin", "clinician"])
      .limit(1)
      .maybeSingle();

    if (!staffRow) {
      setLoadError("Could not find your clinic.");
      setIsLoading(false);
      return;
    }
    setInstitutionId(staffRow.institution_id);

    const { data: row, error } = await supabase
      .from("client_contact_info")
      .select("guardian_full_name, relationship_to_child, contact_email, contact_phone, referral_source, home_address")
      .eq("passport_id", passportId)
      .eq("institution_id", staffRow.institution_id)
      .maybeSingle();

    if (error) {
      setLoadError(error.message);
      setIsLoading(false);
      return;
    }

    if (row) {
      setFields({
        guardianFullName: row.guardian_full_name ?? "",
        relationshipToChild: row.relationship_to_child ?? "",
        contactEmail: row.contact_email ?? "",
        contactPhone: row.contact_phone ?? "",
        referralSource: row.referral_source ?? "",
        homeAddress: row.home_address ?? "",
      });
    }
    setIsLoading(false);
  }, [passportId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function updateField<K extends keyof ContactInfo>(key: K, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
    setSavedNotice(false);
  }

  async function handleSave() {
    if (!institutionId) return;
    setIsSaving(true);
    setSaveError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("set_client_contact_info", {
      p_passport_id: passportId,
      p_institution_id: institutionId,
      p_guardian_full_name: fields.guardianFullName,
      p_relationship_to_child: fields.relationshipToChild,
      p_contact_email: fields.contactEmail,
      p_contact_phone: fields.contactPhone,
      p_referral_source: fields.referralSource,
      p_home_address: fields.homeAddress,
    });
    setIsSaving(false);
    if (error) {
      setSaveError(error.message);
      return;
    }
    setSavedNotice(true);
  }

  if (isLoading) {
    return <div className="h-[220px] animate-pulse rounded-2xl bg-white" />;
  }
  if (loadError) {
    return <p className="text-sm text-brand-neutral-black/60">{loadError}</p>;
  }

  return (
    <section>
      <h2 className="mb-2 font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
        Contact Info
      </h2>
      <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3">
          <TextField
            label="Parent or guardian's full name"
            value={fields.guardianFullName}
            onChange={(e) => updateField("guardianFullName", e.target.value)}
          />
          <TextField
            label="Relationship to the child"
            value={fields.relationshipToChild}
            onChange={(e) => updateField("relationshipToChild", e.target.value)}
            placeholder="e.g. Mother, Father, Guardian"
          />
          <TextField
            label="Contact email"
            type="email"
            value={fields.contactEmail}
            onChange={(e) => updateField("contactEmail", e.target.value)}
          />
          <TextField
            label="Phone"
            type="tel"
            value={fields.contactPhone}
            onChange={(e) => updateField("contactPhone", e.target.value)}
          />
          <TextField
            label="How they heard about the clinic"
            value={fields.referralSource}
            onChange={(e) => updateField("referralSource", e.target.value)}
          />
          <TextField
            label="Home address"
            value={fields.homeAddress}
            onChange={(e) => updateField("homeAddress", e.target.value)}
          />
        </div>

        {saveError && (
          <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
            {saveError}
          </p>
        )}
        {savedNotice && !saveError && <p className="mt-3 text-sm font-medium text-green-700">Saved.</p>}

        <Button type="button" onClick={handleSave} disabled={isSaving} className="mt-4 lg:w-auto">
          {isSaving ? "Saving…" : "Save Contact Info"}
        </Button>
      </div>
    </section>
  );
}
