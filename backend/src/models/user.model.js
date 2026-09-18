/**
 * models/user.model.js
 * Acceso a la tabla `users`. Nunca devuelve password_hash hacia afuera salvo
 * en findByEmailConHash, que es de uso exclusivo del login.
 */
const { query, queryOne } = require('../config/db');

const CAMPOS_PUBLICOS = 'id, nombre, apellido, email, telefono, rol, activo, created_at';

const User = {
  /** Busca por email incluyendo el hash: solo para verificar credenciales. */
  findByEmailConHash(email) {
    return queryOne(
      `SELECT id, nombre, apellido, email, telefono, rol, activo, password_hash
         FROM users WHERE email = ? LIMIT 1`,
      [email]
    );
  },

  findByEmail(email) {
    return queryOne(`SELECT ${CAMPOS_PUBLICOS} FROM users WHERE email = ? LIMIT 1`, [email]);
  },

  findById(id) {
    return queryOne(`SELECT ${CAMPOS_PUBLICOS} FROM users WHERE id = ? LIMIT 1`, [id]);
  },

  /**
   * Crea un usuario. Acepta una conexion externa (`cx`) para participar de
   * una transaccion junto con la creacion del medico o paciente.
   */
  async create({ nombre, apellido, email, telefono = null, passwordHash, rol }, cx = null) {
    const sql = `INSERT INTO users (nombre, apellido, email, telefono, password_hash, rol)
                 VALUES (?, ?, ?, ?, ?, ?)`;
    const params = [nombre, apellido, email, telefono, passwordHash, rol];

    if (cx) {
      const [res] = await cx.execute(sql, params);
      return res.insertId;
    }
    const [res] = await require('../config/db').pool.execute(sql, params);
    return res.insertId;
  },

  /** Actualiza datos de contacto (no toca email, rol ni password). */
  async updatePerfil(id, { nombre, apellido, telefono }) {
    await query(
      'UPDATE users SET nombre = ?, apellido = ?, telefono = ? WHERE id = ?',
      [nombre, apellido, telefono ?? null, id]
    );
    return User.findById(id);
  },

  /**
   * Actualiza los datos de un usuario desde el panel de administracion.
   * A diferencia de updatePerfil, aca SI se puede cambiar el email (es la
   * credencial de acceso), por eso el controlador valida antes que no este
   * tomado por otra cuenta.
   */
  async updateDatosAdmin(id, { nombre, apellido, email, telefono }) {
    await query(
      'UPDATE users SET nombre = ?, apellido = ?, email = ?, telefono = ? WHERE id = ?',
      [nombre, apellido, email, telefono ?? null, id]
    );
    return User.findById(id);
  },

  /**
   * Convierte una cuenta INVITADA (creada por el enlace de agendamiento
   * directo, sin email ni contrasena) en una cuenta registrada.
   *
   * Se actualiza el usuario existente en lugar de crear otro: asi el paciente
   * conserva sus turnos y su historia clinica, que cuelgan de este user_id.
   */
  async convertirInvitadoEnRegistrado(id, { nombre, apellido, email, telefono, passwordHash }) {
    await query(
      `UPDATE users
          SET nombre = ?, apellido = ?, email = ?, telefono = COALESCE(?, telefono),
              password_hash = ?
        WHERE id = ? AND password_hash IS NULL`,
      [nombre, apellido, email, telefono ?? null, passwordHash, id]
    );
    return User.findById(id);
  },

  async updatePassword(id, passwordHash) {
    await query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, id]);
  },

  /** Habilita / deshabilita el acceso del usuario (baja logica). */
  async setActivo(id, activo) {
    await query('UPDATE users SET activo = ? WHERE id = ?', [activo ? 1 : 0, id]);
  },

  getPasswordHash(id) {
    return queryOne('SELECT password_hash FROM users WHERE id = ?', [id]);
  },
};

module.exports = User;
