/**
 * config/db.js
 * Pool de conexiones MySQL (mysql2/promise).
 *
 * Todas las consultas se hacen con placeholders `?` -> el driver escapa los
 * valores y elimina el riesgo de SQL injection.
 */
const mysql = require('mysql2/promise');
const { db } = require('./env');

const pool = mysql.createPool({
  host: db.host,
  port: db.port,
  user: db.user,
  password: db.password,
  database: db.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4_unicode_ci',
  timezone: 'local',
  // Devuelve DATE/TIME como string plano, evita los corrimientos de zona
  // horaria que sufren los Date de JS al serializar a JSON.
  dateStrings: ['DATE', 'DATETIME'],
  decimalNumbers: true,
});

/**
 * Ejecuta una consulta y devuelve solo las filas.
 * @param {string} sql
 * @param {Array} params
 * @returns {Promise<Array>}
 */
async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/**
 * Devuelve la primera fila o null.
 */
async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

/**
 * Ejecuta un callback dentro de una transaccion. Hace COMMIT si resuelve y
 * ROLLBACK si lanza. El callback recibe la conexion para encadenar queries.
 *
 * @example
 *   await transaction(async (cx) => {
 *     const [r] = await cx.execute('INSERT ...', [...]);
 *     await cx.execute('UPDATE ...', [r.insertId]);
 *   });
 */
async function transaction(callback) {
  const cx = await pool.getConnection();
  try {
    await cx.beginTransaction();
    const resultado = await callback(cx);
    await cx.commit();
    return resultado;
  } catch (error) {
    await cx.rollback();
    throw error;
  } finally {
    cx.release();
  }
}

/** Verifica la conectividad al arrancar el servidor. */
async function testConnection() {
  const cx = await pool.getConnection();
  await cx.ping();
  cx.release();
}

module.exports = { pool, query, queryOne, transaction, testConnection };
