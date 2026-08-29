create table if not exists public.ventas_app_state (
  id text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.ventas_app_state enable row level security;

drop policy if exists "ventas_app_state_no_public_access" on public.ventas_app_state;
create policy "ventas_app_state_no_public_access"
  on public.ventas_app_state
  for all
  using (false)
  with check (false);
