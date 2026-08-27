-- ============================================================================
-- Data Analytics AI Agent — core schema
-- Admin-only analytics workspace. Every table is RLS-protected and ownership
-- is derived from `profiles`, which is NOT writable by end users.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles : the single server-controlled authorization record
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
    id          uuid primary key references auth.users (id) on delete cascade,
    email       text not null,
    role        text not null default 'admin' check (role in ('admin')),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

comment on table public.profiles is
    'Server-controlled admin registry. Rows may only be created/updated by the service role. '
    'Authorization must never be derived from auth.users.user_metadata.';

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
    id           uuid primary key default gen_random_uuid(),
    owner_id     uuid not null references public.profiles (id) on delete cascade,
    name         text not null check (length(btrim(name)) between 1 and 120),
    description  text not null default '',
    source_type  text not null default 'csv' check (source_type in ('csv', 'excel', 'sql')),
    status       text not null default 'draft'
                 check (status in ('draft','ready','queued','running','completed','validation_failed','failed','cancelled')),
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    last_run_at  timestamptz
);

create index if not exists idx_projects_owner_updated on public.projects (owner_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- datasets
-- ---------------------------------------------------------------------------
create table if not exists public.datasets (
    id            uuid primary key default gen_random_uuid(),
    project_id    uuid not null references public.projects (id) on delete cascade,
    name          text not null,
    source_type   text not null check (source_type in ('csv','excel','sql')),
    storage_path  text not null default '',
    file_size     bigint not null default 0,
    mime_type     text,
    row_count     bigint not null default 0,
    column_count  integer not null default 0,
    schema        jsonb not null default '{}'::jsonb,
    sql_config    jsonb,
    checksum      text,
    created_at    timestamptz not null default now()
);

create index if not exists idx_datasets_project on public.datasets (project_id, created_at desc);

create table if not exists public.dataset_tables (
    id          uuid primary key default gen_random_uuid(),
    dataset_id  uuid not null references public.datasets (id) on delete cascade,
    table_name  text not null,
    grain       text not null default '',
    row_count   bigint not null default 0,
    schema      jsonb not null default '{}'::jsonb,
    created_at  timestamptz not null default now()
);

create index if not exists idx_dataset_tables_dataset on public.dataset_tables (dataset_id);

-- ---------------------------------------------------------------------------
-- analysis runs (immutable history)
-- ---------------------------------------------------------------------------
create table if not exists public.analysis_runs (
    id             uuid primary key default gen_random_uuid(),
    project_id     uuid not null references public.projects (id) on delete cascade,
    status         text not null default 'queued'
                   check (status in ('queued','running','completed','validation_failed','failed','cancelled')),
    stage          text not null default 'profiling',
    stage_key      text,
    stage_label    text,
    progress       integer not null default 0 check (progress between 0 and 100),
    user_prompt    text not null,
    plan           jsonb,
    report         jsonb,
    validation     jsonb,
    dax_summary    jsonb,
    unsupported    jsonb,
    llm_usage      jsonb,
    stage_timings  jsonb,
    metric_count   integer not null default 0,
    insight_count  integer not null default 0,
    duration_ms    integer,
    started_at     timestamptz,
    completed_at   timestamptz,
    error          jsonb,
    created_at     timestamptz not null default now()
);

create index if not exists idx_runs_project on public.analysis_runs (project_id, created_at desc);
create index if not exists idx_runs_status on public.analysis_runs (status) where status in ('queued','running');

-- ---------------------------------------------------------------------------
-- metric registry (single source of truth)
-- ---------------------------------------------------------------------------
create table if not exists public.metrics (
    id                 uuid primary key default gen_random_uuid(),
    analysis_run_id    uuid not null references public.analysis_runs (id) on delete cascade,
    metric_id          text not null,
    name               text not null,
    definition         text not null default '',
    formula            text not null default '',
    value              jsonb,
    source             jsonb not null default '{}'::jsonb,
    validation_status  text not null default 'unverified'
                       check (validation_status in ('valid','unverified','failed','not_supported')),
    created_at         timestamptz not null default now(),
    unique (analysis_run_id, metric_id)
);

create index if not exists idx_metrics_run on public.metrics (analysis_run_id);

-- ---------------------------------------------------------------------------
-- insights
-- ---------------------------------------------------------------------------
create table if not exists public.insights (
    id                 uuid primary key default gen_random_uuid(),
    analysis_run_id    uuid not null references public.analysis_runs (id) on delete cascade,
    title              text not null,
    finding            text not null,
    evidence           jsonb not null default '{}'::jsonb,
    interpretation     text not null default '',
    business_impact    text not null default '',
    recommendation     text not null default '',
    confidence         text not null default 'medium' check (confidence in ('high','medium','low')),
    priority           text not null default 'medium' check (priority in ('critical','high','medium','low')),
    validation_status  text not null default 'unverified',
    created_at         timestamptz not null default now()
);

create index if not exists idx_insights_run on public.insights (analysis_run_id);

-- ---------------------------------------------------------------------------
-- DAX
-- ---------------------------------------------------------------------------
create table if not exists public.dax_measures (
    id                 uuid primary key default gen_random_uuid(),
    analysis_run_id    uuid not null references public.analysis_runs (id) on delete cascade,
    name               text not null,
    dax_code           text not null,
    purpose            text not null default '',
    group_name         text not null default 'Advanced Measures',
    kind               text not null default 'measure' check (kind in ('measure','calculated_column','calculated_table')),
    dependencies       jsonb not null default '[]'::jsonb,
    validation_status  text not null default 'unverified'
                       check (validation_status in ('valid','warning','failed','unverified')),
    validation_errors  jsonb not null default '[]'::jsonb,
    created_at         timestamptz not null default now()
);

create index if not exists idx_dax_run on public.dax_measures (analysis_run_id);

-- ---------------------------------------------------------------------------
-- artifacts
-- ---------------------------------------------------------------------------
create table if not exists public.artifacts (
    id               uuid primary key default gen_random_uuid(),
    project_id       uuid not null references public.projects (id) on delete cascade,
    analysis_run_id  uuid references public.analysis_runs (id) on delete cascade,
    artifact_type    text not null check (artifact_type in ('report','dax','dashboard_png','data_quality')),
    bucket           text not null default 'project-artifacts',
    storage_path     text not null,
    file_name        text not null,
    mime_type        text not null default 'application/octet-stream',
    file_size        bigint not null default 0,
    checksum         text,
    created_at       timestamptz not null default now()
);

create index if not exists idx_artifacts_run on public.artifacts (analysis_run_id);
create index if not exists idx_artifacts_project on public.artifacts (project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- data quality
-- ---------------------------------------------------------------------------
create table if not exists public.data_quality (
    id               uuid primary key default gen_random_uuid(),
    analysis_run_id  uuid not null references public.analysis_runs (id) on delete cascade,
    score            numeric(5,2),
    completeness     jsonb,
    validity         jsonb,
    consistency      jsonb,
    uniqueness       jsonb,
    relationships    jsonb,
    issues           jsonb,
    created_at       timestamptz not null default now()
);

create index if not exists idx_quality_run on public.data_quality (analysis_run_id);

-- ---------------------------------------------------------------------------
-- audit log + job observability
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
    id               uuid primary key default gen_random_uuid(),
    admin_id         uuid references public.profiles (id) on delete set null,
    action           text not null,
    project_id       uuid,
    analysis_run_id  uuid,
    metadata         jsonb not null default '{}'::jsonb,
    created_at       timestamptz not null default now()
);

create index if not exists idx_audit_admin on public.audit_log (admin_id, created_at desc);

create table if not exists public.job_events (
    id               uuid primary key default gen_random_uuid(),
    analysis_run_id  uuid not null references public.analysis_runs (id) on delete cascade,
    stage            text not null,
    status           text not null default 'completed',
    duration_ms      integer,
    metadata         jsonb not null default '{}'::jsonb,
    created_at       timestamptz not null default now()
);

create index if not exists idx_job_events_run on public.job_events (analysis_run_id, created_at);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_projects_updated on public.projects;
create trigger trg_projects_updated
    before update on public.projects
    for each row execute function public.touch_updated_at();

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated
    before update on public.profiles
    for each row execute function public.touch_updated_at();
