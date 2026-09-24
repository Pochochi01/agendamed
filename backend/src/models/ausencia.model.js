/**
 * models/ausencia.model.js
 * Tabla `ausencias_medico`: dias en los que el medico no atiende, por
 * consultorio.
 *
 * Es la contracara de `horarios`: la plantilla dice cuando atiende y esta
 * tabla marca las excepciones. El calculo de disponibilidad consulta ambas,
 * de modo que cancelar un dia no solo cancela los turnos existentes sino que
 * tambien impide que se reserven nuevos.
 */
const crypto = require('crypto');
const { query, queryOne, transaction } = require('../config/db');
const { sumarDias } = require('../utils/tiempo');

const Ausencia = {
  /** Etiquetas de los motivos, para mostrar sin repetirlas en cada pantalla. */
  MOTIVOS: {
    vacaciones: 'Vacaciones',
    congreso: 'Congreso',
    curso: 'Curso',
    personal: 'Motivos personales',
    otro: 'Otro',
  },

  /** Ausencias de un medico en un rango de fechas, dia por dia. */
  listarPorMedico(medicoId, { desde = null, hasta = null } = {}) {
    const where = ['a.medico_id = ?'];
    const params = [medicoId];
    if (desde) { where.push('a.fecha >= ?'); params.push(desde); }
    if (hasta) { where.push('a.fecha <= ?'); params.push(hasta); }

    return query(
      `SELECT a.id, a.medico_id, a.consultorio_id, a.fecha, a.motivo,
              a.tipo_motivo, a.rango_id, a.turnos_cancelados, a.created_at,
              c.nombre AS consultorio
         FROM ausencias_medico a
         JOIN consultorios c ON c.id = a.consultorio_id
        WHERE ${where.join(' AND ')}
        ORDER BY a.fecha, c.nombre`,
      params
    );
  },

  /**
   * Las ausencias AGRUPADAS por periodo, que es como el profesional las
   * pensó: "vacaciones del 1 al 15", no quince filas sueltas.
   *
   * Las que se cargaron dia por dia (sin rango_id) se devuelven como
   * periodos de un solo dia, para que la pantalla las trate igual.
   */
  listarPeriodos(medicoId, { desde = null, hasta = null } = {}) {
    const where = ['a.medico_id = ?'];
    const params = [medicoId];
    if (desde) { where.push('a.fecha >= ?'); params.push(desde); }
    if (hasta) { where.push('a.fecha <= ?'); params.push(hasta); }

    return query(
      `SELECT COALESCE(a.rango_id, CONCAT('dia-', a.fecha)) AS periodo,
              a.rango_id, a.tipo_motivo, a.motivo,
              MIN(a.fecha) AS desde, MAX(a.fecha) AS hasta,
              COUNT(DISTINCT a.fecha)          AS dias,
              COUNT(DISTINCT a.consultorio_id) AS consultorios,
              SUM(a.turnos_cancelados)         AS turnos_cancelados,
              GROUP_CONCAT(DISTINCT c.nombre ORDER BY c.nombre SEPARATOR ', ') AS nombres_consultorios,
              MIN(a.created_at) AS created_at
         FROM ausencias_medico a
         JOIN consultorios c ON c.id = a.consultorio_id
        WHERE ${where.join(' AND ')}
        GROUP BY periodo, a.rango_id, a.tipo_motivo, a.motivo
        ORDER BY desde`,
      params
    );
  },

  /**
   * Ids de consultorio bloqueados para un medico en una fecha.
   * Lo consume utils/disponibilidad.js para descartar esos slots.
   *
   * @returns {Promise<number[]>}
   */
  async consultoriosBloqueados(medicoId, fecha) {
    const filas = await query(
      'SELECT consultorio_id FROM ausencias_medico WHERE medico_id = ? AND fecha = ?',
      [medicoId, fecha]
    );
    return filas.map((f) => f.consultorio_id);
  },

  /**
   * Marca la ausencia y cancela los turnos vigentes de esa fecha, todo en una
   * transaccion: nunca queda el dia bloqueado con turnos sin cancelar, ni al
   * reves.
   *
   * @param {number} medicoId
   * @param {string} fecha            "YYYY-MM-DD"
   * @param {number[]} consultorioIds consultorios a los que no se presentara
   * @param {string} motivo           se informa a los pacientes
   * @returns {Promise<{creadas:number, turnosCancelados:number, detalle:Array}>}
   */
  async cancelarDia(medicoId, fecha, consultorioIds, motivo = null, tipoMotivo = 'otro', rangoId = null) {
    return transaction(async (cx) => {
      const detalle = [];
      let turnosCancelados = 0;
      let creadas = 0;

      for (const consultorioId of consultorioIds) {
        // 1. Cancelar los turnos vigentes de ese consultorio en esa fecha.
        //    Los ya cancelados se dejan como estan (no se pisa su motivo).
        // eslint-disable-next-line no-await-in-loop
        const [res] = await cx.execute(
          `UPDATE turnos
              SET estado = 'cancelado', cancelado_por = 'medico',
                  motivo_cancelacion = ?, cancelado_at = NOW()
            WHERE medico_id = ? AND consultorio_id = ? AND fecha = ?
              AND estado NOT IN ('cancelado', 'completado')`,
          [motivo || 'El profesional no atiende ese dia', medicoId, consultorioId, fecha]
        );
        turnosCancelados += res.affectedRows;

        // 2. Registrar la ausencia para que no entren turnos nuevos.
        //    ON DUPLICATE KEY: si el dia ya estaba marcado se actualiza el
        //    motivo y se suman los turnos que se cancelaron ahora.
        // eslint-disable-next-line no-await-in-loop
        const [resAus] = await cx.execute(
          `INSERT INTO ausencias_medico
             (medico_id, consultorio_id, fecha, motivo, tipo_motivo, rango_id, turnos_cancelados)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             motivo = VALUES(motivo),
             tipo_motivo = VALUES(tipo_motivo),
             rango_id = VALUES(rango_id),
             turnos_cancelados = turnos_cancelados + VALUES(turnos_cancelados)`,
          [medicoId, consultorioId, fecha, motivo, tipoMotivo, rangoId, res.affectedRows]
        );
        // affectedRows: 1 = insertada, 2 = actualizada.
        if (resAus.affectedRows === 1) creadas += 1;

        detalle.push({ consultorioId, turnosCancelados: res.affectedRows });
      }

      return { creadas, turnosCancelados, detalle };
    });
  },

  /**
   * Suspende un RANGO de dias (vacaciones, un congreso, un curso).
   *
   * Internamente inserta una fila por dia y consultorio, que es lo que
   * consulta el calculo de disponibilidad, pero todas comparten un `rango_id`
   * para poder mostrarlas y levantarlas como un unico periodo.
   *
   * @param {number} medicoId
   * @param {string} desde  "YYYY-MM-DD" inclusive
   * @param {string} hasta  "YYYY-MM-DD" inclusive
   * @param {number[]} consultorioIds
   * @param {Object} opciones
   * @param {string} opciones.tipoMotivo  vacaciones|congreso|curso|personal|otro
   * @param {string} [opciones.motivo]    detalle libre que se informa al paciente
   * @returns {Promise<Object>} resumen de lo suspendido
   */
  async suspenderRango(medicoId, desde, hasta, consultorioIds, { tipoMotivo = 'otro', motivo = null } = {}) {
    const rangoId = crypto.randomBytes(6).toString('hex');

    const fechas = [];
    for (let f = desde; f <= hasta; f = sumarDias(f, 1)) {
      fechas.push(f);
      // Tope de seguridad: un rango de mas de un ano casi siempre es un error
      // de tipeo en la fecha "hasta".
      if (fechas.length > 366) break;
    }

    let turnosCancelados = 0;
    let diasSuspendidos = 0;

    for (const fecha of fechas) {
      // eslint-disable-next-line no-await-in-loop
      const r = await Ausencia.cancelarDia(medicoId, fecha, consultorioIds, motivo, tipoMotivo, rangoId);
      turnosCancelados += r.turnosCancelados;
      diasSuspendidos += 1;
    }

    return {
      rangoId,
      desde,
      hasta,
      dias: diasSuspendidos,
      turnosCancelados,
      tipoMotivo,
      motivo,
    };
  },

  /**
   * Levanta una suspension completa por el identificador que devuelve
   * listarPeriodos.
   *
   * Acepta las dos formas que puede tener ese identificador:
   *   - el `rango_id` real, para lo que se suspendio desde esta pantalla;
   *   - el pseudo-id `dia-YYYY-MM-DD`, que listarPeriodos arma para los dias
   *     cancelados de a uno desde la agenda diaria (nacieron sin rango_id,
   *     antes de que existieran los rangos).
   *
   * Sin este segundo caso, esos dias quedarian bloqueados para siempre desde
   * esta pantalla.
   */
  async levantarRango(medicoId, rangoId) {
    const porDia = /^dia-(\d{4}-\d{2}-\d{2})$/.exec(String(rangoId || ''));
    if (porDia) return Ausencia.reactivar(medicoId, porDia[1]);

    const res = await query(
      'DELETE FROM ausencias_medico WHERE medico_id = ? AND rango_id = ?',
      [medicoId, rangoId]
    );
    return res.affectedRows;
  },

  /**
   * Reactiva el dia: quita la ausencia y vuelve a ofrecer los slots.
   * Los turnos ya cancelados NO se restauran: el paciente fue notificado y
   * pudo haber reservado en otro lado. Deben reservarse de nuevo.
   */
  async reactivar(medicoId, fecha, consultorioIds = null) {
    if (consultorioIds && consultorioIds.length) {
      const marcas = consultorioIds.map(() => '?').join(',');
      const res = await query(
        `DELETE FROM ausencias_medico
          WHERE medico_id = ? AND fecha = ? AND consultorio_id IN (${marcas})`,
        [medicoId, fecha, ...consultorioIds]
      );
      return res.affectedRows;
    }
    const res = await query(
      'DELETE FROM ausencias_medico WHERE medico_id = ? AND fecha = ?',
      [medicoId, fecha]
    );
    return res.affectedRows;
  },

  /** Ausencia puntual de un consultorio en una fecha, o null. */
  find(medicoId, consultorioId, fecha) {
    return queryOne(
      'SELECT * FROM ausencias_medico WHERE medico_id = ? AND consultorio_id = ? AND fecha = ?',
      [medicoId, consultorioId, fecha]
    );
  },
};

module.exports = Ausencia;
