-- Agendamento do robô de notícias do Agro. ANTES DE RODAR, troque:
--   <PROJECT_REF>  -> o código do seu projeto
--   <CRON_SECRET>  -> o mesmo CRON_SECRET do mercado-monitor
-- Coleta de hora em hora, seg-sáb, 7h–20h (Brasília). Horários em UTC.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('agro-news', '0 10-23 * * 1-6', $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/agro-news',
    headers := '{"x-cron-secret":"<CRON_SECRET>"}'::jsonb
  );
$$);
