/**
 * models/historia.model.js
 * Tabla `historias_clinicas`: evoluciones en TEXTO.
 *
 * No hay ninguna columna de audio ni de archivo, y es deliberado: el dictado
 * se transcribe en el navegador y el audio nunca llega al servidor. Aca solo
 * entra el texto ya transcrito.
 *
 * Aislamiento: toda consulta filtra por medico_id. Una evolucion es del
 * profesional que la escribio; otro medico del sistema no la ve.
 */
const { query, queryOne } = require('../config/db');

/**
 * Ultima barrera antes del INSERT: garantiza que lo que entra sea texto.
 *
 * La validacion de entrada (validators/index.js -> sinContenidoBinario) ya
 * rechaza esto en las rutas actuales. Se repite aca a proposito: la regla "en
 * historias_clinicas solo hay texto" es un invariante del sistema, y ponerlo
 * en el modelo hace que lo cumpla CUALQUIER camino que inserte, incluso uno
 * que se agregue mas adelante y olvide el validador.
 *
 * @throws {Error} si el texto contiene un data-URI o un bloque base64 largo
 */
function exigirTextoPlano(texto) {
  const valor = String(texto || '');

  if (/\bdata:[a-z]+\/[a-z0-9.+-]+;base64,/i.test(valor) || /[A-Za-z0-9+/=]{120,}/.test(valor)) {
    const error = new Error(
      'historias_clinicas solo admite texto: se rechazo contenido binario o codificado.'
    );
    error.code = 'TEXTO_NO_PLANO';
    throw error;
  }
  return valor.trim();
}

const SELECT_BASE = `
  SELECT h.id, h.paciente_id, h.medico_id, h.turno_id, h.texto, h.origen,
         h.created_at, h.updated_at,
         t.fecha AS turno_fecha, t.hora_inicio AS turno_hora,
         um.nombre AS medico_nombre, um.apellido AS medico_apellido
    FROM historias_clinicas h
    JOIN medicos m   ON m.id = h.medico_id
    JOIN users um    ON um.id = m.user_id
    LEFT JOIN turnos t ON t.id = h.turno_id`;

const Historia = {
  findById(id) {
    return queryOne(`${SELECT_BASE} WHERE h.id = ?`, [id]);
  },

  /**
   * Evoluciones de un paciente escritas por este medico, mas nuevas primero.
   * Es la lista cronologica que se muestra en la pestana Historia Clinica.
   */
  listarPorPaciente(pacienteId, medicoId) {
    return query(
      `${SELECT_BASE}
        WHERE h.paciente_id = ? AND h.medico_id = ?
        ORDER BY h.created_at DESC`,
      [pacienteId, medicoId]
    );
  },

  /** Evoluciones asociadas a un turno puntual. */
  listarPorTurno(turnoId, medicoId) {
    return query(
      `${SELECT_BASE}
        WHERE h.turno_id = ? AND h.medico_id = ?
        ORDER BY h.created_at DESC`,
      [turnoId, medicoId]
    );
  },

  /**
   * Inserta una evolucion.
   * @param {Object} datos
   * @param {number} datos.pacienteId
   * @param {number} datos.medicoId
   * @param {number|null} datos.turnoId
   * @param {string} datos.texto      texto ya transcrito (nunca audio)
   * @param {'dictado'|'manual'} datos.origen
   */
  async create({ pacienteId, medicoId, turnoId = null, texto, origen = 'manual' }) {
    const res = await query(
      `INSERT INTO historias_clinicas (paciente_id, medico_id, turno_id, texto, origen)
       VALUES (?, ?, ?, ?, ?)`,
      [pacienteId, medicoId, turnoId, exigirTextoPlano(texto), origen]
    );
    return Historia.findById(res.insertId);
  },

  /**
   * Corrige el texto de una evolucion propia. Util justo despues de un
   * dictado, cuando la transcripcion necesita un ajuste.
   */
  async update(id, medicoId, texto) {
    const res = await query(
      'UPDATE historias_clinicas SET texto = ? WHERE id = ? AND medico_id = ?',
      [exigirTextoPlano(texto), id, medicoId]
    );
    return res.affectedRows > 0 ? Historia.findById(id) : null;
  },

  async remove(id, medicoId) {
    const res = await query(
      'DELETE FROM historias_clinicas WHERE id = ? AND medico_id = ?',
      [id, medicoId]
    );
    return res.affectedRows > 0;
  },

  /** Cantidad de evoluciones y fecha de la ultima, para la cabecera del modal. */
  resumen(pacienteId, medicoId) {
    return queryOne(
      `SELECT COUNT(*) AS total, MAX(created_at) AS ultima
         FROM historias_clinicas
        WHERE paciente_id = ? AND medico_id = ?`,
      [pacienteId, medicoId]
    );
  },
};

module.exports = Historia;
