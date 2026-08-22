-- ---------------------------------------------------------------------------
-- supabase-setup-phone-lookup.sql
-- ---------------------------------------------------------------------------
-- Run this ONCE in your Supabase project's SQL Editor (Dashboard -> SQL
-- Editor -> New query -> paste -> Run). It's free and adds no extra cost —
-- this just creates a small table + one function, nothing else.
--
-- What this does: lets someone sign in with their mobile number instead of
-- their email. It does NOT send any SMS/OTP — the mobile number is just
-- looked up to find the matching email, then the app signs in with that
-- email + the person's normal password, same as always.
--
-- Security notes:
--   - Row Level Security is on, and there's no SELECT policy at all, so
--     nobody can browse/list the table directly, even signed in.
--   - The only way to read anything is the get_email_by_mobile() function
--     below, which takes one mobile number and returns just the matching
--     email (or nothing) — the same amount of information a normal "enter
--     your email to sign in" form already exposes, no more.
--   - Each person can only insert/update their OWN row (enforced by
--     matching auth.uid() to the row's user_id).
-- ---------------------------------------------------------------------------

create table if not exists public.phone_lookup (
  mobile_number text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  updated_at timestamptz not null default now()
);

alter table public.phone_lookup enable row level security;

-- Each person may only create/update the row that maps THEIR OWN account's
-- mobile number -> email. No one can write a row for someone else's account.
drop policy if exists "Users can insert their own phone lookup" on public.phone_lookup;
create policy "Users can insert their own phone lookup"
  on public.phone_lookup
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own phone lookup" on public.phone_lookup;
create policy "Users can update their own phone lookup"
  on public.phone_lookup
  for update
  using (auth.uid() = user_id);

drop policy if exists "Users can delete their own phone lookup" on public.phone_lookup;
create policy "Users can delete their own phone lookup"
  on public.phone_lookup
  for delete
  using (auth.uid() = user_id);

-- RLS policies alone only control WHICH rows a role can touch — Postgres
-- checks table-level privileges FIRST, and without an explicit GRANT here,
-- "authenticated" has no permission to write to this table at all, so
-- every insert/update/delete is silently blocked before RLS ever runs.
grant insert, update, delete on public.phone_lookup to authenticated;

-- The app's linkMobileNumber() uses an upsert (INSERT ... ON CONFLICT DO
-- UPDATE) so re-saving the same number doesn't create duplicate rows.
-- PostgreSQL requires SELECT privilege on the table to even attempt an
-- ON CONFLICT check, independent of RLS — without it, every upsert fails
-- with "new row violates row-level security policy", which looks like an
-- RLS bug but is actually this missing grant. This does NOT let anyone
-- browse the table's contents: there's still no SELECT *policy* below, so
-- RLS continues to block all direct reads either way.
grant select on public.phone_lookup to authenticated;

-- Deliberately no SELECT policy — direct table reads are blocked for
-- everyone. Lookups only happen through this function, which returns just
-- an email string (or null), for exactly one mobile number at a time.
create or replace function public.get_email_by_mobile(p_mobile text)
returns text
language sql
security definer
set search_path = public
as $$
  select email from public.phone_lookup where mobile_number = p_mobile limit 1;
$$;

grant execute on function public.get_email_by_mobile(text) to anon, authenticated;

-- Supabase's API layer (PostgREST) caches table grants/policies and doesn't
-- always pick up GRANT/policy changes right away. Without this, mobile
-- sign-in linking can keep failing with a confusing "row-level security"
-- error for a while after running this script, even though everything
-- above is correct. This tells it to refresh immediately.
notify pgrst, 'reload schema';
