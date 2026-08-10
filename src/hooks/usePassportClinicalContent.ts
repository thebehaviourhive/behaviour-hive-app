"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ClinicalContentItem, ClinicalItemType } from "@/lib/passportClinicalContent";

interface ClinicalContentRow {
  id: string;
  item_type: ClinicalItemType;
  content: { title?: string; description?: string } | null;
  author_role: string;
  author_name: string | null;
  source_document_type: string;
  created_at: string;
}

// Single read path for the "From your Clinical Team" section, shared by
// the parent, teacher, and clinician passport views -- each gets exactly
// the rows their own role is authorized for (the RPC re-implements the
// same three conditions passport_clinical_content's RLS already
// enforces), with author_name resolved server-side since none of these
// roles can read auth.users or another user's clinicians row directly.
export function usePassportClinicalContent(passportId: string) {
  const [items, setItems] = useState<ClinicalContentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_passport_clinical_content", {
      p_passport_id: passportId,
    });

    if (error) {
      console.error("Failed to load clinical content:", error);
      setLoadError("Couldn't load clinical team updates.");
      setIsLoading(false);
      return;
    }

    setItems(
      ((data ?? []) as ClinicalContentRow[]).map((row) => ({
        id: row.id,
        itemType: row.item_type,
        title: row.content?.title ?? "",
        description: row.content?.description ?? "",
        authorRole: row.author_role,
        authorName: row.author_name,
        sourceDocumentType: row.source_document_type,
        createdAt: row.created_at,
      }))
    );
    setIsLoading(false);
  }, [passportId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return { items, isLoading, loadError, reload: load };
}
