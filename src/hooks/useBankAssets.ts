"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { BankAsset } from "@/lib/bsp/types";

// PRD 7 Stage 4 -- appendix assets (First-Then boards, sentence strips,
// token boards, emotions visuals). Deliberately its own bucket and its
// own table, not attachments -- that table's whole shape is 1:1
// ownership (one file per artefact); a bank asset is explicitly
// reusable, referenced by many strategies at once. Institution-scoped,
// not per-child, so there's no clinician_access chain here at all.
const BUCKET = "clinic-bank-assets";
const SIGNED_URL_TTL_SECONDS = 300;

interface BankAssetRow {
  id: string;
  institution_id: string;
  label: string;
  storage_path: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  is_active: boolean;
  uploaded_by: string;
  uploaded_at: string;
}

function mapAsset(row: BankAssetRow): BankAsset {
  return {
    id: row.id,
    institutionId: row.institution_id,
    label: row.label,
    storagePath: row.storage_path,
    originalFilename: row.original_filename,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    isActive: row.is_active,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at,
  };
}

export function useBankAssets(institutionId: string | null) {
  const [assets, setAssets] = useState<BankAsset[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!institutionId) {
      setAssets([]);
      return;
    }
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("bank_assets")
      .select("id, institution_id, label, storage_path, original_filename, content_type, size_bytes, is_active, uploaded_by, uploaded_at")
      .eq("institution_id", institutionId)
      .order("uploaded_at", { ascending: false });

    if (error) {
      console.error("Failed to load bank assets:", error);
      setLoadError("Couldn't load the asset library.");
      setAssets(null);
      return;
    }

    setAssets((data as BankAssetRow[]).map(mapAsset));
  }, [institutionId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Upload only -- there is no update/replace. Immutable by design:
  // replacing a file a strategy already references would silently
  // reach into every plan that copied a pointer to it. Retiring an
  // asset (is_active=false, director-only) is the only lifecycle
  // action past upload.
  const upload = useCallback(
    async (file: File, label: string): Promise<{ error: string | null; asset: BankAsset | null }> => {
      if (!institutionId) {
        return { error: "No clinic context.", asset: null };
      }
      setIsUploading(true);
      setUploadError(null);
      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setIsUploading(false);
        setUploadError("You need to be signed in to upload an asset.");
        return { error: "You need to be signed in to upload an asset.", asset: null };
      }

      const safeName = file.name.replace(/[^\w.\- ]/g, "_");
      const path = `${institutionId}/${crypto.randomUUID()}-${safeName}`;

      const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

      if (uploadErr) {
        setIsUploading(false);
        setUploadError(uploadErr.message);
        return { error: uploadErr.message, asset: null };
      }

      const { data: inserted, error: insertErr } = await supabase
        .from("bank_assets")
        .insert({
          institution_id: institutionId,
          label,
          storage_path: path,
          original_filename: file.name,
          content_type: file.type || "application/octet-stream",
          size_bytes: file.size,
          uploaded_by: user.id,
        })
        .select("id, institution_id, label, storage_path, original_filename, content_type, size_bytes, is_active, uploaded_by, uploaded_at")
        .single();

      setIsUploading(false);

      if (insertErr || !inserted) {
        console.error("Bank asset metadata insert failed after a successful upload -- removing the orphaned file:", insertErr);
        await supabase.storage.from(BUCKET).remove([path]);
        setUploadError("Couldn't save this asset. Please try again.");
        return { error: "Couldn't save this asset. Please try again.", asset: null };
      }

      await load();
      return { error: null, asset: mapAsset(inserted as BankAssetRow) };
    },
    [institutionId, load]
  );

  // Director-only, per the table's own RLS -- a non-director's call
  // simply updates zero rows, no thrown error (the RLS-silently-
  // filters shape this codebase already knows well), so callers should
  // re-read state afterward rather than trust a lack of error.
  const setActive = useCallback(
    async (assetId: string, isActive: boolean): Promise<{ error: string | null }> => {
      const supabase = createClient();
      const { error } = await supabase.from("bank_assets").update({ is_active: isActive }).eq("id", assetId);
      if (error) return { error: error.message };
      await load();
      return { error: null };
    },
    [load]
  );

  const fetchAsset = useCallback(async (asset: BankAsset): Promise<{ blobUrl: string | null; error: string | null }> => {
    const supabase = createClient();

    async function attempt(): Promise<Response | null> {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(asset.storagePath, SIGNED_URL_TTL_SECONDS);
      if (error || !data) return null;
      try {
        const resp = await fetch(data.signedUrl);
        return resp.ok ? resp : null;
      } catch {
        return null;
      }
    }

    let resp = await attempt();
    if (!resp) resp = await attempt();
    if (!resp) return { blobUrl: null, error: "Couldn't open this file. Please try again." };

    const blob = await resp.blob();
    return { blobUrl: URL.createObjectURL(blob), error: null };
  }, []);

  return { assets, loadError, reload: load, upload, isUploading, uploadError, setActive, fetchAsset };
}
