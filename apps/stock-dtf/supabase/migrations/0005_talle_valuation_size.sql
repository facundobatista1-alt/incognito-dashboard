-- Las etiquetas de talle van atras del cuello y no pueden valuarse como una
-- estampa frontal chica/mediana. Se agrega una categoria propia de valuacion.
alter table public.stamp_variants drop constraint if exists stamp_variants_valuation_size_check;
alter table public.stamp_variants add constraint stamp_variants_valuation_size_check
  check (valuation_size is null or valuation_size in ('TALLE','XS','S','M','L','XL','CUSTOM'));

update public.stamp_variants
set valuation_size = 'TALLE',
    updated_at = now()
where categoria = 'Talles'
  and (valuation_size is null or valuation_size = 'S');
