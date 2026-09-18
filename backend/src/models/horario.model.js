/**
 * models/horario.model.js
 * Tabla `horarios`: plantilla semanal de atencion del medico.
 *
 * Regla de negocio central: un medico no puede estar en dos lugares a la vez.
 * Por eso la validacion de superposicion se hace sobre TODOS los horarios del
 * medico en ese dia, sin importar el consultorio (findSuperpuestos).
 */
const { query, queryOne } = require('../config/db');

const SELECT_BASE = `
  SELECT h.id, h.medico_id, h.consultorio_id, h.dia_semana, h.hora_inicio, h.hora_fin, h.activo,
         c.nombre AS consultorio, l.nombre AS localidad
    FROM horarios h
    JOIN consultorios c ON c.id = h.consultorio_id
    JOIN localidades  l ON l.id = c.localidad_id`;

const Horario = {
  listarPorMedico(medicoId, { soloActivos = false } = {}) {
    return query(
      `${SELECT_BASE}
        WHERE h.medico_id = ? ${soloActivos ? 'AND h.activo = 1 AND c.activo = 1' : ''}
        ORDER BY h.dia_semana, h.hora_inicio`,
      [medicoId]
    );
  },

  /** Horarios activos de un dia concreto: base para calcular disponibilidad. */
  listarPorMedicoYDia(medicoId, diaSemana) {
    return query(
      `${SELECT_BASE}
        WHERE h.medico_id = ? AND h.dia_semana = ? AND h.activo = 1 AND c.activo = 1
        ORDER BY h.hora_inicio`,
      [medicoId, diaSemana]
    );
  },

  findByIdDelMedico(id, medicoId) {
    return queryOne(`${SELECT_BASE} WHERE h.id = ? AND h.medico_id = ?`, [id, medicoId]);
  },

  /**
   * Devuelve los horarios del medico que se solapan con el rango dado.
   * La comparacion `a.inicio < b.fin AND b.inicio < a.fin` detecta cualquier
   * tipo de solapamiento (parcial, total o contenido) y permite que un bloque
   * termine justo cuando empieza el siguiente (09:00-12:00 + 12:00-15:00 OK).
   *
   * @param {number} medicoId
   * @param {number} diaSemana
   * @param {string} horaInicio "HH:MM:SS"
   * @param {string} horaFin    "HH:MM:SS"
   * @param {number|null} excluirId  id a ignorar (en las ediciones)
   */
  findSuperpuestos(medicoId, diaSemana, horaInicio, horaFin, excluirId = null) {
    return query(
      `${SELECT_BASE}
        WHERE h.medico_id = ?
          AND h.dia_semana = ?
          AND h.activo = 1
          AND h.hora_inicio < ?
          AND ? < h.hora_fin
          ${excluirId ? 'AND h.id <> ?' : ''}`,
      excluirId
        ? [medicoId, diaSemana, horaFin, horaInicio, excluirId]
        : [medicoId, diaSemana, horaFin, horaInicio]
    );
  },

  /**
   * Superposicion desde la optica del consultorio: dos medicos distintos no
   * pueden ocupar el mismo consultorio en el mismo tramo horario.
   */
  findSuperpuestosEnConsultorio(consultorioId, diaSemana, horaInicio, horaFin, excluirId = null) {
    return query(
      `${SELECT_BASE}
        WHERE h.consultorio_id = ?
          AND h.dia_semana = ?
          AND h.activo = 1
          AND h.hora_inicio < ?
          AND ? < h.hora_fin
          ${excluirId ? 'AND h.id <> ?' : ''}`,
      excluirId
        ? [consultorioId, diaSemana, horaFin, horaInicio, excluirId]
        : [consultorioId, diaSemana, horaFin, horaInicio]
    );
  },

  async create(medicoId, { consultorioId, diaSemana, horaInicio, horaFin }) {
    const res = await query(
      `INSERT INTO horarios (medico_id, consultorio_id, dia_semana, hora_inicio, hora_fin)
       VALUES (?, ?, ?, ?, ?)`,
      [medicoId, consultorioId, diaSemana, horaInicio, horaFin]
    );
    return Horario.findByIdDelMedico(res.insertId, medicoId);
  },

  async update(id, medicoId, { consultorioId, diaSemana, horaInicio, horaFin, activo = 1 }) {
    await query(
      `UPDATE horarios
          SET consultorio_id = ?, dia_semana = ?, hora_inicio = ?, hora_fin = ?, activo = ?
        WHERE id = ? AND medico_id = ?`,
      [consultorioId, diaSemana, horaInicio, horaFin, activo ? 1 : 0, id, medicoId]
    );
    return Horario.findByIdDelMedico(id, medicoId);
  },

  async remove(id, medicoId) {
    const res = await query('DELETE FROM horarios WHERE id = ? AND medico_id = ?', [id, medicoId]);
    return res.affectedRows > 0;
  },
};

module.exports = Horario;
