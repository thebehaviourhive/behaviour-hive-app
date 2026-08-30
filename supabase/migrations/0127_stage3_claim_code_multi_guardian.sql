-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 2, Stage 3 -- found while running the new adversarial checks for
-- this stage (CHECK NN/OO), not from the design spec alone.
--
-- generate_passport_claim_code() (0114) has always refused to issue a
-- new code once a passport has any guardian at all, via a guard that
-- predates Stage 5 Step 3's multi-guardian support (0117/0118) and was
-- never revisited. It directly contradicts this stage's own
-- requirement that the three claim-code states coexist because a
-- child can have several guardians (a second code, for a co-parent,
-- after the first has already claimed). redeem_passport_claim_code()
-- itself already supports this correctly -- its own guard only blocks
-- the SAME user claiming twice, not a second, different guardian.
-- Only the generate side was stale.
--
-- Fix: drop that one guard. Everything else in the function --
-- standing check, institution-link check, the cross-institution
-- "already issued elsewhere" refusal, the atomic revoke-of-this-
-- institution's-own-prior-outstanding-code-on-reissue -- is unchanged,
-- reproduced verbatim from the live 0114 body.

drop function if exists public.generate_passport_claim_code(uuid, uuid);

create function public.generate_passport_claim_code(p_institution_id uuid, p_passport_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child_name text;
  v_prefix text;
  v_code text;
  v_found boolean := false;
  v_attempt int;
begin
  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.approved_at is not null
      and inst.status = 'verified'
  ) then
    raise exception 'Only an active, verified principal can generate a claim code.';
  end if;

  select p.child_name into v_child_name
  from public.passports p
  where p.id = p_passport_id
    and exists (
      select 1 from public.passport_institution_links pil
      where pil.passport_id = p.id and pil.institution_id = p_institution_id
    );

  if v_child_name is null then
    raise exception 'This child has no link to your institution.';
  end if;

  if exists (
    select 1 from public.passport_claim_codes cc
    where cc.passport_id = p_passport_id
      and cc.revoked_at is null
      and cc.claimed_at is null
      and cc.institution_id <> p_institution_id
  ) then
    raise exception 'A claim code for this child was already issued by a different school. Ask them to revoke it first.';
  end if;

  update public.passport_claim_codes
  set revoked_at = now(), revoked_by = auth.uid()
  where passport_id = p_passport_id
    and institution_id = p_institution_id
    and revoked_at is null
    and claimed_at is null;

  v_prefix := upper(left(regexp_replace(coalesce(v_child_name, 'CHD'), '[^a-zA-Z]', '', 'g') || 'XXX', 3));

  for v_attempt in 1..10 loop
    v_code := v_prefix || '-' || lpad(floor(random() * 10000)::int::text, 4, '0');
    if not exists (select 1 from public.passport_claim_codes where code = v_code) then
      v_found := true;
      exit;
    end if;
  end loop;

  if not v_found then
    raise exception 'Could not generate a unique code. Please try again.';
  end if;

  insert into public.passport_claim_codes (passport_id, institution_id, code, created_by, expires_at)
  values (p_passport_id, p_institution_id, v_code, auth.uid(), now() + interval '7 days');

  return v_code;
end;
$$;

grant execute on function public.generate_passport_claim_code(uuid, uuid) to authenticated;
