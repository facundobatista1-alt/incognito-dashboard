-- ============================================================================
-- Stock de Estampas DTF -- esquema Supabase/Postgres
-- Tablas EXCLUSIVAS de estampas, prefijo "stamp_" en todo, sin tocar ni
-- mezclar con tablas de stock de prendas ni con la tabla ventas_app_state
-- que ya usa incognito-ventas.
--
-- Disenado para correr con el service_role key desde el backend de esta
-- app unicamente. RLS activado en todas las tablas, sin policies de acceso
-- publico (igual patron que ventas_app_state en incognito-ventas): el
-- service_role de Supabase ignora RLS, así que el backend funciona normal;
-- cualquier acceso con la anon key queda bloqueado.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) stamp_designs -- agrupador de "diseno principal" (prefijo de archivo)
-- ---------------------------------------------------------------------------
create table if not exists public.stamp_designs (
  id bigserial primary key,
  codigo_prefijo text not null unique,
  nombre text,
  categoria text,
  subcategoria text,
  marca_tematica text,
  observaciones text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2) stamp_variants -- catalogo descriptivo (SIN stock -- eso va en
--    stamp_inventory -- y SIN datos de archivo -- eso va en stamp_files)
-- ---------------------------------------------------------------------------
create table if not exists public.stamp_variants (
  id bigserial primary key,
  design_id bigint references public.stamp_designs(id),
  codigo text not null unique,
  nombre text not null,
  variante text not null default 'unica',
  categoria text,
  subcategoria text,
  marca_tematica text,
  color text,
  talle_tamano text,
  ubicacion_aplicacion text
    check (ubicacion_aplicacion is null or ubicacion_aplicacion in
      ('frente','espalda','manga','pantalon','otra')),
  ancho numeric,
  alto numeric,
  unidad_medida text not null default 'px' check (unidad_medida in ('px','cm')),
  estado text not null default 'Pendiente de revision' check (estado in
    ('Disponible','Stock bajo','Agotada','Pendiente de revision','Discontinuada')),
  observaciones text,
  legacy_sqlite_id integer, -- id que tenia en la SQLite original, para trazabilidad de la migracion
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_stamp_variants_estado on public.stamp_variants(estado);
create index if not exists idx_stamp_variants_design on public.stamp_variants(design_id);

-- ---------------------------------------------------------------------------
-- 3) stamp_files -- archivo(s) de origen vinculados a cada variante
-- ---------------------------------------------------------------------------
create table if not exists public.stamp_files (
  id bigserial primary key,
  stamp_variant_id bigint not null references public.stamp_variants(id) on delete cascade,
  archivo_original text not null,
  carpeta_origen text,
  formato_archivo text,
  origen_tipo text, -- imagen_simple | tiff_pagina_unica | tiff_multipagina | psd_sin_grupos | psd_grupo
  origen_capa_grupo_pagina text,
  previsualizacion text, -- ruta relativa (servida por la app; no se sube el binario a Supabase)
  phash text,
  fecha_creacion_archivo timestamptz,
  fecha_modificacion_archivo timestamptz,
  origen_json jsonb, -- snapshot del analisis (capas detectadas, etc.)
  created_at timestamptz not null default now(),
  unique (stamp_variant_id, archivo_original, origen_capa_grupo_pagina)
);
create index if not exists idx_stamp_files_variant on public.stamp_files(stamp_variant_id);
create index if not exists idx_stamp_files_archivo on public.stamp_files(archivo_original);

-- ---------------------------------------------------------------------------
-- 4) stamp_inventory -- el stock en si (1 a 1 con stamp_variants), separado
--    para que "cuanto hay" nunca se mezcle con la descripcion del diseno
-- ---------------------------------------------------------------------------
create table if not exists public.stamp_inventory (
  stamp_variant_id bigint primary key references public.stamp_variants(id) on delete cascade,
  cantidad_disponible integer, -- NULL = pendiente de carga, nunca se infiere
  stock_minimo integer not null default 0,
  pendiente_de_contar boolean not null default true, -- para la pantalla de carga inicial
  contado_en timestamptz,
  contado_por text,
  updated_at timestamptz not null default now(),
  constraint stamp_inventory_cantidad_no_negativa check (cantidad_disponible is null or cantidad_disponible >= 0)
);

-- ---------------------------------------------------------------------------
-- 5) stamp_products -- cache local liviano de productos/SKU importados desde
--    Tiendanube/incognito-ventas (soporte necesario para las recetas; no
--    forma parte de la lista de 10 tablas pedidas pero es imprescindible
--    para que "buscar por SKU/nombre/talle" tenga de donde buscar)
-- ---------------------------------------------------------------------------
create table if not exists public.stamp_products (
  id bigserial primary key,
  sku text not null unique,
  nombre text not null,
  variante text, -- talle/color de la prenda
  fuente text not null default 'manual' check (fuente in ('manual','tiendanube','incognito_ventas')),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_stamp_products_nombre on public.stamp_products using gin (to_tsvector('spanish', nombre));

-- ---------------------------------------------------------------------------
-- 6) stamp_product_recipes -- que estampa(s) consume cada producto
-- ---------------------------------------------------------------------------
create table if not exists public.stamp_product_recipes (
  id bigserial primary key,
  product_id bigint not null references public.stamp_products(id),
  stamp_variant_id bigint not null references public.stamp_variants(id),
  cantidad_por_unidad integer not null default 1 check (cantidad_por_unidad > 0),
  ubicacion_aplicacion text
    check (ubicacion_aplicacion is null or ubicacion_aplicacion in
      ('frente','espalda','manga','pantalon','otra')),
  vigente_desde timestamptz not null default now(),
  vigente_hasta timestamptz,
  activo boolean not null default true,
  confirmado boolean not null default false, -- nunca se confirma solo, requiere accion humana
  origen text not null default 'manual' check (origen in ('manual','sugerido_por_nombre','copiado_de_otra_variante','importado')),
  observaciones text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_recipes_product on public.stamp_product_recipes(product_id);
create index if not exists idx_recipes_stamp on public.stamp_product_recipes(stamp_variant_id);
create unique index if not exists uq_recipe_activa
  on public.stamp_product_recipes(product_id, stamp_variant_id, ubicacion_aplicacion)
  where activo = true;

-- ---------------------------------------------------------------------------
-- 7) stamp_movements -- historico completo, NUNCA se borra
-- ---------------------------------------------------------------------------
create table if not exists public.stamp_movements (
  id bigserial primary key,
  stamp_variant_id bigint not null references public.stamp_variants(id),
  tipo text not null check (tipo in
    ('ingreso','descuento_pedido','reintegro','correccion','perdida','dano','produccion','ajuste_inicial')),
  cantidad integer not null check (cantidad >= 0),
  direccion text not null check (direccion in ('entrada','salida')),
  stock_anterior integer,
  stock_posterior integer,
  pedido_id text,
  pedido_item_ref text,
  sku text,
  production_order_id bigint,
  usuario text not null default 'sistema',
  motivo text,
  evento_origen text, -- preparacion_a_armado | armado_a_preparacion | cancelacion | modificacion | manual | sync | api
  idempotency_key text unique,
  movimiento_relacionado_id bigint references public.stamp_movements(id),
  correccion_cantidad_anterior integer,
  correccion_cantidad_nueva integer,
  created_at timestamptz not null default now()
);
create index if not exists idx_movements_stamp on public.stamp_movements(stamp_variant_id);
create index if not exists idx_movements_pedido on public.stamp_movements(pedido_id);
create index if not exists idx_movements_created on public.stamp_movements(created_at);

-- ---------------------------------------------------------------------------
-- 8) stamp_processed_events -- ledger de idempotencia (la garantia real
--    vive ACA, en la base, no solo en memoria del servidor). Un registro
--    por (pedido, item, estampa): guarda cuanto esta aplicado ahora mismo,
--    asi cualquier evento nuevo se reconcilia por diferencia.
-- ---------------------------------------------------------------------------
create table if not exists public.stamp_processed_events (
  id bigserial primary key,
  pedido_id text not null,
  pedido_item_ref text not null,
  sku text,
  stamp_variant_id bigint not null references public.stamp_variants(id),
  cantidad_aplicada integer not null default 0,
  ultimo_evento text not null,
  ultima_cantidad_procesada integer not null default 0,
  idempotency_key text not null,
  last_movement_id bigint references public.stamp_movements(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (pedido_id, pedido_item_ref, stamp_variant_id)
);
create index if not exists idx_events_pedido on public.stamp_processed_events(pedido_id);
create unique index if not exists uq_events_idempotency on public.stamp_processed_events(idempotency_key);

-- Log de cada transicion procesada por pedido (diagnostico / conciliacion)
create table if not exists public.stamp_order_transition_log (
  id bigserial primary key,
  pedido_id text not null,
  evento text not null,
  resultado text not null check (resultado in ('ok','advertencia','error')),
  detalle_json jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_otl_pedido on public.stamp_order_transition_log(pedido_id);

-- ---------------------------------------------------------------------------
-- 9) stamp_production_orders / 10) stamp_production_order_items
-- ---------------------------------------------------------------------------
create table if not exists public.stamp_production_orders (
  id bigserial primary key,
  estado text not null default 'Pendiente' check (estado in
    ('Pendiente','Preparando archivo','Enviado a imprimir','Impreso','Recibido','Cancelado')),
  notas text,
  creado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stamp_production_order_items (
  id bigserial primary key,
  production_order_id bigint not null references public.stamp_production_orders(id) on delete cascade,
  stamp_variant_id bigint not null references public.stamp_variants(id),
  cantidad_necesaria integer not null check (cantidad_necesaria > 0),
  cantidad_recibida integer,
  created_at timestamptz not null default now(),
  unique (production_order_id, stamp_variant_id)
);
create index if not exists idx_poi_order on public.stamp_production_order_items(production_order_id);
create index if not exists idx_poi_variant on public.stamp_production_order_items(stamp_variant_id);

-- ---------------------------------------------------------------------------
-- 11) stamp_pending_reviews -- archivos pendientes Y posibles duplicados
--     (discriminados por `tipo`)
-- ---------------------------------------------------------------------------
create table if not exists public.stamp_pending_reviews (
  id bigserial primary key,
  tipo text not null default 'archivo' check (tipo in ('archivo','posible_duplicado')),
  archivo_original text,
  carpeta_origen text,
  stamp_variant_id bigint references public.stamp_variants(id),
  related_variant_id bigint references public.stamp_variants(id), -- solo para posible_duplicado
  motivo text not null,
  detalle text,
  resuelto boolean not null default false,
  resolucion text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists idx_pending_resuelto on public.stamp_pending_reviews(resuelto);
create index if not exists idx_pending_tipo on public.stamp_pending_reviews(tipo);

-- ---------------------------------------------------------------------------
-- Sincronizacion de carpeta de origen
-- ---------------------------------------------------------------------------
create table if not exists public.stamp_sync_runs (
  id bigserial primary key,
  archivos_nuevos integer not null default 0,
  archivos_modificados integer not null default 0,
  archivos_eliminados integer not null default 0,
  resumen_json jsonb,
  aplicado boolean not null default false,
  usuario text,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);

-- ============================================================================
-- Row Level Security -- bloqueado para anon/authenticated, el backend usa
-- siempre el service_role key (que Supabase deja pasar por encima de RLS).
-- ============================================================================
do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'stamp_designs','stamp_variants','stamp_files','stamp_inventory','stamp_products',
      'stamp_product_recipes','stamp_movements','stamp_processed_events','stamp_order_transition_log',
      'stamp_production_orders','stamp_production_order_items','stamp_pending_reviews','stamp_sync_runs'
    ])
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_no_public_access', t);
    execute format(
      'create policy %I on public.%I for all using (false) with check (false)',
      t || '_no_public_access', t
    );
  end loop;
end $$;

