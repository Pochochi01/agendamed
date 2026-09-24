/**
 * config/verificarEsquema.js
 * Comprueba al arrancar que la base tenga la forma que el codigo espera.
 *
 * ==========================================================================
 * Por que existe
 * ==========================================================================
 * El error ER_DATA_TOO_LONG en `hash_publico` no fue un bug del codigo: fue
 * codigo nuevo corriendo contra una base a la que nunca se le aplico la
 * migracion. La aplicacion arrancaba sin quejarse y fallaba mucho despues,
 * cuando un medico intentaba generar su enlace, con un mensaje de MySQL que no
 * decia que hacer.
 *
 * Este chequeo convierte ese fallo tardio y opaco en un aviso inmediato y
 * accionable, que dice exactamente que comando correr.
 *
 * Es solo un aviso: NO frena el arranque. Una base desactualizada suele
 * funcionar para casi todo, y tirar abajo el servidor por eso seria peor que
 * el problema. Las tablas que faltan por completo si se marcan como criticas.
 */
const { query } = require('./db');
const { LARGO_MAXIMO } = require('../utils/enlaceMedico');

/**
 * Lo que el codigo necesita de la base. Al agregar una migracion que cambie
 * algo de esto, actualizar la expectativa aca.
 */
const COLUMNAS_ESPERADAS = [
  {
    tabla: 'medicos',
    columna: 'hash_publico',
    largoMinimo: LARGO_MAXIMO,
    migracion: '004_hash_publico_255.sql',
    porque: 'el enlace /reservar/:id se arma con DNI, apellido y matricula',
  },
  // Sin largoMinimo: solo se comprueba que la columna exista. Son columnas
  // nuevas cuyo tipo no puede quedarse corto (ENUM o TEXT), pero cuya ausencia
  // rompe funciones enteras.
  {
    tabla: 'medicos',
    columna: 'dni',
    migracion: '005_agenda_avanzada.sql',
    porque: 'es el primer componente del enlace publico del medico',
  },
  {
    tabla: 'medicos',
    columna: 'genero',
    migracion: '005_agenda_avanzada.sql',
    porque: 'define si el sistema lo nombra Dr. o Dra.',
  },
  {
    tabla: 'medicos',
    columna: 'modo_agenda',
    migracion: '005_agenda_avanzada.sql',
    porque: 'elige entre seleccion libre y orden de llegada',
  },
  {
    tabla: 'medicos',
    columna: 'qr_data_url',
    migracion: '005_agenda_avanzada.sql',
    porque: 'guarda el QR del enlace para poder verificarlo en vez de recalcularlo',
  },
  {
    tabla: 'medicos',
    columna: 'qr_url_codificada',
    migracion: '005_agenda_avanzada.sql',
    porque: 'guarda a que direccion lleva ese QR, para contrastarla con el enlace',
  },
  {
    tabla: 'ausencias_medico',
    columna: 'tipo_motivo',
    migracion: '005_agenda_avanzada.sql',
    porque: 'registra si la suspension es por vacaciones, congreso, curso u otro',
  },
  {
    tabla: 'ausencias_medico',
    columna: 'rango_id',
    migracion: '005_agenda_avanzada.sql',
    porque: 'agrupa los dias de una misma suspension para poder levantarla junta',
  },
  {
    tabla: 'turnos',
    columna: 'codigo_cancelacion',
    migracion: '005_agenda_avanzada.sql',
    porque: 'es el acceso del paciente a su turno en /turno/:codigo',
  },
];

const TABLAS_ESPERADAS = [
  { tabla: 'obras_sociales', migracion: '002_modulo_agendamiento.sql' },
  { tabla: 'ausencias_medico', migracion: '002_modulo_agendamiento.sql' },
  { tabla: 'historias_clinicas', migracion: '002_modulo_agendamiento.sql' },
];

/**
 * @returns {Promise<{ok:boolean, problemas:Array<{mensaje:string, migracion:string}>}>}
 */
async function verificarEsquema() {
  const problemas = [];

  try {
    const faltantes = await query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?, ?)`,
      TABLAS_ESPERADAS.map((t) => t.tabla)
    );
    const presentes = new Set(faltantes.map((f) => f.TABLE_NAME));

    TABLAS_ESPERADAS.forEach(({ tabla, migracion }) => {
      if (!presentes.has(tabla)) {
        problemas.push({ mensaje: `falta la tabla "${tabla}"`, migracion });
      }
    });

    // Largo real de cada columna sensible.
    for (const esperada of COLUMNAS_ESPERADAS) {
      // eslint-disable-next-line no-await-in-loop
      const filas = await query(
        `SELECT CHARACTER_MAXIMUM_LENGTH AS largo, COLUMN_TYPE AS tipo
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [esperada.tabla, esperada.columna]
      );

      if (!filas.length) {
        problemas.push({
          mensaje: `falta la columna "${esperada.tabla}.${esperada.columna}"`,
          migracion: esperada.migracion,
        });
        continue;
      }

      // Columna declarada sin largo minimo: alcanza con que exista.
      if (!esperada.largoMinimo) continue;

      const largo = Number(filas[0].largo);
      if (largo < esperada.largoMinimo) {
        problemas.push({
          mensaje:
            `"${esperada.tabla}.${esperada.columna}" es ${filas[0].tipo} pero el codigo `
            + `puede generar hasta ${esperada.largoMinimo} caracteres `
            + `(${esperada.porque}). Guardar un valor largo daria ER_DATA_TOO_LONG`,
          migracion: esperada.migracion,
        });
      }
    }
  } catch (error) {
    // No poder verificar no es motivo para frenar el arranque.
    // eslint-disable-next-line no-console
    console.warn('[esquema] No se pudo verificar el esquema:', error.message);
    return { ok: true, problemas: [] };
  }

  return { ok: problemas.length === 0, problemas };
}

/** Imprime el resultado con el comando exacto para corregirlo. */
async function verificarEImprimir() {
  const { ok, problemas } = await verificarEsquema();

  if (ok) {
    // eslint-disable-next-line no-console
    console.log('[esquema] La base esta al dia con el codigo');
    return true;
  }

  const migraciones = [...new Set(problemas.map((p) => p.migracion))];

  console.warn('\n' + '='.repeat(74));
  console.warn('[esquema] LA BASE DE DATOS ESTA DESACTUALIZADA');
  console.warn('='.repeat(74));
  problemas.forEach((p) => console.warn(`  - ${p.mensaje}`));
  console.warn(`\n  Migracion(es) pendiente(s): ${migraciones.join(', ')}`);
  console.warn('\n  Para corregirlo, sin perder datos:');
  console.warn('      npm run db:up');
  console.warn('='.repeat(74) + '\n');

  return false;
}

module.exports = { verificarEsquema, verificarEImprimir, COLUMNAS_ESPERADAS };
