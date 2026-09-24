/**
 * db/regenerar-enlaces.js
 * Pasa los enlaces publicos existentes al formato actual.
 *
 *     npm run db:enlaces -- --ver      muestra que cambiaria, sin tocar nada
 *     npm run db:enlaces -- --aplicar  lo aplica
 *
 * ==========================================================================
 * Para que existe
 * ==========================================================================
 * El identificador del enlace cambio de formato:
 *
 *     antes   /reservar/28456789-romero-mp-14523   (DNI + apellido + matricula)
 *     ahora   /reservar/dra-laura-romero-cardiologia
 *
 * El DNI del profesional viajaba a la vista en cada enlace compartido por
 * WhatsApp y en cada cartel impreso. El formato nuevo lleva solo lo que el
 * paciente necesita reconocer: de quien es el turno y de que.
 *
 * El codigo por si solo NO arregla a los que ya tenian enlace: los conserva a
 * proposito, porque pueden estar impresos (ver asegurarHashPublico). Este
 * script es el que los migra, explicitamente y cuando uno lo decide.
 *
 * ==========================================================================
 * OJO: los enlaces anteriores dejan de funcionar
 * ==========================================================================
 * Es el objetivo, no un efecto secundario: si el enlace viejo siguiera
 * resolviendo, el DNI seguiria circulando. Despues de aplicarlo hay que
 * volver a repartir el enlace y a imprimir los carteles con el QR nuevo.
 *
 * El QR se borra junto con el enlace y se vuelve a generar solo la proxima
 * vez que el profesional entre a /medico/enlace.
 *
 * Por eso pide `--aplicar` explicito: sin argumentos solo muestra.
 */
const path = require('path');
require('dotenv').config();

const { query } = require('../src/config/db');
const Medico = require('../src/models/medico.model');

const APLICAR = process.argv.includes('--aplicar');

(async () => {
  try {
    const medicos = await query(
      'SELECT id FROM v_medicos WHERE hash_publico IS NOT NULL ORDER BY id'
    );

    if (!medicos.length) {
      console.log('[enlaces] Ningun profesional tiene enlace generado todavia. Nada que hacer.');
      process.exit(0);
    }

    console.log(
      APLICAR
        ? `[enlaces] Regenerando ${medicos.length} enlace(s)...\n`
        : `[enlaces] SIMULACION: esto es lo que cambiaria en ${medicos.length} enlace(s).\n`
    );

    let cambiados = 0;

    for (const { id } of medicos) {
      // eslint-disable-next-line no-await-in-loop
      const medico = await Medico.findById(id);
      const anterior = medico.hash_publico;

      // Se calcula sin sufijo: el formato cambio, asi que el slug nuevo ya es
      // distinto del viejo y no hace falta forzar la diferencia.
      // eslint-disable-next-line no-await-in-loop
      const nuevo = await Medico.construirIdentificadorUnico(medico);

      const etiqueta = `${medico.apellido}, ${medico.nombre}`.padEnd(28);

      if (nuevo === anterior) {
        console.log(`  =  ${etiqueta} ya estaba en el formato actual`);
        continue;
      }

      console.log(`  ${APLICAR ? '->' : ' ?'} ${etiqueta}`);
      console.log(`       antes: /reservar/${anterior}`);
      console.log(`       ahora: /reservar/${nuevo}`);
      cambiados += 1;

      if (APLICAR) {
        // El QR se borra con el enlace: codificaba la direccion vieja y se
        // regenera solo en el proximo acceso a /medico/enlace.
        // eslint-disable-next-line no-await-in-loop
        await query(
          `UPDATE medicos
              SET hash_publico = ?, qr_data_url = NULL, qr_url_codificada = NULL
            WHERE id = ?`,
          [nuevo, id]
        );
      }
    }

    console.log('');
    if (!cambiados) {
      console.log('[enlaces] Todos los enlaces ya estaban en el formato actual.');
    } else if (APLICAR) {
      console.log(`[enlaces] Listo: ${cambiados} enlace(s) regenerado(s).`);
      console.log('[enlaces] Los anteriores ya no resuelven. Avisales a los profesionales');
      console.log('[enlaces] que vuelvan a compartir el enlace y a imprimir el cartel del QR.');
    } else {
      console.log(`[enlaces] ${cambiados} enlace(s) cambiarian. Para aplicarlo:`);
      console.log('[enlaces]     npm run db:enlaces -- --aplicar');
    }
  } catch (error) {
    console.error('[enlaces] Error:', error.message);
    process.exitCode = 1;
  } finally {
    const { pool } = require('../src/config/db');
    await pool.end();
  }
})();
