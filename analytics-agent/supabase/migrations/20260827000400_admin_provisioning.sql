-- ============================================================================
-- Admin provisioning
--
-- There is NO public signup. An admin account is created out-of-band and then
-- registered here with the service role. Run this in the Supabase SQL editor
-- (which uses the service role) after creating the user in Auth.
--
--   1. Supabase Dashboard → Authentication → Users → "Add user"
--      (email + password, "Auto Confirm User" on)
--   2. Copy the user's UUID
--   3. select public.register_admin('<uuid>', 'admin@yourcompany.com');
--
-- Removing an admin:
--   select public.revoke_admin('<uuid>');
-- ============================================================================

create or replace function public.register_admin(p_user_id uuid, p_email text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
    result public.profiles;
begin
    if not exists (select 1 from auth.users u where u.id = p_user_id) then
        raise exception 'No auth user with id %. Create the user in Supabase Auth first.', p_user_id;
    end if;

    insert into public.profiles (id, email, role)
    values (p_user_id, lower(btrim(p_email)), 'admin')
    on conflict (id) do update
        set email = excluded.email,
            role = 'admin',
            updated_at = now()
    returning * into result;

    insert into public.audit_log (admin_id, action, metadata)
    values (p_user_id, 'ADMIN_REGISTERED', jsonb_build_object('email', lower(btrim(p_email))));

    return result;
end;
$$;

create or replace function public.revoke_admin(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from public.profiles where id = p_user_id;
    insert into public.audit_log (admin_id, action, metadata)
    values (null, 'ADMIN_REVOKED', jsonb_build_object('user_id', p_user_id));
    return true;
end;
$$;

-- These are service-role operations only.
revoke execute on function public.register_admin(uuid, text) from anon, authenticated;
revoke execute on function public.revoke_admin(uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Guard: block public signups from silently creating an authorized profile.
-- A new auth user gets NO profile row, therefore no access, until an operator
-- explicitly calls register_admin().
-- ---------------------------------------------------------------------------
comment on function public.register_admin(uuid, text) is
    'Service-role only. The single supported way to authorize an admin account.';
