begin;
-- Own-account lookup through the JWT-verified Data API, without consuming Auth /user quotas.
-- No supplied user ID, no account directory, and no duplicate identity store.
create function public.current_account()
returns table(id uuid, email text, email_confirmed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select u.id, u.email::text, u.email_confirmed_at
  from auth.users u
  where u.id = (select auth.uid())
    and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= now());
$$;
revoke all on function public.current_account() from public, anon, authenticated, service_role;
grant execute on function public.current_account() to authenticated;
commit;
