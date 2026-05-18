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
supabase secrets set APP_BASE_URL=https://your-app.vercel.app
```

`APP_BASE_URL` debe apuntar al dominio público donde están desplegadas las
funciones serverless (`/api/prices`, `/api/dividends`, `/api/profile`,
`/api/cashflow`, `/api/fundamentals`). La Edge Function las llama para reusar
la normalización FMP/Yahoo del backend en lugar de duplicar la lógica.

(SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son auto-inyectados)

## 6. Set Up Cron Schedule

In the Supabase dashboard, go to **SQL Editor** and run:

The cron schedule is already included at the bottom of `schema.sql` (section 7).
Before running it, replace `YOUR_PROJECT_REF` and `YOUR_SERVICE_ROLE_KEY` with your actual values.

Se ejecuta **una vez al día a las 06:00 UTC** (~07-08h España según horario).
La Edge Function:
1. Lee todos los tickers únicos de la tabla `assets` (todos los usuarios).
2. Para cada ticker, llama a tu backend Vercel para obtener prices, dividends,
   profile, cashFlow y fundamentals.
3. Recalcula el método Geraldine Weiss (`indicators` + `projection`) por
   usuario respetando su ventana `years`.
4. Hace upsert en `analyses` con todos los campos.
5. Refresca también `assets.price` con el último precio del profile.

Esto mantiene el ranking actualizado al día aunque ningún usuario abra los
tickers manualmente.

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
