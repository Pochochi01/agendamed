/**
 * models/suscripcion.model.js
 * Tabla `suscripciones_medicos`: canon mensual que cada tenant paga a la
 * plataforma. El Administrador General usa esta tabla para decidir si
 * habilita o suspende al medico.
 */
const { query, queryOne } = require('../config/db');

const SELECT_BASE = `
  SELECT s.id, s.medico_id, s.mes, s.anio, s.monto, s.estado,
         s.mp_preference_id, s.mp_payment_id, s.fecha_pago, s.created_at,
         u.nombre AS medico_nombre, u.apellido AS medico_apellido, u.email AS medico_email
    FROM suscripciones_medicos s
    JOIN medicos m ON m.id = s.medico_id
    JOIN users u   ON u.id = m.user_id`;

const Suscripcion = {
  findById(id) {
    return queryOne(`${SELECT_BASE} WHERE s.id = ?`, [id]);
  },

  findByPreferenceId(preferenceId) {
    return queryOne(`${SELECT_BASE} WHERE s.mp_preference_id = ?`, [preferenceId]);
  },

  findPeriodo(medicoId, anio, mes) {
    return queryOne(`${SELECT_BASE} WHERE s.medico_id = ? AND s.anio = ? AND s.mes = ?`, [medicoId, anio, mes]);
  },

  listarPorMedico(medicoId) {
    return query(`${SELECT_BASE} WHERE s.medico_id = ? ORDER BY s.anio DESC, s.mes DESC`, [medicoId]);
  },

  /** Listado para el panel del administrador, con filtros opcionales. */
  listar({ estado = null, anio = null, mes = null } = {}) {
    const where = [];
    const params = [];
    if (estado) { where.push('s.estado = ?'); params.push(estado); }
    if (anio)   { where.push('s.anio = ?');   params.push(anio); }
    if (mes)    { where.push('s.mes = ?');    params.push(mes); }

    return query(
      `${SELECT_BASE}
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY s.anio DESC, s.mes DESC, u.apellido`,
      params
    );
  },

  /**
   * Crea el periodo si no existe; si existe lo devuelve tal cual.
   * Evita duplicados sin depender de atrapar el error del indice unico.
   */
  async crearSiNoExiste({ medicoId, anio, mes, monto }) {
    const existente = await Suscripcion.findPeriodo(medicoId, anio, mes);
    if (existente) return existente;

    const res = await query(
      'INSERT INTO suscripciones_medicos (medico_id, mes, anio, monto) VALUES (?, ?, ?, ?)',
      [medicoId, mes, anio, monto]
    );
    return Suscripcion.findById(res.insertId);
  },

  async setPreferenceId(id, preferenceId) {
    await query('UPDATE suscripciones_medicos SET mp_preference_id = ? WHERE id = ?', [preferenceId, id]);
    return Suscripcion.findById(id);
  },

  async marcarPagada(id, mpPaymentId = null) {
    await query(
      `UPDATE suscripciones_medicos
          SET estado = 'pagada', mp_payment_id = COALESCE(?, mp_payment_id), fecha_pago = NOW()
        WHERE id = ?`,
      [mpPaymentId, id]
    );
    return Suscripcion.findById(id);
  },

  async cambiarEstado(id, estado) {
    await query('UPDATE suscripciones_medicos SET estado = ? WHERE id = ?', [estado, id]);
    return Suscripcion.findById(id);
  },

  /** Marca vencidos los periodos pendientes anteriores al mes en curso. */
  async marcarVencidas() {
    const res = await query(
      `UPDATE suscripciones_medicos
          SET estado = 'vencida'
        WHERE estado = 'pendiente'
          AND (anio < YEAR(CURDATE()) OR (anio = YEAR(CURDATE()) AND mes < MONTH(CURDATE())))`
    );
    return res.affectedRows;
  },

  /** Ultimo periodo cargado de cada medico: lo muestra la grilla del admin. */
  resumenPorMedico() {
    return query(
      `SELECT s.medico_id, s.anio, s.mes, s.estado, s.monto, s.fecha_pago
         FROM suscripciones_medicos s
         JOIN (SELECT medico_id, MAX(anio * 100 + mes) AS periodo
                 FROM suscripciones_medicos GROUP BY medico_id) ult
           ON ult.medico_id = s.medico_id AND ult.periodo = s.anio * 100 + s.mes`
    );
  },
};

module.exports = Suscripcion;
