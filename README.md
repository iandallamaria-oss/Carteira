# Carteira

App de gestão de investimentos (`index.html`) + aba **Mercado** (cotações, notícias, alertas de queda e relatório diário).

## Ativar a aba Mercado

1. **Tabela**: no Supabase → SQL Editor, rode `supabase/migrations/001_mercado.sql`.
2. **Robô** (precisa do [Supabase CLI](https://supabase.com/docs/guides/cli)):
   ```
   supabase login
   supabase link --project-ref <PROJECT_REF>
   supabase secrets set CRON_SECRET=<uma-senha-longa>
   supabase functions deploy mercado-monitor --no-verify-jwt
   ```
3. **Agendamento**: edite `supabase/migrations/002_mercado_cron.sql` trocando `<PROJECT_REF>` e `<CRON_SECRET>`, e rode no SQL Editor.
   - Checagem a cada 15 min, seg–sex, 10h–18h (Brasília).
   - Relatório diário às 18h30 (Brasília).
4. No app, aba **Mercado** → adicione os tickers e ajuste o limite de queda (padrão 3,5%).

Para testar sem esperar o agendamento:
```
curl -H "x-cron-secret: <CRON_SECRET>" "https://<PROJECT_REF>.supabase.co/functions/v1/mercado-monitor?mode=report"
```

## Fontes
- Cotações: Yahoo Finance (endpoint público, pode ter atraso de ~15 min e mudar sem aviso).
- Notícias: Google News (RSS) por ticker + InfoMoney.
