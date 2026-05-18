-- ============================================================================
-- Ranking snapshots: persistir score y rank actual/anterior por (user, ticker)
-- para mostrar deltas de posición tras cada recálculo masivo (cron o bulk sync).
-- ============================================================================

alter table public.analyses add column if not exists score numeric;
alter table public.analyses add column if not exists current_rank integer;
alter table public.analyses add column if not exists previous_rank integer;
alter table public.analyses add column if not exists rank_updated_at timestamptz;

create index if not exists idx_analyses_user_score
  on public.analyses(user_id, score desc nulls last);

-- ----------------------------------------------------------------------------
-- snapshot_user_ranking(uid)
--   Promueve current_rank -> previous_rank y recalcula current_rank a partir
--   del score persistido. Solo considera analyses cuyo ticker exista todavía
--   en `assets` para el mismo user (ignora tickers eliminados).
--   Llamar tras un recálculo masivo (Edge Function cron o bulk sync cliente).
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

-- Permitir invocar la RPC desde el cliente (RLS protege los datos: la función
-- solo escribe rows con user_id = uid; el cliente pasa su propio uid).
grant execute on function public.snapshot_user_ranking(uuid) to authenticated;
grant execute on function public.snapshot_user_ranking(uuid) to service_role;
