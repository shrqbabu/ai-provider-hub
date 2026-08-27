-- ============================================================================
-- Row Level Security
--
-- Model:  auth.uid() -> profiles(role='admin') -> projects.owner_id -> everything else
--
-- * RLS is enabled on EVERY exposed table (no table is left open).
-- * Authorization comes from public.profiles, which end users cannot write.
-- * Nested resources are reachable only through a project the caller owns.
-- * The service role (analytics worker) bypasses RLS and re-checks ownership
--   in application code — defence in depth, not a replacement.
-- ============================================================================

-- Helper: is the caller a registered admin?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'admin'
    );
$$;

-- Helper: does the caller own this project?
create or replace function public.owns_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.projects pr
        join public.profiles pf on pf.id = pr.owner_id
        where pr.id = p_project_id
          and pr.owner_id = auth.uid()
          and pf.role = 'admin'
    );
$$;

-- Helper: does the caller own the project behind this analysis run?
create or replace function public.owns_run(p_run_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.analysis_runs r
        where r.id = p_run_id
          and public.owns_project(r.project_id)
    );
$$;

revoke execute on function public.is_admin() from anon;
revoke execute on function public.owns_project(uuid) from anon;
revoke execute on function public.owns_run(uuid) from anon;

-- ---------------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.projects       enable row level security;
alter table public.datasets       enable row level security;
alter table public.dataset_tables enable row level security;
alter table public.analysis_runs  enable row level security;
alter table public.metrics        enable row level security;
alter table public.insights       enable row level security;
alter table public.dax_measures   enable row level security;
alter table public.artifacts      enable row level security;
alter table public.data_quality   enable row level security;
alter table public.audit_log      enable row level security;
alter table public.job_events     enable row level security;

alter table public.profiles       force row level security;
alter table public.projects       force row level security;

-- ---------------------------------------------------------------------------
-- profiles: readable only by its owner. No INSERT/UPDATE/DELETE policy exists,
-- so only the service role can create or change an admin record.
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
    for select to authenticated
    using (id = auth.uid());

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
drop policy if exists projects_select_own on public.projects;
create policy projects_select_own on public.projects
    for select to authenticated
    using (owner_id = auth.uid() and public.is_admin());

drop policy if exists projects_insert_own on public.projects;
create policy projects_insert_own on public.projects
    for insert to authenticated
    with check (owner_id = auth.uid() and public.is_admin());

drop policy if exists projects_update_own on public.projects;
create policy projects_update_own on public.projects
    for update to authenticated
    using (owner_id = auth.uid() and public.is_admin())
    with check (owner_id = auth.uid());

drop policy if exists projects_delete_own on public.projects;
create policy projects_delete_own on public.projects
    for delete to authenticated
    using (owner_id = auth.uid() and public.is_admin());

-- ---------------------------------------------------------------------------
-- datasets / dataset_tables
-- ---------------------------------------------------------------------------
drop policy if exists datasets_all_own on public.datasets;
create policy datasets_all_own on public.datasets
    for all to authenticated
    using (public.owns_project(project_id))
    with check (public.owns_project(project_id));

drop policy if exists dataset_tables_all_own on public.dataset_tables;
create policy dataset_tables_all_own on public.dataset_tables
    for all to authenticated
    using (exists (select 1 from public.datasets d
                   where d.id = dataset_id and public.owns_project(d.project_id)))
    with check (exists (select 1 from public.datasets d
                        where d.id = dataset_id and public.owns_project(d.project_id)));

-- ---------------------------------------------------------------------------
-- analysis runs (immutable: no UPDATE/DELETE policy for end users)
-- ---------------------------------------------------------------------------
drop policy if exists runs_select_own on public.analysis_runs;
create policy runs_select_own on public.analysis_runs
    for select to authenticated
    using (public.owns_project(project_id));

drop policy if exists runs_insert_own on public.analysis_runs;
create policy runs_insert_own on public.analysis_runs
    for insert to authenticated
    with check (public.owns_project(project_id));

-- ---------------------------------------------------------------------------
-- run children: read-only for the client; written by the worker (service role)
-- ---------------------------------------------------------------------------
drop policy if exists metrics_select_own on public.metrics;
create policy metrics_select_own on public.metrics
    for select to authenticated using (public.owns_run(analysis_run_id));

drop policy if exists insights_select_own on public.insights;
create policy insights_select_own on public.insights
    for select to authenticated using (public.owns_run(analysis_run_id));

drop policy if exists dax_select_own on public.dax_measures;
create policy dax_select_own on public.dax_measures
    for select to authenticated using (public.owns_run(analysis_run_id));

drop policy if exists quality_select_own on public.data_quality;
create policy quality_select_own on public.data_quality
    for select to authenticated using (public.owns_run(analysis_run_id));

drop policy if exists job_events_select_own on public.job_events;
create policy job_events_select_own on public.job_events
    for select to authenticated using (public.owns_run(analysis_run_id));

drop policy if exists artifacts_select_own on public.artifacts;
create policy artifacts_select_own on public.artifacts
    for select to authenticated using (public.owns_project(project_id));

-- ---------------------------------------------------------------------------
-- audit log: an admin may read only their own trail and may never write it
-- ---------------------------------------------------------------------------
drop policy if exists audit_select_own on public.audit_log;
create policy audit_select_own on public.audit_log
    for select to authenticated
    using (admin_id = auth.uid() and public.is_admin());

-- ---------------------------------------------------------------------------
-- Nothing is granted to anon.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
