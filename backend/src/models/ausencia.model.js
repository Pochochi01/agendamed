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
const { query, queryOne, transaction } = require('../config/db');

const Ausencia = {
  /** Ausencias de un medico en un rango de fechas. */
  listarPorMedico(medicoId, { desde = null, hasta = null } = {}) {
    const where = ['a.medico_id = ?'];
    const params = [medicoId];
    if (desde) { where.push('a.fecha >= ?'); params.push(desde); }
    if (hasta) { where.push('a.fecha <= ?'); params.push(hasta); }

    return query(
      `SELECT a.id, a.medico_id, a.consultorio_id, a.fecha, a.motivo,
              a.turnos_cancelados, a.created_at,
              c.nombre AS consultorio
         FROM ausencias_medico a
         JOIN consultorios c ON c.id = a.consultorio_id
        WHERE ${where.join(' AND ')}
        ORDER BY a.fecha, c.nombre`,
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
  async cancelarDia(medicoId, fecha, consultorioIds, motivo = null) {
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
          `INSERT INTO ausencias_medico (medico_id, consultorio_id, fecha, motivo, turnos_cancelados)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             motivo = VALUES(motivo),
             turnos_cancelados = turnos_cancelados + VALUES(turnos_cancelados)`,
          [medicoId, consultorioId, fecha, motivo, res.affectedRows]
        );
        // affectedRows: 1 = insertada, 2 = actualizada.
        if (resAus.affectedRows === 1) creadas += 1;

        detalle.push({ consultorioId, turnosCancelados: res.affectedRows });
      }

      return { creadas, turnosCancelados, detalle };
    });
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
