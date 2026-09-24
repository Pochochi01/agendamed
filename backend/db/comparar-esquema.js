/**
 * db/comparar-esquema.js
 * Verifica que instalar desde cero de el MISMO resultado que migrar.
 *
 *     npm run db:check
 *
 * ==========================================================================
 * Que problema resuelve
 * ==========================================================================
 * Hay dos caminos para llegar a una base valida y tienen que coincidir:
 *
 *   A) servidor nuevo   ->  npm run db:migrate  (ejecuta db/schema.sql)
 *   B) base en uso      ->  npm run db:up       (aplica db/migrations/*.sql)
 *
 * Cuando se agrega una migracion y se olvida reflejarla en schema.sql, los
 * dos caminos se separan sin que nada avise. Todo sigue andando en la maquina
 * de desarrollo —que llego por el camino B— y revienta recien en el servidor
 * nuevo, que llego por el A, con un error que no dice cual es la causa:
 *
 *     npm run db:seed
 *     ER_BAD_FIELD_ERROR: Unknown column 'dni' in 'field list'
 *
 * Este script compara las dos rutas y falla si se desincronizaron, con la
 * lista exacta de columnas, indices y vistas que faltan.
 *
 * ==========================================================================
 * Como lo hace
 * ==========================================================================
 * Crea DOS bases descartables, arma una por cada camino y compara
 * `information_schema`. La base real nunca se toca: los nombres son fijos y
 * llevan el sufijo `_chk_`, y se borran al terminar aunque falle.
 *
 * Las migraciones se aplican con el migrador REAL, como subproceso apuntado a
 * la base descartable. Ejecutar los .sql a mano no serviria: el migrador los
 * parte en sentencias y tolera las "ya aplicadas" una por una, cosa que un
 * solo query() multi-sentencia no hace.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const mysql = require('mysql2/promise');
require('dotenv').config();

const BASE_NUEVA = 'agendamed_chk_nueva';     // camino A: solo schema.sql
const BASE_MIGRADA = 'agendamed_chk_migrada'; // camino B: schema.sql + db:up

/**
 * Filas de `migraciones` que schema.sql inserta para declararse al dia.
 * Son datos, no estructura: se comparan aparte.
 */
const TABLA_REGISTRO = 'migraciones';

const conexion = () => mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  multipleStatements: true,
});

/**
 * schema.sql con el nombre de base reemplazado.
 *
 * El archivo empieza con DROP DATABASE agendamed, asi que ejecutarlo tal cual
 * borraria la base de trabajo. Se reescriben las tres lineas que la nombran.
 */
function schemaPara(nombre) {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const reescrito = sql
    .replace(/DROP DATABASE IF EXISTS agendamed;/, `DROP DATABASE IF EXISTS ${nombre};`)
    .replace(/CREATE DATABASE agendamed /, `CREATE DATABASE ${nombre} `)
    .replace(/^USE agendamed;/m, `USE ${nombre};`);

  // Si alguna de las tres no se pudo reemplazar, abortar antes de ejecutar:
  // mas vale fallar que correr un DROP sobre la base equivocada.
  if (reescrito.includes('agendamed;') || reescrito.includes('CREATE DATABASE agendamed ')) {
    throw new Error(
      'No se pudo redirigir schema.sql a una base descartable. '
      + 'Revisa las lineas DROP DATABASE / CREATE DATABASE / USE al principio del archivo.'
    );
  }
  return reescrito;
}

/** Columnas + indices + vistas de una base, como mapa clave -> definicion. */
async function estructura(cx, base) {
  const [columnas] = await cx.query(
    `SELECT TABLE_NAME t, COLUMN_NAME c, COLUMN_TYPE tipo, IS_NULLABLE nulo,
            COLUMN_DEFAULT def, GENERATION_EXPRESSION gen
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, COLUMN_NAME`, [base]
  );
  const [indices] = await cx.query(
    `SELECT TABLE_NAME t, INDEX_NAME i, NON_UNIQUE nu,
            GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) cols
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ?
      GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE
      ORDER BY TABLE_NAME, INDEX_NAME`, [base]
  );
  const [vistas] = await cx.query(
    'SELECT TABLE_NAME v FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
    [base]
  );

  const mapa = new Map();
  columnas.forEach((r) => mapa.set(
    `columna  ${r.t}.${r.c}`,
    `${r.tipo} ${r.nulo === 'YES' ? 'NULL' : 'NOT NULL'} default=${r.def}${r.gen ? ` generada=${r.gen}` : ''}`
  ));
  indices.forEach((r) => mapa.set(
    `indice   ${r.t}.${r.i}`,
    `${r.nu === 0 ? 'UNIQUE' : 'INDEX'} (${r.cols})`
  ));
  vistas.forEach((r) => mapa.set(`vista    ${r.v}`, 'existe'));
  return mapa;
}

/** Nombres de migracion registrados en una base. */
async function registradas(cx, base) {
  const [filas] = await cx.query(`SELECT nombre FROM \`${base}\`.${TABLA_REGISTRO} ORDER BY nombre`);
  return filas.map((f) => f.nombre);
}

/**
 * Arma las dos bases y llena `problemas`.
 *
 * Va en su propia funcion para poder cortar con `return` en cuanto un paso
 * falla, sin saltearse el reporte final ni la limpieza de las bases.
 *
 * Cada paso se anota como un problema mas, no se deja escapar como excepcion:
 * que schema.sql no se pueda ejecutar, o que una migracion ya no corra sobre
 * el esquema actual, ES el resultado de la verificacion. Dejar que reviente
 * con un volcado de mysql2 escondería el diagnostico.
 */
async function comparar(cx, problemas) {
  {
    console.log('[check] Creando base "instalacion nueva" con schema.sql...');
    try {
      await cx.query(schemaPara(BASE_NUEVA));
    } catch (error) {
      problemas.push(
        `db/schema.sql no se puede ejecutar: ${error.code || ''} ${error.sqlMessage || error.message}`
      );
      return;
    }

    console.log('[check] Creando base "ya en uso" y aplicandole las migraciones...');
    await cx.query(schemaPara(BASE_MIGRADA));

    // Se vacia el registro para forzar que el migrador aplique TODO: asi se
    // comprueba que las migraciones siguen siendo ejecutables sobre el
    // esquema actual, y no solo que schema.sql las declare aplicadas.
    await cx.query(`DELETE FROM \`${BASE_MIGRADA}\`.${TABLA_REGISTRO}`);

    try {
      execFileSync(process.execPath, [path.join(__dirname, 'migrate-up.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, DB_NAME: BASE_MIGRADA },
        stdio: 'pipe',
      });
    } catch (error) {
      const salida = `${error.stdout || ''}${error.stderr || ''}`.trim();
      problemas.push(
        'las migraciones no se pueden aplicar sobre el esquema actual:\n    '
        + salida.split('\n').slice(-4).join('\n    ')
      );
      return;
    }

    /* ------------------------- Comparacion ---------------------------- */
    const nueva = await estructura(cx, BASE_NUEVA);
    const migrada = await estructura(cx, BASE_MIGRADA);

    for (const [clave, valor] of migrada) {
      if (!nueva.has(clave)) {
        problemas.push(`FALTA en schema.sql   ${clave}  ->  ${valor}`);
      } else if (nueva.get(clave) !== valor) {
        problemas.push(
          `DIFIERE               ${clave}\n`
          + `    instalacion nueva: ${nueva.get(clave)}\n`
          + `    base migrada:      ${valor}`
        );
      }
    }
    for (const clave of nueva.keys()) {
      if (!migrada.has(clave)) problemas.push(`SOBRA en schema.sql   ${clave}`);
    }

    /* ---------- Registro de migraciones declarado por schema.sql ------- */
    const declaradas = await registradas(cx, BASE_NUEVA);
    const enDisco = fs.readdirSync(path.join(__dirname, 'migrations'))
      .filter((f) => f.endsWith('.sql')).sort();

    enDisco.forEach((archivo) => {
      if (!declaradas.includes(archivo)) {
        problemas.push(
          `FALTA el registro de "${archivo}" en el INSERT INTO migraciones de schema.sql.\n`
          + '    Sin eso, una instalacion nueva reintenta esa migracion en el proximo db:up.'
        );
      }
    });
    declaradas.forEach((nombre) => {
      if (!enDisco.includes(nombre)) {
        problemas.push(`schema.sql declara aplicada "${nombre}", pero ese archivo no existe en db/migrations/`);
      }
    });
  }
}

(async () => {
  const cx = await conexion();
  const problemas = [];

  try {
    await comparar(cx, problemas);
  } catch (error) {
    // Cualquier fallo inesperado tambien es un resultado, no un crash.
    problemas.push(`error inesperado durante la verificacion: ${error.message}`);
  } finally {
    await cx.query(`DROP DATABASE IF EXISTS ${BASE_NUEVA}`);
    await cx.query(`DROP DATABASE IF EXISTS ${BASE_MIGRADA}`);
    await cx.end();
  }

  console.log('\n' + '='.repeat(74));
  if (problemas.length === 0) {
    console.log('[check] OK: instalar desde cero da exactamente la misma base que migrar.');
    console.log('='.repeat(74));
    process.exit(0);
  }

  console.error(`[check] ${problemas.length} DIFERENCIA(S) entre schema.sql y las migraciones`);
  console.error('='.repeat(74));
  problemas.forEach((p) => console.error('  ' + p));
  console.error('\n  Un servidor nuevo NO va a quedar igual que esta maquina.');
  console.error('  Corregi db/schema.sql para que refleje las migraciones y volve a correr:');
  console.error('      npm run db:check\n');
  process.exit(1);
})();
