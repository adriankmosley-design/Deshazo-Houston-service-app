-- Job Files app: database and file storage setup.
-- Paste this whole file into Supabase -> SQL Editor -> New query, then click Run.
-- It is safe to run more than once.

-- Jobs ----------------------------------------------------------------------
create table if not exists public.jobs (
  id            uuid primary key default gen_random_uuid(),
  job_number    text not null unique,
  customer      text not null,
  site_address  text,
  contact_name  text,
  contact_phone text,
  contact_email text,
  crane_make    text,
  capacity      text,
  serial_number text,
  status        text not null default 'Open'
                check (status in ('Open', 'Quoted', 'In progress', 'Closed')),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists jobs_touch_updated_at on public.jobs;
create trigger jobs_touch_updated_at
  before update on public.jobs
  for each row execute function public.touch_updated_at();

-- Files attached to a job -----------------------------------------------------
create table if not exists public.job_files (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references public.jobs(id) on delete cascade,
  category     text not null
               check (category in ('Service reports', 'Inspection reports', 'Quotes',
                                   'Parts pricing', 'Photos', 'Letters', 'Other')),
  file_name    text not null,
  storage_path text not null unique,
  size_bytes   bigint,
  mime_type    text,
  uploaded_by  text,
  created_at   timestamptz not null default now()
);

create index if not exists job_files_job_id_idx on public.job_files(job_id);

-- Only signed-in staff can read or change anything -------------------------
alter table public.jobs      enable row level security;
alter table public.job_files enable row level security;

drop policy if exists "staff full access" on public.jobs;
create policy "staff full access" on public.jobs
  for all to authenticated using (true) with check (true);

drop policy if exists "staff full access" on public.job_files;
create policy "staff full access" on public.job_files
  for all to authenticated using (true) with check (true);

-- Private storage bucket for the files themselves ----------------------------
insert into storage.buckets (id, name, public)
values ('job-files', 'job-files', false)
on conflict (id) do nothing;

drop policy if exists "staff read job files"   on storage.objects;
drop policy if exists "staff upload job files" on storage.objects;
drop policy if exists "staff delete job files" on storage.objects;

create policy "staff read job files" on storage.objects
  for select to authenticated using (bucket_id = 'job-files');
create policy "staff upload job files" on storage.objects
  for insert to authenticated with check (bucket_id = 'job-files');
create policy "staff delete job files" on storage.objects
  for delete to authenticated using (bucket_id = 'job-files');

-- Added later: the "Service reports" folder. Safe to run on an existing database.
alter table public.job_files drop constraint if exists job_files_category_check;
alter table public.job_files add constraint job_files_category_check
  check (category in ('Service reports', 'Inspection reports', 'Quotes',
                      'Parts pricing', 'Photos', 'Letters', 'Other'));

-- Emails folder (saved from Outlook). Safe to run again.
alter table public.job_files drop constraint if exists job_files_category_check;
alter table public.job_files add constraint job_files_category_check
  check (category in ('Service reports', 'Inspection reports', 'Quotes',
                      'Parts pricing', 'Photos', 'Letters', 'Emails', 'Other'));

-- A job never holds two files with the same name. Safe to run again.
create unique index if not exists job_files_job_name_unique
  on public.job_files (job_id, lower(file_name));
