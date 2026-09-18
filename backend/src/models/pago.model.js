/**
 * models/pago.model.js
 * Tabla `pagos`: senas y pagos totales de turnos hechos con MercadoPago.
 */
const { query, queryOne } = require('../config/db');

const SELECT_BASE = `
  SELECT p.id, p.turno_id, p.paciente_id, p.monto, p.tipo, p.estado,
         p.mp_preference_id, p.mp_payment_id, p.mp_status_detail,
         p.fecha_acreditacion, p.created_at,
         t.fecha AS turno_fecha, t.hora_inicio AS turno_hora, t.estado AS turno_estado,
         t.medico_id
    FROM pagos p
    JOIN turnos t ON t.id = p.turno_id`;

const Pago = {
  findById(id) {
    return queryOne(`${SELECT_BASE} WHERE p.id = ?`, [id]);
  },

  findByPreferenceId(preferenceId) {
    return queryOne(`${SELECT_BASE} WHERE p.mp_preference_id = ?`, [preferenceId]);
  },

  listarPorTurno(turnoId) {
    return query(`${SELECT_BASE} WHERE p.turno_id = ? ORDER BY p.created_at`, [turnoId]);
  },

  listarPorPaciente(pacienteId) {
    return query(`${SELECT_BASE} WHERE p.paciente_id = ? ORDER BY p.created_at DESC`, [pacienteId]);
  },

  listarPorMedico(medicoId, { desde = null, hasta = null } = {}) {
    const where = ['t.medico_id = ?'];
    const params = [medicoId];
    if (desde) { where.push('t.fecha >= ?'); params.push(desde); }
    if (hasta) { where.push('t.fecha <= ?'); params.push(hasta); }
    return query(`${SELECT_BASE} WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC`, params);
  },

  async create({ turnoId, pacienteId, monto, tipo, mpPreferenceId = null }) {
    const res = await query(
      `INSERT INTO pagos (turno_id, paciente_id, monto, tipo, mp_preference_id)
       VALUES (?, ?, ?, ?, ?)`,
      [turnoId, pacienteId, monto, tipo, mpPreferenceId]
    );
    return Pago.findById(res.insertId);
  },

  /** Actualiza el resultado que informa el webhook de MercadoPago. */
  async actualizarEstado(id, { estado, mpPaymentId = null, statusDetail = null }) {
    await query(
      `UPDATE pagos
          SET estado = ?, mp_payment_id = COALESCE(?, mp_payment_id), mp_status_detail = ?,
              fecha_acreditacion = IF(? = 'aprobado', NOW(), fecha_acreditacion)
        WHERE id = ?`,
      [estado, mpPaymentId, statusDetail, estado, id]
    );
    return Pago.findById(id);
  },

  /** Suma acreditada de un turno: define si esta senado o pago por completo. */
  async totalAprobadoDeTurno(turnoId) {
    const row = await queryOne(
      `SELECT COALESCE(SUM(monto), 0) AS total
         FROM pagos WHERE turno_id = ? AND estado = 'aprobado'`,
      [turnoId]
    );
    return Number(row.total);
  },
};

module.exports = Pago;
