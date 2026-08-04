/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   SECURITY FIX (C-10) -- "Teachers can view links for their institution"
   (migration 0014) has no approved_by_parent filter, unlike every other
   consumer of passport_institution_links. Any staff member of an
   institution can currently see every passport_id that has ever attempted
   to link to that institution, whether or not the parent approved it --
   the app's own client code (useTeacherPassports.ts, AddChildSheet.tsx)
   already self-filters with .eq("approved_by_parent", true), but nothing
   stopped a direct query from seeing the unapproved rows too, disclosing
   which children have requested a link even when the parent never
   consented to it.

   One change: `approved_by_parent = true` added as a top-level condition
   alongside the existing institution-membership check, via ALTER POLICY.
   Nothing else in the policy changes. */

alter policy "Teachers can view links for their institution"
  on public.passport_institution_links
  using (
    approved_by_parent = true
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = passport_institution_links.institution_id
        and s.user_id = auth.uid()
    )
  );
