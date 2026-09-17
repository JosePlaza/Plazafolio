-- ============================================================================
-- ACTIVAR el refresco diario del ranking (esto es lo que hace que aparezcan
-- variaciones ▲/▼ en la vista Ranking, en lugar de solo "=" y "new").
--
-- POR QUÉ: el delta de posición compara el rank de hoy con el del último
-- snapshot. Sin un recálculo periódico, los scores nunca cambian entre
-- snapshots y el delta sale siempre "=" (misma posición). Este cron llama a la
-- Edge Function `update-analyses` una vez al día: refresca precios/dividendos,
-- recalcula el score de cada ticker y ejecuta `snapshot_user_ranking` por
-- usuario. Al día siguiente los precios han cambiado -> el score cambia -> el
-- ranking se reordena -> el delta muestra el movimiento real.
--
-- REQUISITOS PREVIOS (una sola vez):
--   1) Desplegar la Edge Function:
--        supabase functions deploy update-analyses --no-verify-jwt
--   2) Configurar su secret APP_BASE_URL (dominio Vercel, sin barra final):
--        supabase secrets set APP_BASE_URL=https://TU-APP.vercel.app
--
-- CÓMO EJECUTARLO: sustituye los dos valores del bloque `declare` de abajo
--   project_ref  -> la ref del proyecto (Settings > General)
--   service_key  -> Settings > API > service_role (secreto)
-- y ejecuta este fichero completo en el SQL Editor de Supabase.
--
-- Es idempotente: reprograma el job y ACTUALIZA el secret del vault si ya
-- existía (la versión anterior usaba `where not exists`, así que un secret con
-- un valor malo se quedaba malo para siempre y el cron daba 401 en silencio).
--
-- Si los placeholders siguen sin sustituir, esto aborta con un error en vez de
-- dejar un job roto: pg_net no puede encolar una URL con `< >` y el job falla
-- cada día con "Quote command returned error" mientras `cron.job` lo sigue
-- mostrando como `active = true`.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  project_ref text := '<PROJECT_REF>';
  service_key text := '<SERVICE_ROLE_KEY>';
  fn_url      text;
  secret_id   uuid;
begin
  if project_ref like '<%>' or service_key like '<%>' then
    raise exception
      'Sustituye <PROJECT_REF> y <SERVICE_ROLE_KEY> en el bloque declare antes de ejecutar este fichero.';
  end if;
  if service_key not like 'ey%' then
    raise exception
      'service_key no parece un JWT (debería empezar por "ey"). Usa Settings > API > service_role.';
  end if;

  fn_url := format('https://%s.supabase.co/functions/v1/update-analyses', project_ref);

  -- Guardar el service_role key en Vault en vez de incrustarlo en la definición
  -- del job (buena práctica: no queda en texto plano en cron.job).
  select id into secret_id from vault.secrets where name = 'update_analyses_service_key';
  if secret_id is null then
    perform vault.create_secret(
      service_key,
      'update_analyses_service_key',
      'Service role key usada por el cron update-analyses-daily'
    );
  else
    perform vault.update_secret(secret_id, service_key);
  end if;

  -- Limpiar cualquier schedule anterior con el mismo nombre.
  if exists (select 1 from cron.job where jobname = 'update-analyses-daily') then
    perform cron.unschedule('update-analyses-daily');
  end if;

  -- Programar una vez al día a las 06:00 UTC (~07/08h España). El cómputo
  -- Geraldine es independiente del horario de bolsa; solo refrescamos 1x/día
  -- para no quemar cuota FMP.
  perform cron.schedule(
    'update-analyses-daily',
    '0 6 * * *',
    format($cmd$
  select net.http_post(
    url := %L,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'update_analyses_service_key'
      ),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 600000
  );
    $cmd$, fn_url)
  );

  raise notice 'Cron update-analyses-daily programado contra %', fn_url;
end $$;


-- ── Verificación ────────────────────────────────────────────────────────────
-- 1) El job existe y su URL es real (no debe aparecer '<PROJECT_REF>'):
--      select jobid, jobname, schedule, active, command
--      from cron.job where jobname = 'update-analyses-daily';
--
-- 2) Lanzar una ejecución AHORA para poblar el primer snapshot sin esperar a
--    las 06:00 (devuelve un request_id):
--      select command from cron.job where jobname = 'update-analyses-daily';
--    ...y ejecutar ese mismo `select net.http_post(...)` a mano.
--
-- 3) Leer la respuesta HTTP (~30-60s después; la tabla tiene TTL de ~6h):
--      select id, status_code, left(content, 500) as content, error_msg, created
--      from net._http_response order by created desc limit 3;
--    Esperado: status_code 200 y un body con {"ok": N, "snapshots": N}.
--      401 -> el service_key del vault es inválido (re-ejecuta este fichero).
--      404 -> la Edge Function no está desplegada (paso 1 de requisitos).
--      500 "APP_BASE_URL secret no configurado" -> falta el paso 2.
--
-- 4) Historial del cron (ojo: cron.job_run_details NO tiene columna jobname):
--      select d.status, d.return_message, d.start_time
--      from cron.job_run_details d
--      join cron.job j on j.jobid = d.jobid
--      where j.jobname = 'update-analyses-daily'
--      order by d.start_time desc limit 10;
--
-- 5) Que el snapshot movió de verdad los ranks (previous_rank != current_rank
--    en al menos algunas filas):
--      select ticker, score, current_rank, previous_rank, rank_updated_at
--      from analyses where user_id = '<TU_USER_ID>'
--      order by current_rank nulls last;
