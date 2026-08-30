-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 2, Stage 3 -- the pending claim-code state needs "revoke with a
-- reason", and neither half of that exists today. Checked before
-- writing this, not assumed from the design spec alone:
--
-- 1. get_passport_claim_code_status() (0114) returns (code, expires_at)
--    only -- no id at all. revoke_passport_claim_code() takes the
--    code's own id. There is nothing in the client's hands to call it
--    with. This is CLAUDE.md's own named loose end from Stage 5 Step 3
--    ("revoke_passport_claim_code() still has no client caller
--    anywhere") -- true because this was structurally impossible to
--    wire up before now, not an oversight in the client.
-- 2. passport_claim_codes (0114) has revoked_at/revoked_by but no
--    revocation_reason column at all -- "revoke with a reason" needs
--    somewhere to put the reason.
-- 3. revoke_passport_claim_code() itself takes only p_claim_code_id,
--    no reason parameter, and hand-writes its own institution_staff
--    standing check inline instead of calling
--    institution_staff_has_current_standing() (0105) -- the "nine
--    lineages" rule (CLAUDE.md) applies to any new code touching this
--    check, and this function is being touched now.
--
-- Three changes:
--   a. passport_claim_codes gets a revocation_reason column.
--   b. get_passport_claim_code_status() widened to also return the
--      code's own id (DROP + CREATE -- column list change).
--   c. revoke_passport_claim_code() gets a required p_reason parameter
--      (same empty-string-rejected pattern as revoke_clinician_access()/
--      revoke_passport_access()), stores it, and its own standing check
--      now calls institution_staff_has_current_standing() instead of
--      the hand-written inline version. The old 1-argument signature is
--      dropped explicitly -- leaving it live alongside a new 2-argument
--      overload would mean a caller could still revoke with no reason
--      at all, silently bypassing the new requirement.

alter table public.passport_claim_codes
  add column revocation_reason text;

drop function if exists public.get_passport_claim_code_status(uuid, uuid);

create function public.get_passport_claim_code_status(p_institution_id uuid, p_passport_id uuid)
returns table (id uuid, code text, expires_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select cc.id, cc.code, cc.expires_at
  from public.passport_claim_codes cc
  where cc.passport_id = p_passport_id
    and cc.institution_id = p_institution_id
    and cc.revoked_at is null
    and cc.claimed_at is null
    and cc.expires_at > now()
    and exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = p_institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and s.deactivated_at is null
        and s.approved_at is not null
        and inst.status = 'verified'
    );
$$;

grant execute on function public.get_passport_claim_code_status(uuid, uuid) to authenticated;

drop function if exists public.revoke_passport_claim_code(uuid);

create function public.revoke_passport_claim_code(p_claim_code_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_institution_id uuid;
  v_claimed_at timestamptz;
  v_revoked_at timestamptz;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required.';
  end if;

  select cc.institution_id, cc.claimed_at, cc.revoked_at
  into v_institution_id, v_claimed_at, v_revoked_at
  from public.passport_claim_codes cc
  where cc.id = p_claim_code_id;

  if v_institution_id is null then
    raise exception 'Not found.';
  end if;

  if not public.institution_staff_has_current_standing(auth.uid(), v_institution_id)
     or not exists (
       select 1 from public.institution_staff s
       where s.institution_id = v_institution_id
         and s.user_id = auth.uid()
         and s.role = 'principal'
     )
  then
    raise exception 'Only an active, verified principal at the institution that issued this code can revoke it.';
  end if;

  if v_claimed_at is not null then
    raise exception 'This code has already been claimed and cannot be revoked.';
  end if;

  if v_revoked_at is not null then
    raise exception 'This code has already been revoked.';
  end if;

  update public.passport_claim_codes
  set revoked_at = now(), revoked_by = auth.uid(), revocation_reason = trim(p_reason)
  where id = p_claim_code_id;
end;
$$;

grant execute on function public.revoke_passport_claim_code(uuid, text) to authenticated;
