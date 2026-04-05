-- ============================================================================
-- Plazafolio — Supabase Schema
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- ============================================================================

-- 1. Assets table (portfolio items)
create table if not exists public.assets (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  ticker text not null,
  name text not null,
  category text not null check (category in ('actives', 'watchlist')),
  price numeric default 0,
  image text,
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  -- One ticker per user (no duplicates)
  unique(user_id, ticker)
);

-- 2. Analysis cache table (ranking data + full analysis)
create table if not exists public.analyses (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  ticker text not null,
  years integer not null default 12,
  last_updated date not null default current_date,
  indicators jsonb,
  projection jsonb,
  dividends jsonb,
  profile jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique(user_id, ticker)
);

-- 3. Indexes for fast lookups
create index if not exists idx_assets_user on public.assets(user_id);
create index if not exists idx_assets_user_category on public.assets(user_id, category);
create index if not exists idx_analyses_user on public.analyses(user_id);
create index if not exists idx_analyses_user_ticker on public.analyses(user_id, ticker);

-- 4. Auto-update updated_at
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger assets_updated_at
  before update on public.assets
  for each row execute function public.update_updated_at();

create trigger analyses_updated_at
  before update on public.analyses
  for each row execute function public.update_updated_at();

-- 5. Row Level Security (RLS)
alter table public.assets enable row level security;
alter table public.analyses enable row level security;

-- Users can only see/modify their own data
create policy "Users read own assets"
  on public.assets for select
  using (auth.uid() = user_id);

create policy "Users insert own assets"
  on public.assets for insert
  with check (auth.uid() = user_id);

create policy "Users update own assets"
  on public.assets for update
  using (auth.uid() = user_id);

create policy "Users delete own assets"
  on public.assets for delete
  using (auth.uid() = user_id);

create policy "Users read own analyses"
  on public.analyses for select
  using (auth.uid() = user_id);

create policy "Users insert own analyses"
  on public.analyses for insert
  with check (auth.uid() = user_id);

create policy "Users update own analyses"
  on public.analyses for update
  using (auth.uid() = user_id);

create policy "Users delete own analyses"
  on public.analyses for delete
  using (auth.uid() = user_id);

-- 6. Service role policy for cron/edge functions
-- The service_role key bypasses RLS, so no extra policy needed.
-- Edge Functions use SUPABASE_SERVICE_ROLE_KEY to update all users' analyses.

-- ============================================================================
-- 7. CRON: Run update-analyses every 8 hours
--    IMPORTANT: Before running this, ensure:
--    a) pg_cron and pg_net extensions are enabled (Database > Extensions in dashboard)
--    b) The Edge Function is deployed:
--       supabase functions deploy update-analyses --no-verify-jwt
--    c) Replace YOUR_PROJECT_REF and YOUR_SERVICE_ROLE_KEY below
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove previous schedule if exists
select cron.unschedule('update-analyses-periodic')
  where exists (select 1 from cron.job where jobname = 'update-analyses-periodic');

-- Schedule every 8 hours (00:00, 08:00, 16:00 UTC)
select cron.schedule(
  'update-analyses-periodic',
  '0 */8 * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/update-analyses',
    headers := jsonb_build_object(
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ============================================================================
-- 8. SEC / Financial reports cache (Phase 1: SEC EDGAR, extensible to others)
--    Shared across all users — XBRL data is public, no RLS needed
-- ============================================================================
create table if not exists public.financial_reports (
  id text primary key,                           -- e.g. 'NKE_10-Q_2025-11-30'
  ticker text not null,
  source text not null default 'sec',            -- 'sec', 'cnmv', 'lse', etc.
  report_type text not null,                     -- '10-K', '10-Q', etc.
  period_current text not null,                  -- e.g. 'Q1 2026' or 'FY2025'
  period_previous text not null,                 -- e.g. 'Q4 2025' or 'FY2024'
  report_date date,                              -- end of reporting period
  filed_date date,                               -- SEC filing date
  metrics jsonb not null default '{}',           -- { revenue: {label,current,previous,change,...}, ... }
  diagnosis jsonb not null default '{}',         -- { summary, signals: [...] }
  narrative text,                                -- LLM-generated analysis (nullable)
  fetched_at timestamptz default now(),
  expires_at timestamptz default (now() + interval '7 days')
);

create index if not exists idx_financial_reports_ticker on public.financial_reports(ticker);
create index if not exists idx_financial_reports_ticker_type on public.financial_reports(ticker, report_type);
create index if not exists idx_financial_reports_expires on public.financial_reports(expires_at);

-- 9. User settings (API keys, preferences — per user, RLS protected)
-- ============================================================================
create table if not exists public.user_settings (
  user_id uuid references auth.users(id) on delete cascade primary key,
  gemini_api_key_enc text,                       -- encrypted with user-derived key
  preferences jsonb not null default '{}',       -- future: theme, language, etc.
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

create trigger user_settings_updated_at
  before update on public.user_settings
  for each row execute function public.update_updated_at();
