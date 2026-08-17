"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MessageCategory, MessageRole } from "@/types/messages";

interface RawCategoryRow {
  id: string;
  label: string;
  description: string | null;
  allowed_sender_roles: string[];
  sort_order: number;
}

// Data-driven presets (message_categories) -- provisional per the
// migration's own comment, editable via the Table Editor without a code
// change. Filters to the categories this sender role is allowed to use;
// pass null to get the full active set unfiltered (not currently needed
// by any caller, but keeps the hook honest about what "senderRole" does).
export function useMessageCategories(senderRole: MessageRole | null) {
  const [categories, setCategories] = useState<MessageCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("message_categories")
        .select("id, label, description, allowed_sender_roles, sort_order")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });

      if (!isMounted) return;

      if (error) {
        console.error("Failed to load message categories:", error);
        setCategories([]);
        setIsLoading(false);
        return;
      }

      setCategories(
        ((data ?? []) as RawCategoryRow[]).map((row) => ({
          id: row.id,
          label: row.label,
          description: row.description,
          allowedSenderRoles: row.allowed_sender_roles as MessageRole[],
          sortOrder: row.sort_order,
        }))
      );
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, []);

  const availableCategories = senderRole
    ? categories.filter((category) => category.allowedSenderRoles.includes(senderRole))
    : categories;

  return { categories: availableCategories, isLoading };
}
