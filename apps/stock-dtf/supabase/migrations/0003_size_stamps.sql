-- Estampas de talle: especiales por marca/prefijo y generales.
-- Se comportan como cualquier otra estampa: inventario, pedidos,
-- movimientos, produccion y carga inicial.

insert into public.stamp_variants
  (codigo, nombre, variante, categoria, subcategoria, marca_tematica, talle_tamano, estado, observaciones)
select code, name, size, 'Talles', subtype, brand, size, 'Agotada',
       'Estampa de talle creada por regla automatica'
from (
  values
    ('TALLE-S', 'Talle S - General', 'S', 'General', 'General'),
    ('TALLE-M', 'Talle M - General', 'M', 'General', 'General'),
    ('TALLE-L', 'Talle L - General', 'L', 'General', 'General'),
    ('TALLE-XL', 'Talle XL - General', 'XL', 'General', 'General'),
    ('TALLE-XXL', 'Talle XXL - General', 'XXL', 'General', 'General')
) as v(code, name, size, subtype, brand)
on conflict (codigo) do update set
  nombre = excluded.nombre,
  variante = excluded.variante,
  categoria = excluded.categoria,
  subcategoria = excluded.subcategoria,
  marca_tematica = excluded.marca_tematica,
  talle_tamano = excluded.talle_tamano,
  observaciones = excluded.observaciones,
  updated_at = now();

insert into public.stamp_variants
  (codigo, nombre, variante, categoria, subcategoria, marca_tematica, talle_tamano, estado, observaciones)
select prefix || '-' || size,
       brand || ' talle ' || size,
       size,
       'Talles',
       'Especial',
       brand,
       size,
       'Agotada',
       'Estampa de talle especial creada por regla automatica'
from (
  values
    ('AM', 'Amiri'),
    ('BP', 'Bape'),
    ('CH', 'Chrome'),
    ('CZ', 'Corteiz'),
    ('DS', 'Diesel'),
    ('HB', 'Boss'),
    ('JD', 'Jordan'),
    ('NK', 'Nike'),
    ('SP', 'Supreme'),
    ('ST', 'Stussy'),
    ('TS', 'Trapstar')
) as brands(prefix, brand)
cross join (
  values ('S'), ('M'), ('L'), ('XL'), ('XXL')
) as sizes(size)
on conflict (codigo) do update set
  nombre = excluded.nombre,
  variante = excluded.variante,
  categoria = excluded.categoria,
  subcategoria = excluded.subcategoria,
  marca_tematica = excluded.marca_tematica,
  talle_tamano = excluded.talle_tamano,
  observaciones = excluded.observaciones,
  updated_at = now();

insert into public.stamp_inventory
  (stamp_variant_id, cantidad_disponible, stock_minimo, pendiente_de_contar)
select id, 0, 0, true
from public.stamp_variants
where categoria = 'Talles'
on conflict (stamp_variant_id) do nothing;

insert into public.stamp_files
  (stamp_variant_id, archivo_original, carpeta_origen, formato_archivo, origen_tipo, origen_capa_grupo_pagina, previsualizacion)
select sv.id,
       'previews/TALLES/' || sv.codigo || '.png',
       'previews/TALLES',
       'png',
       'talle_generado',
       'preview_talle',
       'previews/TALLES/' || sv.codigo || '.png'
from public.stamp_variants sv
where sv.categoria = 'Talles'
  and sv.subcategoria in ('Especial', 'General')
on conflict (stamp_variant_id, archivo_original, origen_capa_grupo_pagina) do update set
  previsualizacion = excluded.previsualizacion,
  formato_archivo = excluded.formato_archivo,
  origen_tipo = excluded.origen_tipo;
