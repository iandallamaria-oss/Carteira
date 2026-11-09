-- Aba "Agro": resumo do dia + notícias/relatórios coletados (StoneX, Safras, etc.).
-- O snapshot é gravado pelo coletor/robô; o app só lê. A agenda macro fica no próprio index.html.
create table if not exists public.agro (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  config     jsonb not null default '{}'::jsonb,
  snapshot   jsonb,
  updated_at timestamptz not null default now()
);

alter table public.agro enable row level security;

drop policy if exists "agro_select_own" on public.agro;
create policy "agro_select_own" on public.agro for select using (auth.uid() = user_id);
