'use strict';
const { getDb, ensureSchema } = require('../src/db');

async function main() {
  await ensureSchema();
  const db = getDb();
  const tableRows = await db.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
  `);
  const tables = new Set(tableRows.rows.map((row) => row.table_name));

  await db.transaction(async (tx) => {
    await tx.query(`
      delete from stamp_product_recipes
      where product_id in (select id from stamp_products where sku like 'SKU-%')
         or stamp_variant_id in (select id from stamp_variants where codigo like 'TEST-%')
    `);
    if (tables.has('stamp_order_allocations')) {
      await tx.query(`
        delete from stamp_order_allocations
        where stamp_variant_id in (select id from stamp_variants where codigo like 'TEST-%')
      `);
    }
    await tx.query(`
      delete from stamp_movements
      where stamp_variant_id in (select id from stamp_variants where codigo like 'TEST-%')
    `);
    if (tables.has('production_order_items')) {
      await tx.query(`
        delete from production_order_items
        where stamp_variant_id in (select id from stamp_variants where codigo like 'TEST-%')
      `);
    }
    await tx.query(`
      delete from stamp_inventory
      where stamp_variant_id in (select id from stamp_variants where codigo like 'TEST-%')
    `);
    await tx.query(`
      delete from stamp_files
      where stamp_variant_id in (select id from stamp_variants where codigo like 'TEST-%')
    `);
    await tx.query(`delete from stamp_variants where codigo like 'TEST-%'`);
    await tx.query(`delete from stamp_products where sku like 'SKU-%'`);
  });

  const remaining = await db.query(`select count(*)::int n from stamp_variants where codigo like 'TEST-%'`);
  console.log(`TEST restantes: ${remaining.rows[0].n}`);
  await db.close();
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
