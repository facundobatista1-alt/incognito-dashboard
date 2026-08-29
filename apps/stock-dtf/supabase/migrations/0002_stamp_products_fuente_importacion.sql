-- Permite 'importacion_manual' como fuente valida de stamp_products (ademas
-- de manual/tiendanube/incognito_ventas), para distinguir productos cargados
-- a mano uno por uno de los importados en lote desde un CSV/JSON.
alter table public.stamp_products drop constraint if exists stamp_products_fuente_check;
alter table public.stamp_products add constraint stamp_products_fuente_check
  check (fuente in ('manual','tiendanube','incognito_ventas','importacion_manual'));
