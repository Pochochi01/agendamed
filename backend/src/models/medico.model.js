/**
 * models/medico.model.js
 * Tabla `medicos` + vista `v_medicos` (medico con usuario y especialidad
 * resueltos). El medico es el tenant del sistema.
 */
const { query, queryOne, transaction } = require('../config/db');
const { generarHashPublico } = require('../utils/hash');

const Medico = {
  findById(id) {
    return queryOne('SELECT * FROM v_medicos WHERE id = ?', [id]);
  },

  findByUserId(userId) {
    return queryOne('SELECT * FROM v_medicos WHERE user_id = ?', [userId]);
  },

  /**
   * Listado con filtros. `soloActivos` es lo que consume la vista publica
   * del paciente: un medico suspendido no debe aparecer ni recibir turnos.
   *
   * @param {Object} filtros
   * @param {boolean} [filtros.soloActivos]
   * @param {number}  [filtros.especialidadId]
   * @param {string}  [filtros.busqueda] nombre, apellido o especialidad
   */
  listar({ soloActivos = false, especialidadId = null, busqueda = '' } = {}) {
    const where = [];
    const params = [];

    if (soloActivos) where.push("estado = 'activo' AND usuario_activo = 1");
    if (especialidadId) { where.push('especialidad_id = ?'); params.push(especialidadId); }
    if (busqueda) {
      where.push('(nombre LIKE ? OR apellido LIKE ? OR especialidad LIKE ?)');
      const like = `%${busqueda}%`;
      params.push(like, like, like);
    }

    const sql = `SELECT * FROM v_medicos
                 ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY apellido, nombre`;
    return query(sql, params);
  },

  /**
   * Crea el perfil de medico. Se ejecuta dentro de la transaccion de registro
   * junto al INSERT de `users`.
   */
  async create({ userId, especialidadId, matricula, duracionTurnoMin = 30, precioConsulta = 0, porcentajeSena = 30 }, cx) {
    const sql = `INSERT INTO medicos
                   (user_id, especialidad_id, matricula, duracion_turno_min, precio_consulta, porcentaje_sena)
                 VALUES (?, ?, ?, ?, ?, ?)`;
    const params = [userId, especialidadId, matricula, duracionTurnoMin, precioConsulta, porcentajeSena];

    const ejecutor = cx || require('../config/db').pool;
    const [res] = await ejecutor.execute(sql, params);
    return res.insertId;
  },

  /** Configuracion de agenda y tarifas que edita el propio medico. */
  async updateConfiguracion(id, { especialidadId, matricula, duracionTurnoMin, precioConsulta, porcentajeSena }) {
    await query(
      `UPDATE medicos
          SET especialidad_id = ?, matricula = ?, duracion_turno_min = ?,
              precio_consulta = ?, porcentaje_sena = ?
        WHERE id = ?`,
      [especialidadId, matricula, duracionTurnoMin, precioConsulta, porcentajeSena, id]
    );
    return Medico.findById(id);
  },

  /**
   * Actualiza solo la duracion del turno (en minutos).
   * Se separa de updateConfiguracion para que el medico pueda cambiar el
   * tamano del slot desde la pantalla de horarios sin reenviar -ni pisar-
   * el resto de su configuracion (precio, matricula, especialidad).
   */
  async updateDuracionTurno(id, minutos) {
    await query('UPDATE medicos SET duracion_turno_min = ? WHERE id = ?', [minutos, id]);
    return Medico.findById(id);
  },

  /* ----------------------- Enlace de agendamiento ----------------------- */

  /** Busca por el hash del enlace publico. */
  findByHashPublico(hash) {
    return queryOne('SELECT * FROM v_medicos WHERE hash_publico = ?', [hash]);
  },

  /**
   * Devuelve el hash publico del medico, generandolo si todavia no tiene.
   * Los medicos creados antes de este modulo lo reciben en el primer acceso.
   */
  async asegurarHashPublico(id) {
    const medico = await Medico.findById(id);
    if (!medico) return null;
    if (medico.hash_publico) return medico.hash_publico;

    const hash = generarHashPublico();
    await query('UPDATE medicos SET hash_publico = ? WHERE id = ?', [hash, id]);
    return hash;
  },

  /**
   * Genera un hash nuevo: invalida el enlace anterior.
   * Sirve si el medico compartio el enlace donde no debia.
   */
  async regenerarHashPublico(id) {
    const hash = generarHashPublico();
    await query('UPDATE medicos SET hash_publico = ? WHERE id = ?', [hash, id]);
    return Medico.findById(id);
  },

  /** Activa o desactiva el enlace publico sin perder el hash. */
  async setEnlaceActivo(id, activo) {
    await query('UPDATE medicos SET enlace_activo = ? WHERE id = ?', [activo ? 1 : 0, id]);
    return Medico.findById(id);
  },

  /* --------------------- Credenciales de MercadoPago -------------------- */

  /**
   * Guarda las credenciales propias del profesional.
   * El access token llega YA CIFRADO desde el controlador (utils/cripto.js):
   * el modelo no maneja texto plano.
   */
  async guardarCredencialesMp(id, { accessTokenCifrado, publicKey = null }) {
    await query(
      'UPDATE medicos SET mp_access_token = ?, mp_public_key = ? WHERE id = ?',
      [accessTokenCifrado, publicKey, id]
    );
    return Medico.findById(id);
  },

  /** Desconecta la cuenta: el medico deja de cobrar online. */
  async borrarCredencialesMp(id) {
    await query('UPDATE medicos SET mp_access_token = NULL, mp_public_key = NULL WHERE id = ?', [id]);
    return Medico.findById(id);
  },

  /**
   * Devuelve el access token cifrado. Es el UNICO punto por el que sale de la
   * tabla, y su resultado nunca debe viajar al cliente: lo consume el
   * controlador de pagos para firmar las llamadas a MercadoPago.
   */
  async getAccessTokenMpCifrado(id) {
    const fila = await queryOne('SELECT mp_access_token FROM medicos WHERE id = ?', [id]);
    return fila ? fila.mp_access_token : null;
  },

  /** Habilitar / deshabilitar: accion exclusiva del Administrador General. */
  async setEstado(id, estado) {
    await query('UPDATE medicos SET estado = ? WHERE id = ?', [estado, id]);
    return Medico.findById(id);
  },

  /**
   * Cuenta todo lo que se perderia al eliminar definitivamente al medico.
   * El panel del admin lo muestra ANTES de pedir la confirmacion, para que la
   * decision se tome viendo el alcance real.
   */
  async impactoEliminacion(id) {
    return queryOne(
      `SELECT
         (SELECT COUNT(*) FROM consultorios WHERE medico_id = ?)                      AS consultorios,
         (SELECT COUNT(*) FROM horarios     WHERE medico_id = ?)                      AS horarios,
         (SELECT COUNT(*) FROM turnos       WHERE medico_id = ?)                      AS turnos,
         (SELECT COUNT(*) FROM turnos
           WHERE medico_id = ? AND fecha >= CURDATE() AND estado <> 'cancelado')      AS turnos_futuros,
         (SELECT COUNT(DISTINCT paciente_id) FROM turnos WHERE medico_id = ?)         AS pacientes_afectados,
         (SELECT COUNT(*) FROM pagos p JOIN turnos t ON t.id = p.turno_id
           WHERE t.medico_id = ?)                                                     AS pagos,
         (SELECT COALESCE(SUM(p.monto), 0) FROM pagos p JOIN turnos t ON t.id = p.turno_id
           WHERE t.medico_id = ? AND p.estado = 'aprobado')                           AS monto_acreditado,
         (SELECT COUNT(*) FROM suscripciones_medicos WHERE medico_id = ?)             AS suscripciones`,
      [id, id, id, id, id, id, id, id]
    );
  },

  /**
   * ELIMINACION DEFINITIVA del medico y de todo lo que cuelga de el.
   * Irreversible: no es una baja logica (para eso existe setEstado).
   *
   * Se borra en orden explicito dentro de una transaccion en lugar de
   * apoyarse en los ON DELETE CASCADE. Motivo: `turnos.consultorio_id` es
   * RESTRICT, y InnoDB no garantiza el orden entre cascadas hermanas, asi que
   * borrar `medicos` podia intentar eliminar un consultorio que todavia tenia
   * turnos apuntandole y fallar con ER_ROW_IS_REFERENCED_2.
   *
   * Los PACIENTES no se tocan: son de la plataforma, no del tenant.
   *
   * @returns {Promise<Object>} cantidad de filas eliminadas por tabla
   */
  async eliminarDefinitivo(id) {
    const medico = await Medico.findById(id);
    if (!medico) return null;

    return transaction(async (cx) => {
      const borradas = {};

      // 1. Pagos de los turnos del medico (antes que los turnos).
      const [pagos] = await cx.execute(
        'DELETE p FROM pagos p JOIN turnos t ON t.id = p.turno_id WHERE t.medico_id = ?',
        [id]
      );
      borradas.pagos = pagos.affectedRows;

      // 2. Turnos: liberan la referencia RESTRICT hacia consultorios.
      const [turnos] = await cx.execute('DELETE FROM turnos WHERE medico_id = ?', [id]);
      borradas.turnos = turnos.affectedRows;

      // 3. Plantilla semanal.
      const [horarios] = await cx.execute('DELETE FROM horarios WHERE medico_id = ?', [id]);
      borradas.horarios = horarios.affectedRows;

      // 4. Consultorios, ya sin turnos que los referencien.
      const [consultorios] = await cx.execute('DELETE FROM consultorios WHERE medico_id = ?', [id]);
      borradas.consultorios = consultorios.affectedRows;

      // 5. Historial de suscripciones.
      const [suscripciones] = await cx.execute(
        'DELETE FROM suscripciones_medicos WHERE medico_id = ?', [id]
      );
      borradas.suscripciones = suscripciones.affectedRows;

      // 6. El perfil profesional.
      await cx.execute('DELETE FROM medicos WHERE id = ?', [id]);

      // 7. El usuario que le daba acceso al sistema.
      await cx.execute('DELETE FROM users WHERE id = ?', [medico.user_id]);

      return { medico, borradas };
    });
  },

  /** Metricas del panel del medico. */
  async estadisticas(medicoId) {
    return queryOne(
      `SELECT
         (SELECT COUNT(*) FROM turnos
           WHERE medico_id = ? AND fecha = CURDATE() AND estado <> 'cancelado')            AS turnos_hoy,
         (SELECT COUNT(*) FROM turnos
           WHERE medico_id = ? AND fecha BETWEEN CURDATE() AND CURDATE() + INTERVAL 7 DAY
             AND estado <> 'cancelado')                                                     AS turnos_semana,
         (SELECT COUNT(*) FROM turnos
           WHERE medico_id = ? AND estado = 'cancelado'
             AND fecha >= CURDATE() - INTERVAL 30 DAY)                                      AS cancelados_mes,
         (SELECT COUNT(*) FROM consultorios WHERE medico_id = ? AND activo = 1)             AS consultorios,
         (SELECT COALESCE(SUM(p.monto), 0) FROM pagos p
            JOIN turnos t ON t.id = p.turno_id
           WHERE t.medico_id = ? AND p.estado = 'aprobado'
             AND t.fecha >= CURDATE() - INTERVAL 30 DAY)                                    AS recaudado_mes`,
      [medicoId, medicoId, medicoId, medicoId, medicoId]
    );
  },

  /** Metricas globales del panel de administracion. */
  async estadisticasGlobales() {
    return queryOne(
      `SELECT
         (SELECT COUNT(*) FROM medicos)                                          AS total_medicos,
         (SELECT COUNT(*) FROM medicos WHERE estado = 'activo')                  AS medicos_activos,
         (SELECT COUNT(*) FROM medicos WHERE estado = 'suspendido')              AS medicos_suspendidos,
         (SELECT COUNT(*) FROM users WHERE rol = 'paciente')                     AS total_pacientes,
         (SELECT COUNT(*) FROM turnos WHERE fecha >= CURDATE())                  AS turnos_futuros,
         (SELECT COUNT(*) FROM suscripciones_medicos
           WHERE estado = 'pendiente' AND anio = YEAR(CURDATE())
             AND mes = MONTH(CURDATE()))                                         AS suscripciones_pendientes`
    );
  },
};

module.exports = Medico;
