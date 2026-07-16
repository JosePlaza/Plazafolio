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
--   3) En el SQL Editor de Supabase, sustituir abajo:
--        <PROJECT_REF>        -> la ref del proyecto (Settings > General)
--        <SERVICE_ROLE_KEY>   -> Settings > API > service_role (secreto)
--      y ejecutar este fichero completo.
--
-- Ejecuta esto en el SQL Editor del dashboard de Supabase (no vía cliente).
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Guardar el service_role key en Vault en vez de incrustarlo en la definición
-- del job (buena práctica: no queda en texto plano en cron.job).
select vault.create_secret(
  '<SERVICE_ROLE_KEY>',
  'update_analyses_service_key',
  'Service role key usada por el cron update-analyses-daily'
)
where not exists (
  select 1 from vault.secrets where name = 'update_analyses_service_key'
);

-- Limpiar cualquier schedule anterior con el mismo nombre.
select cron.unschedule('update-analyses-daily')
  where exists (select 1 from cron.job where jobname = 'update-analyses-daily');

-- Programar una vez al día a las 06:00 UTC (~07/08h España). El cómputo
-- Geraldine es independiente del horario de bolsa; solo refrescamos 1x/día
-- para no quemar cuota FMP.
select cron.schedule(
  'update-analyses-daily',
  '0 6 * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/update-analyses',
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
  $$
);

-- Verificar que quedó programado:
--   select jobname, schedule, active from cron.job where jobname = 'update-analyses-daily';
-- Forzar una ejecución ahora mismo para poblar el primer snapshot (opcional):
--   supabase functions invoke update-analyses
