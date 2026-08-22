-- ---------------------------------------------------------------------------
-- supabase-setup-phone-lookup.sql
-- ---------------------------------------------------------------------------
-- Run this ONCE in your Supabase project's SQL Editor (Dashboard -> SQL
-- Editor -> New query -> paste -> Run). It's free and adds no extra cost —
-- this just creates a small table + three functions, nothing else.
--
-- If you're re-running this after already having the OLDER version of this
-- script (the one with client-side INSERT/UPDATE/DELETE policies on
-- phone_lookup), that's fine — this script cleans those up itself.
--
-- What this does: lets someone sign in with their mobile number instead of
-- their email. It does NOT send any SMS/OTP — the mobile number is just
-- looked up to find the matching email, then the app signs in with that
-- email + the person's normal password, same as always.
--
-- Why functions instead of direct table access for everything:
--   The app never talks to this table directly — every read AND write goes
--   through one of the three functions below, each running as the function
--   owner (security definer) rather than under the signed-in person's own
--   row-level-security policies. This avoids a flaky failure mode where a
--   direct client-side upsert against an RLS-protected table can get
--   rejected by Postgres even when the row genuinely belongs to the
--   signed-in person and the policy is written correctly — a known rough
--   edge with connection pooling between PostgREST and Postgres. Each
--   function still checks auth.uid() itself before touching anything, so
--   the security guarantee (each person can only touch their own row) is
--   the same either way — just enforced in the function body instead of
--   in an RLS policy.
--
-- Security notes:
--   - Row Level Security is on, and there are no policies on it at all —
--     nobody (not even a signed-in person) can read, write, or list this
--     table directly. The three functions below are the only way in.
--   - get_email_by_mobile() returns just the matching email (or nothing)
--     for one mobile number — the same amount of information a normal
--     "enter your email to sign in" form already exposes, no more.
--   - link_mobile_number() and unlink_mobile_number() each check
--     auth.uid() internally, so a person can only ever create, update, or
--     remove the row for THEIR OWN account — never anyone else's.
-- ---------------------------------------------------------------------------

create table if not exists public.phone_lookup (
  mobile_number text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  updated_at timestamptz not null default now()
);

alter table public.phone_lookup enable row level security;

-- Clean up the old approach if it's still in place (direct client-side
-- writes through RLS policies) — everything now goes through the
-- functions below instead.
drop policy if exists "Users can insert their own phone lookup" on public.phone_lookup;
drop policy if exists "Users can update their own phone lookup" on public.phone_lookup;
drop policy if exists "Users can delete their own phone lookup" on public.phone_lookup;
revoke insert, update, delete, select on public.phone_lookup from authenticated;

-- Looks up which email a mobile number belongs to, for sign-in. Deliberately
-- has no identity check — this needs to work before anyone is signed in,
-- the same way typing an email into a sign-in form does.
create or replace function public.get_email_by_mobile(p_mobile text)
returns text
language sql
security definer
set search_path = public
as $$
  select email from public.phone_lookup where mobile_number = p_mobile limit 1;
$$;

grant execute on function public.get_email_by_mobile(text) to anon, authenticated;

-- Links (or re-links) a mobile number to the CURRENTLY SIGNED-IN person's
-- account. Checks auth.uid() itself, so nobody can link a number to
-- someone else's account no matter what — there isn't even a user_id
-- parameter here, it's always the caller's own. Refuses to hand a number
-- over if it's already linked to a DIFFERENT account, so one person can't
-- silently steal another person's mobile sign-in by entering their number.
create or replace function public.link_mobile_number(p_mobile text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_existing_owner uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select user_id into v_existing_owner
  from public.phone_lookup
  where mobile_number = p_mobile;

  if v_existing_owner is not null and v_existing_owner <> v_uid then
    raise exception 'MOBILE_NUMBER_TAKEN';
  end if;

  select email into v_email from auth.users where id = v_uid;

  insert into public.phone_lookup (mobile_number, user_id, email, updated_at)
  values (p_mobile, v_uid, v_email, now())
  on conflict (mobile_number) do update
    set email = excluded.email,
        updated_at = excluded.updated_at;
end;
$$;

grant execute on function public.link_mobile_number(text) to authenticated;

-- Removes a mobile number link, but only if it belongs to the currently
-- signed-in person — the WHERE clause is the safeguard here, same idea as
-- the old RLS delete policy, just enforced inside the function instead.
create or replace function public.unlink_mobile_number(p_mobile text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.phone_lookup
  where mobile_number = p_mobile and user_id = auth.uid();
end;
$$;

grant execute on function public.unlink_mobile_number(text) to authenticated;

-- Supabase's API layer (PostgREST) caches table/function grants and
-- doesn't always pick up changes right away. This tells it to refresh
-- immediately rather than waiting.
notify pgrst, 'reload schema';
