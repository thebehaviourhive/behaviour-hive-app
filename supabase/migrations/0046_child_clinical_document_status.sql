/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   PARENT EXPERIENCE UPGRADE — Step 0: the one data addition the new
   Clinical Support card family needs. Existing RLS correctly hides a
   non-completed FBA from its own parent (fba_reports' parent SELECT
   policy is scoped to status = 'completed' only) -- exactly right for
   the reader, but the dashboard card still needs to know a DRAFT/
   IN_PROGRESS assessment exists at all, just not its content, so it can
   show "Dr. X is currently conducting the assessment" instead of
   silently looking identical to no assessment ever having started.

   One new SECURITY DEFINER RPC, metadata only, never content:

     get_child_clinical_document_status(p_passport_id uuid)
     returns document_type, status, fba_id, started_at, completed_at,
     is_approved -- for the most recently updated fba_reports row on
     this passport (there's realistically at most one active one at a
     time per the existing Stage-1 partial-unique-index rule, but this
     orders by updated_at desc and returns one row regardless, so a
     second FBA started after an earlier one completed still resolves
     to "the current one" correctly).

   - "Own auth check": owns_passport(p_passport_id) is ANDed into the
     WHERE clause itself, not just documented -- a caller who isn't this
     passport's parent gets zero rows back, full stop, the same
     enforcement shape as every other SECURITY DEFINER function in this
     schema (e.g. get_passport_clinical_content, migration 0043).
   - draft and in_progress both collapse to 'in_progress' for this
     status column -- the brief's own words ("drafts appear only as
     in_progress + started date"), since a parent has no reason to
     distinguish "not yet properly begun" from "actively being worked
     on" the way the clinician's own workspace does.
   - is_approved reuses the EXACT signal FbaCompletedPromptCard already
     uses today: whether any passport_clinical_content row exists for
     this fba_id. Not duplicated logic, the same authoritative check.
   - No content_data, no instrument responses, no scores -- only the
     four metadata columns named above. A row's mere ABSENCE (0 rows
     returned) is the signal "no FBA has ever been started for this
     child" -- states A/B are then told apart on the client by whether
     a clinician is connected at all (get_passport_clinicians, already
     used by the passport dashboard for exactly this), not by anything
     new here.
   - Shaped to accommodate BSP later (document_type is already a
     column, not assumed to always be 'fba') without needing to touch
     this function again -- a future bsp_reports table would just add a
     `union all` branch returning its own document_type = 'bsp' rows;
     nothing about today's single-branch shape has to change to make
     room for that. */

create or replace function public.get_child_clinical_document_status(p_passport_id uuid)
returns table (
  document_type text,
  status text,
  fba_id uuid,
  started_at timestamptz,
  completed_at timestamptz,
  is_approved boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    'fba'::text as document_type,
    case when fr.status = 'completed' then 'completed' else 'in_progress' end as status,
    fr.id as fba_id,
    fr.created_at as started_at,
    fr.completed_at,
    exists (
      select 1
      from public.passport_clinical_content pcc
      where pcc.source_document_type = 'fba_report'
        and pcc.source_document_id = fr.id
    ) as is_approved
  from public.fba_reports fr
  where fr.passport_id = p_passport_id
    and public.owns_passport(p_passport_id)
  order by fr.updated_at desc
  limit 1;
$$;

grant execute on function public.get_child_clinical_document_status(uuid) to authenticated;
