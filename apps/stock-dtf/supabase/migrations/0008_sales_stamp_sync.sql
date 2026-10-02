-- Historial importado desde Ventas para sincronizacion manual e idempotente.

create table if not exists public.stamp_sales_sync_state (
  source text primary key,
  cursor text,
  sync_from timestamptz not null,
  last_fetched_at timestamptz,
  last_applied_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

insert into public.stamp_sales_sync_state (source, sync_from)
values ('incognito-ventas', '2026-10-02T02:35:38.312Z')
on conflict (source) do nothing;

create table if not exists public.stamp_sales_sync_events (
  event_id text primary key,
  pedido_id text not null,
  evento text not null check (evento in (
    'preparacion_a_armado', 'modificacion', 'armado_a_preparacion', 'cancelacion'
  )),
  usuario text,
  occurred_at timestamptz not null,
  items_json jsonb not null default '[]'::jsonb,
  source_cursor text,
  status text not null default 'pendiente' check (status in (
    'pendiente', 'aplicado', 'advertencia', 'error', 'ignorado'
  )),
  result_json jsonb,
  error text,
  fetched_at timestamptz not null default now(),
  applied_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_stamp_sales_sync_events_status
  on public.stamp_sales_sync_events(status, occurred_at, event_id);
create index if not exists idx_stamp_sales_sync_events_pedido
  on public.stamp_sales_sync_events(pedido_id);
