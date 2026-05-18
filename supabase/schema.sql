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
  cash_flow jsonb,
  fundamentals jsonb,
  score numeric,
  current_rank integer,
  previous_rank integer,
  rank_updated_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique(user_id, ticker)
);

-- Si la tabla ya existía, asegurar las columnas nuevas
alter table public.analyses add column if not exists cash_flow jsonb;
alter table public.analyses add column if not exists fundamentals jsonb;
alter table public.analyses add column if not exists score numeric;
alter table public.analyses add column if not exists current_rank integer;
alter table public.analyses add column if not exists previous_rank integer;
alter table public.analyses add column if not exists rank_updated_at timestamptz;

-- 3. Indexes for fast lookups
create index if not exists idx_assets_user on public.assets(user_id);
create index if not exists idx_assets_user_category on public.assets(user_id, category);
create index if not exists idx_analyses_user on public.analyses(user_id);
create index if not exists idx_analyses_user_ticker on public.analyses(user_id, ticker);
create index if not exists idx_analyses_user_score on public.analyses(user_id, score desc nulls last);

-- ----------------------------------------------------------------------------
-- snapshot_user_ranking(uid): promueve current_rank -> previous_rank y recalcula
-- current_rank desde el score persistido. Solo cuenta tickers que sigan en
-- `assets` para ese user. Llamar tras un recálculo masivo (cron o bulk sync).
-- ----------------------------------------------------------------------------
create or replace function public.snapshot_user_ranking(uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with ranked as (
    select
      a.id,
      row_number() over (order by a.score desc nulls last, a.ticker asc) as new_rank
    from public.analyses a
    where a.user_id = uid
      and exists (
        select 1 from public.assets x
        where x.user_id = uid and x.ticker = a.ticker
      )
  )
  update public.analyses a
  set
    previous_rank = a.current_rank,
    current_rank  = r.new_rank,
    rank_updated_at = now()
  from ranked r
  where a.id = r.id;
end;
$$;

grant execute on function public.snapshot_user_ranking(uuid) to authenticated;
grant execute on function public.snapshot_user_ranking(uuid) to service_role;

-- 4. Auto-update updated_at
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists assets_updated_at on public.assets;
create trigger assets_updated_at
  before update on public.assets
  for each row execute function public.update_updated_at();

drop trigger if exists analyses_updated_at on public.analyses;
create trigger analyses_updated_at
  before update on public.analyses
  for each row execute function public.update_updated_at();

-- 5. Row Level Security (RLS)
alter table public.assets enable row level security;
alter table public.analyses enable row level security;

-- Users can only see/modify their own data
drop policy if exists "Users read own assets" on public.assets;
create policy "Users read own assets"
  on public.assets for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own assets" on public.assets;
create policy "Users insert own assets"
  on public.assets for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users update own assets" on public.assets;
create policy "Users update own assets"
  on public.assets for update
  using (auth.uid() = user_id);

drop policy if exists "Users delete own assets" on public.assets;
create policy "Users delete own assets"
  on public.assets for delete
  using (auth.uid() = user_id);

drop policy if exists "Users read own analyses" on public.analyses;
create policy "Users read own analyses"
  on public.analyses for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own analyses" on public.analyses;
create policy "Users insert own analyses"
  on public.analyses for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users update own analyses" on public.analyses;
create policy "Users update own analyses"
  on public.analyses for update
  using (auth.uid() = user_id);

drop policy if exists "Users delete own analyses" on public.analyses;
create policy "Users delete own analyses"
  on public.analyses for delete
  using (auth.uid() = user_id);

-- 6. Service role policy for cron/edge functions
-- The service_role key bypasses RLS, so no extra policy needed.
-- Edge Functions use SUPABASE_SERVICE_ROLE_KEY to update all users' analyses.

-- ============================================================================
-- 7. CRON: Run update-analyses once per day (06:00 UTC ≈ 07/08h España)
--    IMPORTANT: Before running this, ensure:
--    a) pg_cron and pg_net extensions are enabled (Database > Extensions in dashboard)
--    b) The Edge Function is deployed:
--       supabase functions deploy update-analyses --no-verify-jwt
--    c) Edge Function secrets configured (APP_BASE_URL apunta al dominio Vercel):
--       supabase secrets set APP_BASE_URL=https://your-app.vercel.app
--    d) Replace YOUR_PROJECT_REF and YOUR_SERVICE_ROLE_KEY below
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove previous schedules if exist
select cron.unschedule('update-analyses-periodic')
  where exists (select 1 from cron.job where jobname = 'update-analyses-periodic');
select cron.unschedule('update-analyses-daily')
  where exists (select 1 from cron.job where jobname = 'update-analyses-daily');

-- Schedule once per day at 06:00 UTC.
-- Nota: el cómputo Geraldine es independiente del horario de bolsa; solo
-- buscamos refrescar el ranking 1x/día sin quemar cuota FMP.
select cron.schedule(
  'update-analyses-daily',
  '0 6 * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/update-analyses',
    headers := jsonb_build_object(
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 600000
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

drop policy if exists "Users read own settings" on public.user_settings;
create policy "Users read own settings"
  on public.user_settings for select using (auth.uid() = user_id);
drop policy if exists "Users insert own settings" on public.user_settings;
create policy "Users insert own settings"
  on public.user_settings for insert with check (auth.uid() = user_id);
drop policy if exists "Users update own settings" on public.user_settings;
create policy "Users update own settings"
  on public.user_settings for update using (auth.uid() = user_id);
drop policy if exists "Users delete own settings" on public.user_settings;
create policy "Users delete own settings"
  on public.user_settings for delete using (auth.uid() = user_id);

drop trigger if exists user_settings_updated_at on public.user_settings;
create trigger user_settings_updated_at
  before update on public.user_settings
  for each row execute function public.update_updated_at();
