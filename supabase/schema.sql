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
