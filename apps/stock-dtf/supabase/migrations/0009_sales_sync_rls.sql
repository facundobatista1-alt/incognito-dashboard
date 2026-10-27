-- Las tablas de sincronizacion se agregaron despues de la migracion inicial
-- que protege el resto del esquema. El backend usa la conexion directa de
-- Postgres y no necesita exponerlas mediante la API publica de Supabase.

alter table public.stamp_sales_sync_state enable row level security;
alter table public.stamp_sales_sync_events enable row level security;

drop policy if exists stamp_sales_sync_state_no_public_access
  on public.stamp_sales_sync_state;
create policy stamp_sales_sync_state_no_public_access
  on public.stamp_sales_sync_state
  for all
  using (false)
  with check (false);

drop policy if exists stamp_sales_sync_events_no_public_access
  on public.stamp_sales_sync_events;
create policy stamp_sales_sync_events_no_public_access
  on public.stamp_sales_sync_events
  for all
  using (false)
  with check (false);
