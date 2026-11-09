-- Aba "Mercado Financeiro": configuração (editável no app) + snapshot (escrito pelo robô).
create table if not exists public.mercado (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  config     jsonb not null default '{"tickers":[],"limite":3.5}'::jsonb,
  snapshot   jsonb,
  updated_at timestamptz not null default now()
);

alter table public.mercado enable row level security;

drop policy if exists "mercado_select_own" on public.mercado;
drop policy if exists "mercado_insert_own" on public.mercado;
drop policy if exists "mercado_update_own" on public.mercado;

create policy "mercado_select_own" on public.mercado for select using (auth.uid() = user_id);
create policy "mercado_insert_own" on public.mercado for insert with check (auth.uid() = user_id);
create policy "mercado_update_own" on public.mercado for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
