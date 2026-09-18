/**
 * models/consultorio.model.js
 * Tabla `consultorios`. Todas las operaciones reciben medico_id y lo usan en
 * el WHERE: es la barrera que impide que un tenant toque datos de otro.
 */
const { query, queryOne } = require('../config/db');

const SELECT_BASE = `
  SELECT c.id, c.medico_id, c.nombre, c.calle, c.numero, c.piso_depto,
         c.localidad_id, c.telefono, c.activo, c.created_at,
         l.nombre AS localidad, l.provincia,
         CONCAT(c.calle, ' ', c.numero,
                IFNULL(CONCAT(', ', c.piso_depto), ''),
                ' - ', l.nombre, ', ', l.provincia) AS direccion_completa
    FROM consultorios c
    JOIN localidades l ON l.id = c.localidad_id`;

const Consultorio = {
  /** @param {boolean} soloActivos filtra los dados de baja logicamente */
  listarPorMedico(medicoId, { soloActivos = false } = {}) {
    return query(
      `${SELECT_BASE}
        WHERE c.medico_id = ? ${soloActivos ? 'AND c.activo = 1' : ''}
        ORDER BY c.nombre`,
      [medicoId]
    );
  },

  /** Busca por id restringido al tenant (devuelve null si es de otro medico). */
  findByIdDelMedico(id, medicoId) {
    return queryOne(`${SELECT_BASE} WHERE c.id = ? AND c.medico_id = ?`, [id, medicoId]);
  },

  findById(id) {
    return queryOne(`${SELECT_BASE} WHERE c.id = ?`, [id]);
  },

  async create(medicoId, { nombre, calle, numero, pisoDepto = null, localidadId, telefono = null }) {
    const rows = await query(
      `INSERT INTO consultorios (medico_id, nombre, calle, numero, piso_depto, localidad_id, telefono)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [medicoId, nombre, calle, numero, pisoDepto, localidadId, telefono]
    );
    return Consultorio.findById(rows.insertId);
  },

  async update(id, medicoId, { nombre, calle, numero, pisoDepto = null, localidadId, telefono = null, activo = 1 }) {
    await query(
      `UPDATE consultorios
          SET nombre = ?, calle = ?, numero = ?, piso_depto = ?, localidad_id = ?, telefono = ?, activo = ?
        WHERE id = ? AND medico_id = ?`,
      [nombre, calle, numero, pisoDepto, localidadId, telefono, activo ? 1 : 0, id, medicoId]
    );
    return Consultorio.findByIdDelMedico(id, medicoId);
  },

  async remove(id, medicoId) {
    const res = await query('DELETE FROM consultorios WHERE id = ? AND medico_id = ?', [id, medicoId]);
    return res.affectedRows > 0;
  },

  /** Baja logica: se usa cuando el consultorio ya tiene turnos historicos. */
  async desactivar(id, medicoId) {
    await query('UPDATE consultorios SET activo = 0 WHERE id = ? AND medico_id = ?', [id, medicoId]);
    return Consultorio.findByIdDelMedico(id, medicoId);
  },

  /** Cantidad de turnos futuros no cancelados: bloquea el borrado fisico. */
  async contarTurnosFuturos(id) {
    const row = await queryOne(
      `SELECT COUNT(*) AS total FROM turnos
        WHERE consultorio_id = ? AND fecha >= CURDATE() AND estado <> 'cancelado'`,
      [id]
    );
    return Number(row.total);
  },
};

module.exports = Consultorio;
