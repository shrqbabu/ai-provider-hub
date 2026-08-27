-- ============================================================================
-- Private storage buckets + per-owner path isolation
--
-- Layout enforced by the backend and re-checked here:
--     <bucket>/<owner_id>/<project_id>/...
--
-- The first path segment MUST equal auth.uid(), so one admin can never read or
-- write another admin's objects even with a stolen object path.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
    ('project-inputs',    'project-inputs',    false, 536870912, null),
    ('project-artifacts', 'project-artifacts', false, 268435456, null),
    ('dashboard-images',  'dashboard-images',  false, 268435456, array['image/png']),
    ('reports',           'reports',           false, 268435456, null)
on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit;

-- ---------------------------------------------------------------------------
create or replace function storage.analytics_path_is_own(p_name text)
returns boolean
language sql
stable
as $$
    select (storage.foldername(p_name))[1] = auth.uid()::text;
$$;

-- ---------------------------------------------------------------------------
-- One policy set per bucket. SELECT + INSERT for the owner; UPDATE/DELETE are
-- deliberately restricted to the service role (cleanup runs in the worker).
-- ---------------------------------------------------------------------------
do $$
declare
    b text;
begin
    foreach b in array array['project-inputs', 'project-artifacts', 'dashboard-images', 'reports']
    loop
        execute format('drop policy if exists %I on storage.objects', b || '_select_own');
        execute format($f$
            create policy %I on storage.objects
                for select to authenticated
                using (
                    bucket_id = %L
                    and storage.analytics_path_is_own(name)
                    and public.is_admin()
                )
        $f$, b || '_select_own', b);

        execute format('drop policy if exists %I on storage.objects', b || '_insert_own');
        execute format($f$
            create policy %I on storage.objects
                for insert to authenticated
                with check (
                    bucket_id = %L
                    and storage.analytics_path_is_own(name)
                    and public.is_admin()
                )
        $f$, b || '_insert_own', b);
    end loop;
end
$$;

-- No policies are created for the `anon` role: private buckets stay private and
-- downloads must go through signed URLs issued by the backend.
