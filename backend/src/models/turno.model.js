/**
 * models/turno.model.js
 * Tabla `turnos`. La reserva se hace dentro de una transaccion con
 * SELECT ... FOR UPDATE para que dos pacientes simultaneos no tomen el mismo
 * slot; si igual ocurre, el indice unico uq_turno_medico_slot lo rechaza.
 */
const { query, queryOne, transaction } = require('../config/db');

const SELECT_BASE = `
  SELECT t.id, t.paciente_id, t.medico_id, t.consultorio_id, t.fecha,
         t.hora_inicio, t.hora_fin, t.estado, t.monto_total,
         t.motivo_consulta, t.motivo_cancelacion, t.cancelado_por, t.cancelado_at, t.created_at,
         up.nombre AS paciente_nombre, up.apellido AS paciente_apellido,
         up.email  AS paciente_email,  up.telefono AS paciente_telefono, pa.dni AS paciente_dni,
         pa.fecha_nacimiento AS paciente_fecha_nacimiento,
         -- WhatsApp: el de esta reserva y el primario del paciente.
         t.telefono_whatsapp, t.canal,
         pa.telefono_whatsapp AS paciente_whatsapp,
         (up.password_hash IS NULL) AS paciente_es_invitado,
         -- Obra social ya resuelta, para el modal del turno.
         pa.obra_social_id, pa.nro_afiliado,
         os.nombre AS obra_social, os.sigla AS obra_social_sigla,
         um.nombre AS medico_nombre,   um.apellido AS medico_apellido,
         e.nombre  AS especialidad,
         -- Indica si el profesional cobra online. Solo el booleano: el token
         -- cifrado nunca sale de la tabla de medicos.
         (m.mp_access_token IS NOT NULL) AS medico_cobra_online,
         c.nombre  AS consultorio,
         CONCAT(c.calle, ' ', c.numero, ' - ', l.nombre) AS consultorio_direccion,
         COALESCE((SELECT SUM(p.monto) FROM pagos p
                    WHERE p.turno_id = t.id AND p.estado = 'aprobado'), 0) AS monto_pagado,
         -- Cuantas veces este paciente ya cancelo turnos CON ESTE MEDICO.
         -- Se cuentan solo las cancelaciones hechas por el paciente: las que
         -- cancelo el profesional o el admin no son responsabilidad suya.
         -- El alcance es por medico a proposito: un profesional no ve la
         -- conducta del paciente con otros tenants.
         (SELECT COUNT(*) FROM turnos tc
           WHERE tc.paciente_id = t.paciente_id
             AND tc.medico_id   = t.medico_id
             AND tc.estado      = 'cancelado'
             AND tc.cancelado_por = 'paciente'
             AND tc.id <> t.id) AS cancelaciones_paciente,
         (SELECT MAX(tc.cancelado_at) FROM turnos tc
           WHERE tc.paciente_id = t.paciente_id
             AND tc.medico_id   = t.medico_id
             AND tc.estado      = 'cancelado'
             AND tc.cancelado_por = 'paciente'
             AND tc.id <> t.id) AS ultima_cancelacion_paciente
    FROM turnos t
    JOIN pacientes pa     ON pa.id = t.paciente_id
    JOIN users up         ON up.id = pa.user_id
    LEFT JOIN obras_sociales os ON os.id = pa.obra_social_id
    JOIN medicos m        ON m.id  = t.medico_id
    JOIN users um         ON um.id = m.user_id
    JOIN especialidades e ON e.id  = m.especialidad_id
    JOIN consultorios c   ON c.id  = t.consultorio_id
    JOIN localidades l    ON l.id  = c.localidad_id`;

const Turno = {
  findById(id) {
    return queryOne(`${SELECT_BASE} WHERE t.id = ?`, [id]);
  },

  /**
   * Agenda del medico en un rango de fechas (vista semanal del panel).
   */
  listarPorMedico(medicoId, { desde, hasta, estado = null } = {}) {
    const where = ['t.medico_id = ?'];
    const params = [medicoId];

    if (desde) { where.push('t.fecha >= ?'); params.push(desde); }
    if (hasta) { where.push('t.fecha <= ?'); params.push(hasta); }
    if (estado) { where.push('t.estado = ?'); params.push(estado); }

    return query(
      `${SELECT_BASE} WHERE ${where.join(' AND ')} ORDER BY t.fecha, t.hora_inicio`,
      params
    );
  },

  listarPorPaciente(pacienteId, { soloFuturos = false } = {}) {
    return query(
      `${SELECT_BASE}
        WHERE t.paciente_id = ? ${soloFuturos ? 'AND t.fecha >= CURDATE()' : ''}
        ORDER BY t.fecha DESC, t.hora_inicio DESC`,
      [pacienteId]
    );
  },

  /**
   * Registro de cancelaciones de un paciente con un medico: cuantas fueron y
   * cuando. Es la fuente de verdad del indicador que la agenda muestra en rojo.
   *
   * No hay contador desnormalizado en `pacientes`: el dato se deriva de los
   * propios turnos, que no se borran al cancelarse (pasan a estado
   * 'cancelado' y conservan cancelado_at). Mantener un contador aparte seria
   * un dato redundante y una fuente de desincronizacion.
   *
   * `horas_antelacion` se calcula al vuelo: con cuanta anticipacion se cancelo
   * respecto del turno. Negativo significa que se cancelo pasada la hora.
   */
  historialCancelaciones(pacienteId, medicoId) {
    return query(
      `SELECT t.id, t.fecha, t.hora_inicio, t.cancelado_at, t.motivo_cancelacion,
              c.nombre AS consultorio,
              ROUND(TIMESTAMPDIFF(MINUTE, t.cancelado_at,
                    TIMESTAMP(t.fecha, t.hora_inicio)) / 60, 1) AS horas_antelacion
         FROM turnos t
         JOIN consultorios c ON c.id = t.consultorio_id
        WHERE t.paciente_id = ?
          AND t.medico_id   = ?
          AND t.estado      = 'cancelado'
          AND t.cancelado_por = 'paciente'
        ORDER BY t.cancelado_at DESC`,
      [pacienteId, medicoId]
    );
  },

  /**
   * Cuantas veces cancelo el paciente, por medico. Lo usa el panel del
   * paciente para mostrarle su propio registro.
   */
  resumenCancelacionesDelPaciente(pacienteId) {
    return query(
      `SELECT t.medico_id,
              u.nombre AS medico_nombre, u.apellido AS medico_apellido,
              COUNT(*) AS cantidad,
              MAX(t.cancelado_at) AS ultima
         FROM turnos t
         JOIN medicos m ON m.id = t.medico_id
         JOIN users u   ON u.id = m.user_id
        WHERE t.paciente_id = ?
          AND t.estado = 'cancelado'
          AND t.cancelado_por = 'paciente'
        GROUP BY t.medico_id, u.nombre, u.apellido`,
      [pacienteId]
    );
  },

  /**
   * Existe relacion medico-paciente? Es la barrera de acceso a los datos
   * clinicos: la relacion la establece haber tenido al menos un turno.
   * Se resuelve con un EXISTS en lugar de traer todos los turnos.
   */
  async existeRelacion(pacienteId, medicoId) {
    const fila = await queryOne(
      `SELECT EXISTS(
         SELECT 1 FROM turnos WHERE paciente_id = ? AND medico_id = ? LIMIT 1
       ) AS existe`,
      [pacienteId, medicoId]
    );
    return Boolean(Number(fila.existe));
  },

  /** Turnos vigentes de un medico en una fecha: se restan a la disponibilidad. */
  listarOcupadosDelDia(medicoId, fecha) {
    return query(
      `SELECT consultorio_id, hora_inicio, hora_fin
         FROM turnos
        WHERE medico_id = ? AND fecha = ? AND estado <> 'cancelado'`,
      [medicoId, fecha]
    );
  },

  /**
   * Reserva atomica de un turno.
   * 1) Bloquea las filas del medico en esa fecha (FOR UPDATE).
   * 2) Verifica que ningun turno vigente se superponga.
   * 3) Inserta.
   *
   * @throws {Error} con code 'SLOT_OCUPADO' si el horario ya esta tomado.
   */
  async reservar({
    pacienteId, medicoId, consultorioId, fecha, horaInicio, horaFin, montoTotal,
    motivoConsulta = null, telefonoWhatsapp = null, canal = 'web',
  }) {
    return transaction(async (cx) => {
      const [ocupados] = await cx.execute(
        `SELECT id FROM turnos
          WHERE medico_id = ? AND fecha = ? AND estado <> 'cancelado'
            AND hora_inicio < ? AND ? < hora_fin
          FOR UPDATE`,
        [medicoId, fecha, horaFin, horaInicio]
      );
      if (ocupados.length) {
        const err = new Error('El horario ya no esta disponible');
        err.code = 'SLOT_OCUPADO';
        throw err;
      }

      // El consultorio tampoco puede estar ocupado por otro medico.
      const [ocupadoConsultorio] = await cx.execute(
        `SELECT id FROM turnos
          WHERE consultorio_id = ? AND fecha = ? AND estado <> 'cancelado'
            AND hora_inicio < ? AND ? < hora_fin
          FOR UPDATE`,
        [consultorioId, fecha, horaFin, horaInicio]
      );
      if (ocupadoConsultorio.length) {
        const err = new Error('El consultorio esta ocupado en ese horario');
        err.code = 'SLOT_OCUPADO';
        throw err;
      }

      const [res] = await cx.execute(
        `INSERT INTO turnos
           (paciente_id, medico_id, consultorio_id, fecha, hora_inicio, hora_fin,
            monto_total, motivo_consulta, telefono_whatsapp, canal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [pacienteId, medicoId, consultorioId, fecha, horaInicio, horaFin,
          montoTotal, motivoConsulta, telefonoWhatsapp, canal]
      );
      return res.insertId;
    });
  },

  async cambiarEstado(id, estado) {
    await query('UPDATE turnos SET estado = ? WHERE id = ?', [estado, id]);
    return Turno.findById(id);
  },

  /**
   * Cancelacion. Registra quien cancelo y por que (trazabilidad).
   * El turno no se borra: queda en el historial y libera el slot porque
   * `activo_key` pasa a NULL y sale del indice unico.
   */
  async cancelar(id, { canceladoPor, motivo = null }) {
    await query(
      `UPDATE turnos
          SET estado = 'cancelado', cancelado_por = ?, motivo_cancelacion = ?, cancelado_at = NOW()
        WHERE id = ? AND estado <> 'cancelado'`,
      [canceladoPor, motivo, id]
    );
    return Turno.findById(id);
  },

  /** Cancela en bloque (ej: el medico da de baja un dia entero). */
  async cancelarPorHorario(medicoId, consultorioId, fecha, motivo) {
    const res = await query(
      `UPDATE turnos
          SET estado = 'cancelado', cancelado_por = 'medico', motivo_cancelacion = ?, cancelado_at = NOW()
        WHERE medico_id = ? AND consultorio_id = ? AND fecha = ? AND estado <> 'cancelado'`,
      [motivo, medicoId, consultorioId, fecha]
    );
    return res.affectedRows;
  },
};

module.exports = Turno;
