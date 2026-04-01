# Plazafolio — Supabase Setup

## 1. Create Supabase Project

1. Go to https://supabase.com and create a new project
2. Note your **Project URL** and **Anon Key** (Settings > API)

## 2. Run the Schema

1. Go to **SQL Editor** in the Supabase dashboard
2. Paste and run the contents of `supabase/schema.sql`
3. This creates: `assets` table, `analyses` table, RLS policies, indexes

## 3. Configure Environment Variables

### Local Development (.env)

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...your-anon-key
VITE_FMP_API_KEY=your-fmp-api-key
```

### Vercel (Settings > Environment Variables)

Add the same three variables above.

## 4. Auth Configuration

1. Go to **Authentication > Providers** in Supabase dashboard
2. Ensure **Email** provider is enabled (it is by default)
3. Optional: disable "Confirm email" in **Auth > Settings** for faster testing
4. Optional: set **Site URL** to your Vercel domain in **Auth > URL Configuration**

## 5. Deploy Edge Function (Cron)

Install the Supabase CLI, then:

```bash
supabase login
supabase link --project-ref your-project-ref
supabase functions deploy update-analyses --no-verify-jwt
```

### Set Edge Function Secrets

```bash
supabase secrets set FMP_API_KEY=your-fmp-api-key
```

(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected)

## 6. Set Up Cron Schedule

In the Supabase dashboard, go to **SQL Editor** and run:

```sql
-- Enable the pg_cron extension (if not already enabled)
create extension if not exists pg_cron;

-- Schedule daily update at 06:00 UTC (after US market close)
select cron.schedule(
  'update-analyses-daily',
  '0 6 * * *',
  $$
  select net.http_post(
    url := 'https://your-project.supabase.co/functions/v1/update-analyses',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || 'your-service-role-key',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Replace `your-project` and `your-service-role-key` with your actual values.

### Verify Cron

```sql
-- List scheduled jobs
select * from cron.job;

-- Check recent runs
select * from cron.job_run_details order by start_time desc limit 10;
```

### Remove Cron (if needed)

```sql
select cron.unschedule('update-analyses-daily');
```

## Architecture Summary

```
Browser (Vue + localStorage)
    ↕ offline-first read/write
Supabase Postgres (assets, analyses)
    ↕ RLS: each user sees only their data
Vercel Serverless Functions (/api/*)
    → Yahoo Finance, FMP APIs
Supabase Edge Function (cron daily)
    → Updates prices + profiles for all users' assets
```
