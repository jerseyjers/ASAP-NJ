-- ASAP NJ client portal schema (run in Supabase SQL editor)

create table if not exists public.client_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  report_id text,
  title text not null,
  site_label text,
  date date default current_date,
  service_type text,
  status text default 'ready', -- ready | draft | due
  amount_due numeric(10,2) default 0,
  amount_paid numeric(10,2) default 0,
  payment_link text,
  summary text,
  file_url text,
  file_label text default 'Download report',
  created_at timestamptz default now()
);

alter table public.client_reports enable row level security;

create policy "Clients read own reports"
  on public.client_reports
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Optional: allow clients to see only; inserts/updates via service role / dashboard
create policy "No client writes"
  on public.client_reports
  for insert
  to authenticated
  with check (false);

-- Storage: create private bucket "client-reports" in UI, then:
-- storage policies so authenticated users can read objects under their uid/ prefix
-- Example path: client-reports/{user_id}/report.pdf
