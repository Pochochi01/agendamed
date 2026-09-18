/**
 * db/migrate-up.js
 * Migrador INCREMENTAL: aplica los .sql de db/migrations sobre una base que ya
 * existe, sin borrar datos.
 *
 *     npm run db:up
 *
 * Diferencia con `npm run db:migrate`: aquel ejecuta schema.sql, que empieza
 * con DROP DATABASE y sirve para instalar de cero. Este se usa cuando la base
 * ya esta en produccion (o con datos de trabajo) y hay que llevarla a la
 * version actual del esquema.
 *
 * Deja registro en la tabla `migraciones`, asi que se puede correr las veces
 * que haga falta: las ya aplicadas se saltean.
 *
 * Ademas es tolerante a una base "a mitad de camino": MySQL no soporta
 * ADD COLUMN IF NOT EXISTS, de modo que los errores de "ya existe" se tratan
 * como paso cumplido en lugar de abortar. Es lo que permite reparar una base
 * en la que una migracion quedo aplicada parcialmente.
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

const DIR = path.join(__dirname, 'migrations');

/**
 * Errores que significan "esto ya estaba hecho". No son fallas: se informan
 * y se sigue.
 */
const YA_APLICADO = new Set([
  'ER_DUP_FIELDNAME',        // 1060 columna duplicada
  'ER_TABLE_EXISTS_ERROR',   // 1050 tabla ya existe
  'ER_DUP_KEYNAME',          // 1061 indice duplicado
  'ER_FK_DUP_NAME',          // 1826 foreign key duplicada
  'ER_DUP_ENTRY',            // 1062 fila ya insertada
]);

/**
 * Parte un script SQL en sentencias respetando comillas y comentarios, para
 * que un `;` dentro de un string no corte la sentencia por la mitad.
 *
 * @param {string} sql
 * @returns {string[]}
 */
function separarSentencias(sql) {
  const sentencias = [];
  let actual = '';
  let comilla = null;          // ' o " cuando estamos dentro de un literal
  let comentarioLinea = false;
  let comentarioBloque = false;

  for (let i = 0; i < sql.length; i += 1) {
    const c = sql[i];
    const siguiente = sql[i + 1];

    if (comentarioLinea) {
      if (c === '\n') { comentarioLinea = false; actual += c; }
      continue;
    }
    if (comentarioBloque) {
      if (c === '*' && siguiente === '/') { comentarioBloque = false; i += 1; }
      continue;
    }
    if (!comilla) {
      if (c === '-' && siguiente === '-') { comentarioLinea = true; i += 1; continue; }
      if (c === '/' && siguiente === '*') { comentarioBloque = true; i += 1; continue; }
    }

    if (comilla) {
      // Comilla escapada: no cierra el literal.
      if (c === '\\') { actual += c + (siguiente || ''); i += 1; continue; }
      if (c === comilla) comilla = null;
      actual += c;
      continue;
    }

    if (c === "'" || c === '"') { comilla = c; actual += c; continue; }

    if (c === ';') {
      if (actual.trim()) sentencias.push(actual.trim());
      actual = '';
      continue;
    }
    actual += c;
  }

  if (actual.trim()) sentencias.push(actual.trim());
  return sentencias;
}

/** Primeras palabras de la sentencia, para el log. */
function resumir(sentencia) {
  const limpia = sentencia.replace(/\s+/g, ' ').trim();
  return limpia.length > 72 ? `${limpia.slice(0, 72)}...` : limpia;
}

(async () => {
  const baseDatos = process.env.DB_NAME || 'agendamed';

  const cx = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: baseDatos,
    multipleStatements: false,
  });

  try {
    await cx.query(`
      CREATE TABLE IF NOT EXISTS migraciones (
        id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        nombre      VARCHAR(190) NOT NULL,
        sentencias  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        omitidas    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        aplicada_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_migraciones_nombre (nombre)
      ) ENGINE=InnoDB
    `);

    const [aplicadas] = await cx.query('SELECT nombre FROM migraciones');
    const yaAplicadas = new Set(aplicadas.map((f) => f.nombre));

    const archivos = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
    if (!archivos.length) {
      console.log('[migrate-up] No hay migraciones en db/migrations');
      return;
    }

    let aplicadasAhora = 0;

    for (const archivo of archivos) {
      if (yaAplicadas.has(archivo)) {
        console.log(`[migrate-up] ${archivo} ya aplicada, se saltea`);
        continue;
      }

      console.log(`\n[migrate-up] Aplicando ${archivo}...`);
      const sql = fs.readFileSync(path.join(DIR, archivo), 'utf8');
      // El USE ... lo maneja la conexion; se descarta para no cambiar de base.
      const sentencias = separarSentencias(sql).filter((s) => !/^USE\s+/i.test(s));

      let ejecutadas = 0;
      let omitidas = 0;

      for (const sentencia of sentencias) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await cx.query(sentencia);
          ejecutadas += 1;
          console.log(`   OK      ${resumir(sentencia)}`);
        } catch (error) {
          if (YA_APLICADO.has(error.code)) {
            omitidas += 1;
            console.log(`   ya esta ${resumir(sentencia)}`);
          } else {
            console.error(`\n   FALLO   ${resumir(sentencia)}`);
            console.error(`   ${error.code}: ${error.sqlMessage || error.message}`);
            throw error;
          }
        }
      }

      await cx.execute(
        'INSERT INTO migraciones (nombre, sentencias, omitidas) VALUES (?, ?, ?)',
        [archivo, ejecutadas, omitidas]
      );
      aplicadasAhora += 1;
      console.log(`[migrate-up] ${archivo}: ${ejecutadas} ejecutada(s), ${omitidas} ya estaba(n)`);
    }

    console.log(
      aplicadasAhora
        ? `\n[migrate-up] Listo: ${aplicadasAhora} migracion(es) aplicada(s).`
        : '\n[migrate-up] La base ya estaba al dia.'
    );
  } catch (error) {
    console.error('\n[migrate-up] Error:', error.message);
    process.exitCode = 1;
  } finally {
    await cx.end();
  }
})();
