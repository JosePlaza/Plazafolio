-- ============================================================================
-- Ranking snapshots: persistir score y rank actual/anterior por (user, ticker)
-- para mostrar deltas de posición tras cada recálculo masivo (cron o bulk sync).
--
-- Re-ejecutable: se puede lanzar tantas veces como haga falta en el SQL Editor.
-- ============================================================================

alter table public.analyses add column if not exists score numeric;
alter table public.analyses add column if not exists current_rank integer;
alter table public.analyses add column if not exists previous_rank integer;
alter table public.analyses add column if not exists rank_updated_at timestamptz;

create index if not exists idx_analyses_user_score
  on public.analyses(user_id, score desc nulls last);

-- ----------------------------------------------------------------------------
-- snapshot_user_ranking(uid, force)
--
--   Recalcula SIEMPRE current_rank a partir del score persistido, y promueve
--   current_rank -> previous_rank SOLO al cruzar día (o con force => true).
--
--   Por qué el guard vive aquí y no en el cliente: la promoción es destructiva
--   e irreversible. La versión anterior promovía en cada llamada, así que dos
--   invocaciones el mismo día (cron diario + carga del cliente, bulk sync +
--   recarga, o dos pestañas) machacaban la foto del día anterior con la de hoy
--   y dejaban previous_rank = current_rank -> todos los deltas en "=" para
--   siempre. El guard que había en JS era un read-then-write con carrera y
--   además no cubría al cron. Aquí la función es idempotente dentro del mismo
--   día: llamarla N veces solo refresca la posición actual.
--
--   Solo considera analyses cuyo ticker exista todavía en `assets` para el
--   mismo user (ignora tickers eliminados).
--
--   Devuelve {"promoted": bool, "ranked": n} para poder distinguir en el
--   llamante si previous_rank ha cambiado (y por tanto hay que releer).
-- ----------------------------------------------------------------------------
drop function if exists public.snapshot_user_ranking(uuid);
drop function if exists public.snapshot_user_ranking(uuid, boolean);

create function public.snapshot_user_ranking(uid uuid, force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  last_day    date;
  do_promote  boolean;
  ranked_rows integer;
begin
  select max(a.rank_updated_at)::date into last_day
  from public.analyses a
  where a.user_id = uid;

  -- Primera foto (last_day null) o cambio de día natural (UTC).
  do_promote := force or last_day is null or last_day < current_date;

  with ranked as (
    select
      a.id,
      row_number() over (order by a.score desc nulls last, a.ticker asc)::int as new_rank
    from public.analyses a
    where a.user_id = uid
      and exists (
        select 1 from public.assets x
        where x.user_id = uid and x.ticker = a.ticker
      )
  )
  update public.analyses a
  set
    previous_rank   = case when do_promote then a.current_rank else a.previous_rank end,
    current_rank    = r.new_rank,
    rank_updated_at = now()
  from ranked r
  where a.id = r.id;

  get diagnostics ranked_rows = row_count;

  return jsonb_build_object('promoted', do_promote, 'ranked', ranked_rows);
end;
$$;

-- Permitir invocar la RPC desde el cliente (RLS protege los datos: la función
-- solo escribe rows con user_id = uid; el cliente pasa su propio uid).
grant execute on function public.snapshot_user_ranking(uuid, boolean) to authenticated;
grant execute on function public.snapshot_user_ranking(uuid, boolean) to service_role;

-- ── Uso manual ──────────────────────────────────────────────────────────────
-- Forzar una promoción (p. ej. para probar el delta sin esperar a mañana,
-- después de haber cambiado los scores):
--   select public.snapshot_user_ranking('<TU_USER_ID>'::uuid, true);
--
-- Ver el estado del ranking:
--   select ticker, score, current_rank, previous_rank, rank_updated_at
--   from public.analyses where user_id = '<TU_USER_ID>'
--   order by current_rank nulls last;
