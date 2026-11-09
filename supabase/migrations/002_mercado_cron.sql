-- Agendamento do robô. ANTES DE RODAR, troque:
--   <PROJECT_REF>  -> o código do seu projeto (https://<PROJECT_REF>.supabase.co)
--   <CRON_SECRET>  -> a mesma senha que você definir em: supabase secrets set CRON_SECRET=...
-- Horários em UTC (Brasil não tem horário de verão): 13h UTC = 10h BRT.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Checagem de cotações/notícias/alertas: a cada 15 min, seg-sex, 10h–18h (BRT)
select cron.schedule('mercado-check', '*/15 13-21 * * 1-5', $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/mercado-monitor?mode=check',
    headers := '{"x-cron-secret":"<CRON_SECRET>"}'::jsonb
  );
$$);

-- Relatório diário: seg-sex, 18h30 (BRT)
select cron.schedule('mercado-report', '30 21 * * 1-5', $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/mercado-monitor?mode=report',
    headers := '{"x-cron-secret":"<CRON_SECRET>"}'::jsonb
  );
$$);
