-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- A real gap named directly by Daniel: a clinician could send a
-- reminder on an outstanding QABF/MAS request, but had no way to
-- withdraw one themselves -- the only thing that has ever cancelled a
-- request is finalize_fba_report() (0199), automatically, at the
-- moment the FBA is finalised. Nothing let a clinician say "I sent
-- this by mistake" or "I don't need this any more" while the FBA is
-- still in progress.
--
-- Column grants, not RLS, are why this needs an RPC rather than a
-- widened raw update: 0041's own "Clinicians can send reminders..."
-- UPDATE policy already authorizes the right caller (the FBA's own
-- clinician, verified, with active clinician_access to the child), but
-- the column-level GRANT alongside it is scoped to last_reminded_at
-- only. Widening that grant to include `status` would let the SAME
-- policy admit a status change to ANY value, from ANY current status
-- -- not just "sent/in_progress -> cancelled", which is the only
-- transition this feature means to allow. A SECURITY DEFINER function
-- enforces the specific transition directly, matching this schema's
-- own established pattern for "a column needs to be writable under a
-- narrower rule than its table's own RLS already expresses" (0239's
-- own header, verbatim).
create or replace function public.cancel_fba_instrument_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fba_clinician_id uuid;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  select fr.clinician_id, r.status
  into v_fba_clinician_id, v_status
  from public.fba_instrument_requests r
  join public.fba_reports fr on fr.id = r.fba_id
  where r.id = p_request_id;

  if v_fba_clinician_id is null then
    raise exception 'Request not found.';
  end if;

  if v_fba_clinician_id is distinct from auth.uid() then
    raise exception 'Only the clinician who owns this FBA can cancel a request on it.';
  end if;

  if v_status not in ('sent', 'in_progress') then
    raise exception 'Only an outstanding (sent or in-progress) request can be cancelled.';
  end if;

  update public.fba_instrument_requests
  set status = 'cancelled'
  where id = p_request_id;
end;
$$;

grant execute on function public.cancel_fba_instrument_request(uuid) to authenticated;

-- No change needed anywhere this status is READ -- get_my_instrument_
-- requests() (0291) already excludes any 'cancelled' row regardless of
-- how it got that way, so a manually-cancelled request clears the
-- recipient's own dashboard exactly like an auto-cancelled one always
-- has. get_fba_instrument_requests() (the clinician's own read) still
-- returns it, same as an auto-cancelled one, for InstrumentRequestChip
-- to render its own "Cancelled" state.
