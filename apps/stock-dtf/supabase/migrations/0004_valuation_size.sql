-- Clasificacion de tamaño para valuacion de stock, usada cuando la estampa
-- no tiene ancho/alto reales cargados (o para marcar explicitamente que
-- corresponde usar la medida real en vez de una categoria).
alter table public.stamp_variants add column if not exists valuation_size text;

alter table public.stamp_variants drop constraint if exists stamp_variants_valuation_size_check;
alter table public.stamp_variants add constraint stamp_variants_valuation_size_check
  check (valuation_size is null or valuation_size in ('TALLE','XS','S','M','L','XL','CUSTOM'));

-- Clasificacion inicial razonable: las estampas de talle (etiquetas chicas/
-- medianas generadas automaticamente por regla, ver 0003_size_stamps.sql) se
-- valorizan como categoria 'S' salvo que ya se haya clasificado a mano.
-- Idempotente: solo toca filas que todavia no tienen clasificacion.
update public.stamp_variants
set valuation_size = 'S', updated_at = now()
where categoria = 'Talles' and valuation_size is null;
