-- ============================================================================
-- Migration: SEC reports in Supabase + user_settings for API keys
-- Run this in: Supabase Dashboard > SQL Editor > New Query
-- ============================================================================

-- Drop old financial_reports if it exists with old schema
drop table if exists public.financial_reports;

-- 1. Financial reports (shared cache — no RLS, public XBRL data)
create table public.financial_reports (
  id text primary key,                           -- e.g. 'NKE_10-Q_2025-11-30'
  ticker text not null,
  source text not null default 'sec',
  report_type text not null,
  period_current text not null,
  period_previous text not null,
  report_date date,
  filed_date date,
  metrics jsonb not null default '{}',
  diagnosis jsonb not null default '{}',
  narrative text,
  fetched_at timestamptz default now(),
  expires_at timestamptz default (now() + interval '7 days')
);

create index idx_financial_reports_ticker on public.financial_reports(ticker);
create index idx_financial_reports_ticker_type on public.financial_reports(ticker, report_type);
create index idx_financial_reports_expires on public.financial_reports(expires_at);

-- Allow anyone (authenticated) to read reports — they're public financial data
alter table public.financial_reports enable row level security;

create policy "Anyone can read reports"
  on public.financial_reports for select
  using (true);

-- Only service role (server) can insert/update reports
-- (The anon/authenticated key can't write, only the server can)
create policy "Service role inserts reports"
  on public.financial_reports for insert
  with check (auth.role() = 'service_role');

create policy "Service role updates reports"
  on public.financial_reports for update
  using (auth.role() = 'service_role');

-- 2. User settings (per-user, RLS protected)
create table if not exists public.user_settings (
  user_id uuid references auth.users(id) on delete cascade primary key,
  gemini_api_key_enc text,
  preferences jsonb not null default '{}',
  updated_at timestamptz default now()
);

alter table public.user_settings enable row level security;

create policy "Users read own settings"
  on public.user_settings for select using (auth.uid() = user_id);
create policy "Users insert own settings"
  on public.user_settings for insert with check (auth.uid() = user_id);
create policy "Users update own settings"
  on public.user_settings for update using (auth.uid() = user_id);
create policy "Users delete own settings"
  on public.user_settings for delete using (auth.uid() = user_id);

-- Reuse existing updated_at trigger function
create trigger user_settings_updated_at
  before update on public.user_settings
  for each row execute function public.update_updated_at();
