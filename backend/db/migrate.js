/**
 * db/migrate.js
 * Ejecuta db/schema.sql contra el servidor MySQL configurado en el .env.
 *
 * ATENCION: schema.sql empieza con DROP DATABASE. Es un script de bootstrap
 * para desarrollo, no una migracion incremental.
 *
 *   npm run db:migrate
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

  // Se conecta sin `database` porque el script la crea, y con
  // multipleStatements para poder mandar el archivo entero.
  const cx = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });

  try {
    console.log('[migrate] Ejecutando schema.sql...');
    await cx.query(sql);
    console.log(`[migrate] Base "${process.env.DB_NAME || 'agendamed'}" creada correctamente`);
  } catch (error) {
    console.error('[migrate] Error:', error.message);
    process.exitCode = 1;
  } finally {
    await cx.end();
  }
})();
