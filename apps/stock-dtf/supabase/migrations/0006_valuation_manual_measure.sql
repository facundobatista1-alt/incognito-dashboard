-- Medida real de valuacion cargada a mano (por estampa o por lote via
-- prefijo de codigo), con prioridad sobre categoria y sobre ancho/alto
-- "tecnico" (el que viene del archivo, en px o cm). Existe porque ancho/alto
-- en px es resolucion de imagen, no tamano fisico, y no se puede usar para
-- valuar (ver 0004/0005): esto permite corregir caso por caso o por lote
-- sin esperar a re-procesar el archivo original.
alter table public.stamp_variants add column if not exists valuation_width_cm numeric;
alter table public.stamp_variants add column if not exists valuation_height_cm numeric;
alter table public.stamp_variants add column if not exists valuation_source text;
alter table public.stamp_variants add column if not exists valuation_confidence text;

alter table public.stamp_variants drop constraint if exists stamp_variants_valuation_measure_check;
alter table public.stamp_variants add constraint stamp_variants_valuation_measure_check
  check (
    (valuation_width_cm is null and valuation_height_cm is null)
    or (valuation_width_cm > 0 and valuation_height_cm > 0)
  );
