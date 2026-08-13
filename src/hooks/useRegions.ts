"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface RegionOption {
  id: string;
  name: string;
  countryCode: string;
}

// The regions table (migration 0055) -- currently just the 26 counties
// of the Republic of Ireland (country_code='IE'); Northern Irish
// counties / future UK regions arrive as additional rows, not a
// rework of this hook or anything that reads it. Read-only for any
// authenticated user, shared by the parent's passport county picker
// and the clinician's Operating Area multi-select.
export function useRegions() {
  const [regions, setRegions] = useState<RegionOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();
    supabase
      .from("regions")
      .select("id, name, country_code")
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error) {
          console.error("Failed to load regions:", error);
          setIsLoading(false);
          return;
        }
        setRegions((data ?? []).map((r) => ({ id: r.id, name: r.name, countryCode: r.country_code })));
        setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  return { regions, isLoading };
}
