/**
 * models/paciente.model.js
 * Tabla `pacientes` (1:1 con users, sin duplicar datos de contacto) + su
 * obra social, que vive en el catalogo `obras_sociales`.
 *
 * Hay dos clases de paciente:
 *   - REGISTRADO: se dio de alta con email y contrasena, entra a su panel.
 *   - INVITADO:   lo creo el enlace de agendamiento directo con solo nombre y
 *                 DNI. Tiene fila en `users` (para no duplicar el nombre y
 *                 respetar la 3FN) pero sin email ni password_hash, asi que no
 *                 puede iniciar sesion. La vista v_pacientes lo marca con
 *                 `es_invitado`.
 */
const { query, queryOne, transaction } = require('../config/db');

const SELECT_BASE = 'SELECT * FROM v_pacientes';

const Paciente = {
  findById(id) {
    return queryOne(`${SELECT_BASE} WHERE id = ?`, [id]);
  },

  findByUserId(userId) {
    return queryOne(`${SELECT_BASE} WHERE user_id = ?`, [userId]);
  },

  findByDni(dni) {
    return queryOne(`${SELECT_BASE} WHERE dni = ?`, [dni]);
  },

  async create({ userId, dni, fechaNacimiento = null, telefonoWhatsapp = null }, cx) {
    const ejecutor = cx || require('../config/db').pool;
    const [res] = await ejecutor.execute(
      `INSERT INTO pacientes (user_id, dni, fecha_nacimiento, telefono_whatsapp)
       VALUES (?, ?, ?, ?)`,
      [userId, dni, fechaNacimiento, telefonoWhatsapp]
    );
    return res.insertId;
  },

  /**
   * Alta de paciente INVITADO desde el enlace publico: crea el usuario sin
   * credenciales y el paciente, en una sola transaccion.
   *
   * @param {Object} datos
   * @param {string} datos.nombre
   * @param {string} datos.apellido
   * @param {string} datos.dni
   * @param {string} datos.telefonoWhatsapp  numero con el que llego al enlace
   * @returns {Promise<number>} id del paciente
   */
  async crearInvitado({ nombre, apellido, dni, telefonoWhatsapp }) {
    return transaction(async (cx) => {
      // email y password_hash en NULL: cuenta sin acceso al sistema.
      const [resUser] = await cx.execute(
        `INSERT INTO users (nombre, apellido, email, telefono, password_hash, rol, activo)
         VALUES (?, ?, NULL, ?, NULL, 'paciente', 1)`,
        [nombre, apellido, telefonoWhatsapp]
      );

      const [resPac] = await cx.execute(
        'INSERT INTO pacientes (user_id, dni, telefono_whatsapp) VALUES (?, ?, ?)',
        [resUser.insertId, dni, telefonoWhatsapp]
      );

      return resPac.insertId;
    });
  },

  /**
   * Guarda el WhatsApp de contacto del paciente.
   *
   * Se ACTUALIZA con el ultimo que el paciente informo al reservar, no se
   * conserva el primero: si cambio de numero o corrigio un error de tipeo, el
   * profesional necesita el vigente para poder comunicarse.
   *
   * El numero usado en cada reserva puntual queda aparte, en
   * `turnos.telefono_whatsapp`, asi no se pierde el historial de contacto.
   */
  async actualizarWhatsapp(id, telefonoWhatsapp) {
    if (!telefonoWhatsapp) return false;
    const res = await query(
      'UPDATE pacientes SET telefono_whatsapp = ? WHERE id = ?',
      [telefonoWhatsapp, id]
    );
    return res.affectedRows > 0;
  },

  /**
   * Actualiza obra social y numero de afiliado. Lo usa el medico desde el
   * modal del turno.
   *
   * @param {number} id
   * @param {number|null} obraSocialId  null = sin obra social (particular)
   * @param {string|null} nroAfiliado
   */
  async actualizarObraSocial(id, { obraSocialId = null, nroAfiliado = null }) {
    await query(
      'UPDATE pacientes SET obra_social_id = ?, nro_afiliado = ? WHERE id = ?',
      [obraSocialId, nroAfiliado || null, id]
    );
    return Paciente.findById(id);
  },

  /** Datos que el medico puede corregir del paciente (no el DNI ni el WhatsApp). */
  async actualizarDatos(id, { nombre, apellido, telefono = null, fechaNacimiento = null }) {
    const paciente = await Paciente.findById(id);
    if (!paciente) return null;

    await query(
      'UPDATE users SET nombre = ?, apellido = ?, telefono = ? WHERE id = ?',
      [nombre, apellido, telefono, paciente.user_id]
    );
    await query(
      'UPDATE pacientes SET fecha_nacimiento = ? WHERE id = ?',
      [fechaNacimiento, id]
    );
    return Paciente.findById(id);
  },

  /**
   * Pacientes que alguna vez tuvieron turno con este medico.
   * Respeta el aislamiento por tenant: un medico solo ve a los suyos.
   */
  listarPorMedico(medicoId) {
    return query(
      `SELECT DISTINCT p.id, p.dni, p.telefono_whatsapp, p.nro_afiliado,
              p.nombre, p.apellido, p.email, p.telefono, p.obra_social,
              (SELECT MAX(t2.fecha) FROM turnos t2
                WHERE t2.paciente_id = p.id AND t2.medico_id = ?) AS ultimo_turno
         FROM v_pacientes p
         JOIN turnos t ON t.paciente_id = p.id
        WHERE t.medico_id = ?
        ORDER BY p.apellido, p.nombre`,
      [medicoId, medicoId]
    );
  },
};

module.exports = Paciente;
