/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   Gap found in real use: approve_clinician(email) generates the code and
   sets verification_status='verified' atomically, but nothing stopped a
   reviewer from approving a clinician the manual way instead -- editing
   verification_status directly in the Table Editor. That only changes the
   one column touched; it never runs the code-generation logic, which only
   lives inside the function. Result: a "verified" clinician stuck with
   clinician_code = NULL, and no code for a parent to enter, no matter how
   many times the row is re-saved by hand.

   Fix: a BEFORE INSERT OR UPDATE trigger that generates a code itself
   whenever a row is about to be verification_status = 'verified' with
   clinician_code still null -- regardless of whether that happened via
   approve_clinician(), a direct Table Editor edit, or any other future
   path. This doesn't weaken the review gate from migration 0029/0030 (a
   human still has to change verification_status to 'verified' one way or
   another); it only guarantees the code always gets generated the moment
   that happens, closing exactly the gap above.

   approve_clinician() itself is untouched and keeps generating the code
   in the same statement as before -- when it runs, clinician_code is
   already non-null by the time this trigger's BEFORE check evaluates the
   row, so the two don't double-generate or conflict. */

create or replace function public.ensure_clinician_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.verification_status = 'verified' and new.clinician_code is null then
    loop
      new.clinician_code := 'CL-' || upper(substr(md5(random()::text), 1, 4));
      exit when not exists (
        select 1 from public.clinicians
        where clinician_code = new.clinician_code
          and id is distinct from new.id
      );
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists ensure_clinician_code_on_verify on public.clinicians;
create trigger ensure_clinician_code_on_verify
  before insert or update on public.clinicians
  for each row
  execute function public.ensure_clinician_code();
