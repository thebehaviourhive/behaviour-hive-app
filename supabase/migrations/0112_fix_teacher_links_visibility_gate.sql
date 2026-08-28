-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 1, Stage 4, Step 3 -- a real gap, found by CHECK FF itself, not by
-- re-reading code: "Teachers can view links for their institution"
-- (passport_institution_links SELECT, 0035) still requires
-- approved_by_parent = true, on top of its own (already-correct)
-- institution-membership check. This policy was NAMED in Step 0's own
-- recon consumer list (item 3, "link visibility itself") but never
-- actually included in Step 1's migration (0110) -- an oversight, not a
-- deliberate exclusion, and it went unnoticed until useTeacherPassports.ts's
-- own fix (Step 3) tried to read an unapproved link and got RLS-silent
-- nothing back, regardless of what the client-side filter was changed
-- to. The client fix alone was necessary but not sufficient: the
-- underlying policy independently enforced the identical restriction.
--
-- Fixed the same way as Step 1's four sites: drop only the "= true",
-- keep the institution-membership check exactly as it is. This makes
-- useTeacherPassports.ts's own query shape (already fixed, client-side,
-- in Step 3) actually able to see the row it's now asking for -- without
-- this, that fix was invisible, not wrong.
--
-- What this does NOT reopen: 0035's own original finding (C-10) was
-- that this policy had NO approved_by_parent filter at all originally,
-- letting any staff member see every passport_id that ever attempted a
-- link, approved or not -- described there as "disclosing which
-- children have requested a link even when the parent never consented
-- to it." That disclosure concern was about VISIBILITY OF THE ATTEMPT
-- ITSELF, at a time when "attempted but unapproved" meant "the parent
-- said no, or hasn't answered" with no other significance. Stage 4 has
-- since redefined what an unapproved link means structurally: it's no
-- longer a rejection state, it's the institution-matched EXISTENCE
-- signal 0110/0111 already use everywhere else as the real, current
-- boundary. Institution staff already have narrower, purpose-built RPCs
-- for the underlying data (get_institution_child_roster(), and now
-- get_passport_access_for_child()), both already confirmed unaffected
-- by approved_by_parent -- this policy change brings this table's own
-- direct-read policy into line with the same standard those RPCs
-- already established, not ahead of it.

alter policy "Teachers can view links for their institution"
  on public.passport_institution_links
  using (
    exists (
      select 1 from public.institution_staff s
      where s.institution_id = passport_institution_links.institution_id
        and s.user_id = auth.uid()
    )
  );
