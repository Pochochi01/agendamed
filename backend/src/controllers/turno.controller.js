/**
 * controllers/turno.controller.js
 * Reserva, consulta y cancelacion de turnos.
 *
 * Reglas:
 *  - solo se reserva contra medicos activos y sobre slots realmente libres;
 *  - la reserva es transaccional (ver Turno.reservar) para evitar dobles
 *    reservas en condiciones de concurrencia;
 *  - el paciente solo ve y cancela sus propios turnos; el medico solo los de
 *    su agenda; el admin puede cancelar cualquiera.
 */
const Turno = require('../models/turno.model');
const Medico = require('../models/medico.model');
const Paciente = require('../models/paciente.model');
const Pago = require('../models/pago.model');
const ApiError = require('../utils/ApiError');
const { buscarSlot } = require('../utils/disponibilidad');
const { hoyIso, sumarDias, horasHasta } = require('../utils/tiempo');
const { negocio } = require('../config/env');

/**
 * POST /api/turnos   (paciente)
 * Body: medicoId, fecha, horaInicio, consultorioId?, motivoConsulta?
 *
 * `consultorioId` es el consultorio que el paciente eligio en el paso 2 del
 * flujo de reserva. Es opcional por compatibilidad, pero si viene se exige
 * que coincida con el consultorio real del slot: asi un turno nunca se
 * termina reservando en un consultorio distinto al que el paciente vio, por
 * ejemplo si el medico reorganizo su agenda mientras el elegia el horario.
 */
async function reservar(req, res) {
  const { medicoId, fecha, horaInicio, consultorioId = null, motivoConsulta = null } = req.body;

  const paciente = await Paciente.findByUserId(req.usuario.id);
  if (!paciente) throw ApiError.forbidden('Tu usuario no tiene perfil de paciente');

  const medico = await Medico.findById(medicoId);
  if (!medico || medico.estado !== 'activo' || !medico.usuario_activo) {
    throw ApiError.badRequest('El profesional no esta disponible para recibir turnos');
  }

  if (fecha < hoyIso()) throw ApiError.badRequest('No se pueden reservar turnos en fechas pasadas');

  // El slot debe existir en la plantilla y estar libre.
  const slot = await buscarSlot(medico, fecha, horaInicio);
  if (!slot) {
    throw ApiError.conflict('Ese horario no esta disponible. Actualiza el calendario y elegi otro.');
  }

  // El horario tiene que pertenecer al consultorio que el paciente eligio.
  if (consultorioId && Number(consultorioId) !== slot.consultorioId) {
    throw ApiError.conflict(
      `Ese horario corresponde al consultorio "${slot.consultorio}", no al que seleccionaste. ` +
      'Actualiza la disponibilidad y volve a elegir.'
    );
  }

  // Un profesional sin credenciales de MercadoPago no cobra online: su turno
  // no tiene nada que esperar y queda confirmado en el acto.
  const cobraOnline = Boolean(medico.mercadopago_configurado) && Number(medico.precio_consulta) > 0;

  try {
    const turnoId = await Turno.reservar({
      pacienteId: paciente.id,
      medicoId: medico.id,
      consultorioId: slot.consultorioId,
      fecha,
      horaInicio: slot.horaInicio,
      horaFin: slot.horaFin,
      montoTotal: medico.precio_consulta,
      motivoConsulta,
    });

    if (!cobraOnline) await Turno.cambiarEstado(turnoId, 'confirmado');

    const turno = await Turno.findById(turnoId);

    if (!cobraOnline) {
      return res.status(201).json({
        ok: true,
        mensaje: 'Turno confirmado. El pago se abona en el consultorio.',
        requierePago: false,
        turno,
        pago: null,
      });
    }

    const montoSena = Math.round((Number(medico.precio_consulta) * Number(medico.porcentaje_sena)) / 100);

    return res.status(201).json({
      ok: true,
      mensaje: 'Turno reservado. Confirmalo con el pago de la sena o del total.',
      requierePago: true,
      turno,
      pago: {
        montoTotal: Number(medico.precio_consulta),
        montoSena,
        porcentajeSena: medico.porcentaje_sena,
      },
    });
  } catch (error) {
    if (error.code === 'SLOT_OCUPADO' || error.code === 'ER_DUP_ENTRY') {
      throw ApiError.conflict('Ese horario acaba de ser reservado por otro paciente');
    }
    throw error;
  }
}

/** GET /api/turnos/mis-turnos  (paciente) */
async function misTurnos(req, res) {
  const paciente = await Paciente.findByUserId(req.usuario.id);
  if (!paciente) throw ApiError.forbidden('Tu usuario no tiene perfil de paciente');

  const turnos = await Turno.listarPorPaciente(paciente.id, {
    soloFuturos: req.query.futuros === 'true',
  });

  // El paciente ve su propio registro de cancelaciones, por profesional.
  const cancelaciones = await Turno.resumenCancelacionesDelPaciente(paciente.id);

  return res.json({
    ok: true,
    turnos,
    // Ya no bloquea: es solo la antelacion sugerida para avisar al paciente.
    horasRecomendadasCancelacion: negocio.cancelacionHorasRecomendadas,
    cancelaciones,
    totalCancelaciones: cancelaciones.reduce((acc, c) => acc + Number(c.cantidad), 0),
  });
}

/**
 * GET /api/turnos/agenda?desde&hasta  (medico)
 * Por defecto trae la semana en curso.
 */
async function agendaDelMedico(req, res) {
  const desde = req.query.desde || hoyIso();
  const hasta = req.query.hasta || sumarDias(desde, 6);

  const turnos = await Turno.listarPorMedico(req.medico.id, {
    desde,
    hasta,
    estado: req.query.estado || null,
  });

  return res.json({
    ok: true,
    desde,
    hasta,
    turnos,
    // El frontend marca en rojo los turnos cuyo paciente supera este umbral.
    umbralCancelaciones: negocio.cancelacionesAlerta,
  });
}

/** GET /api/turnos/:id  (paciente dueno, medico dueno o admin) */
async function detalle(req, res) {
  const turno = await Turno.findById(req.params.id);
  if (!turno) throw ApiError.notFound('Turno no encontrado');

  await verificarAcceso(req, turno);

  const pagos = await Pago.listarPorTurno(turno.id);
  return res.json({ ok: true, turno, pagos });
}

/**
 * PATCH /api/turnos/:id/cancelar
 * Body: motivo?
 *
 * TODO turno vigente puede cancelarse: el paciente nunca queda atrapado con un
 * turno al que no va a poder ir. Antes habia un limite de antelacion que lo
 * bloqueaba; se quito y en su lugar quedan dos cosas:
 *   - se avisa cuando la cancelacion es sobre la hora (horasAntelacion);
 *   - queda registrada en el turno (cancelado_por + cancelado_at), y la agenda
 *     del medico marca a quien cancela repetidamente.
 *
 * Lo unico que no se puede cancelar es un turno ya cancelado, uno realizado o
 * uno cuya hora ya paso.
 */
async function cancelar(req, res) {
  const turno = await Turno.findById(req.params.id);
  if (!turno) throw ApiError.notFound('Turno no encontrado');

  const quien = await verificarAcceso(req, turno);

  if (turno.estado === 'cancelado') throw ApiError.conflict('El turno ya estaba cancelado');
  if (turno.estado === 'completado') throw ApiError.conflict('No se puede cancelar un turno ya realizado');

  const horasRestantes = horasHasta(turno.fecha, turno.hora_inicio);
  if (quien === 'paciente' && horasRestantes < 0) {
    throw ApiError.conflict('El turno ya paso y no puede cancelarse');
  }

  const cancelado = await Turno.cancelar(turno.id, {
    canceladoPor: quien,
    motivo: req.body.motivo || null,
  });

  const pagado = await Pago.totalAprobadoDeTurno(turno.id);
  const sobreLaHora = horasRestantes < negocio.cancelacionHorasRecomendadas;

  // Registro actualizado del paciente con este medico (ya incluye esta).
  const totalCancelaciones = quien === 'paciente'
    ? Number(cancelado.cancelaciones_paciente) + 1
    : Number(cancelado.cancelaciones_paciente);

  return res.json({
    ok: true,
    mensaje: 'Turno cancelado',
    turno: cancelado,
    registro: {
      canceladoPor: quien,
      canceladoAt: cancelado.cancelado_at,
      horasAntelacion: Math.round(horasRestantes * 10) / 10,
      sobreLaHora: quien === 'paciente' && sobreLaHora,
      horasRecomendadas: negocio.cancelacionHorasRecomendadas,
      // Cuantas veces cancelo este paciente con este profesional.
      cancelacionesDelPaciente: totalCancelaciones,
      superaUmbral: quien === 'paciente' && totalCancelaciones > negocio.cancelacionesAlerta,
    },
    reintegro: pagado > 0
      ? {
          montoPagado: pagado,
          corresponde: true,
          nota: 'El reintegro se gestiona desde el panel de MercadoPago del profesional.',
        }
      : null,
  });
}

/**
 * GET /api/turnos/pacientes/:pacienteId/cancelaciones   (medico)
 * Detalle de las cancelaciones de un paciente CON ESTE PROFESIONAL: cuantas
 * fueron, cuando y con cuanta antelacion. Alimenta el historial que el medico
 * abre desde la agenda antes de decidir si cancela o llama al paciente.
 */
async function cancelacionesDePaciente(req, res) {
  const cancelaciones = await Turno.historialCancelaciones(req.params.pacienteId, req.medico.id);
  const paciente = await Paciente.findById(req.params.pacienteId);
  if (!paciente) throw ApiError.notFound('Paciente no encontrado');

  return res.json({
    ok: true,
    paciente: {
      id: paciente.id,
      nombre: paciente.nombre,
      apellido: paciente.apellido,
      email: paciente.email,
      telefono: paciente.telefono,
    },
    cancelaciones,
    total: cancelaciones.length,
    umbral: negocio.cancelacionesAlerta,
    superaUmbral: cancelaciones.length > negocio.cancelacionesAlerta,
  });
}

/**
 * PATCH /api/turnos/:id/estado  (medico)
 * Marca el turno como confirmado / completado / ausente.
 */
async function cambiarEstado(req, res) {
  const { estado } = req.body;
  if (!['confirmado', 'completado', 'ausente'].includes(estado)) {
    throw ApiError.badRequest('Estado invalido. Usa: confirmado, completado o ausente');
  }

  const turno = await Turno.findById(req.params.id);
  if (!turno) throw ApiError.notFound('Turno no encontrado');
  if (turno.medico_id !== req.medico.id) throw ApiError.forbidden('El turno no pertenece a tu agenda');
  if (turno.estado === 'cancelado') throw ApiError.conflict('El turno esta cancelado');

  const actualizado = await Turno.cambiarEstado(turno.id, estado);
  return res.json({ ok: true, mensaje: `Turno marcado como ${estado}`, turno: actualizado });
}

/** GET /api/turnos/mis-pacientes  (medico) */
async function misPacientes(req, res) {
  const pacientes = await Paciente.listarPorMedico(req.medico.id);
  return res.json({ ok: true, pacientes });
}

/**
 * Comprueba que el usuario logueado pueda operar sobre el turno.
 * @returns {Promise<'paciente'|'medico'|'admin'>} en que carater actua
 */
async function verificarAcceso(req, turno) {
  if (req.usuario.rol === 'admin') return 'admin';

  if (req.usuario.rol === 'paciente') {
    const paciente = await Paciente.findByUserId(req.usuario.id);
    if (paciente && paciente.id === turno.paciente_id) return 'paciente';
  }

  if (req.usuario.rol === 'medico') {
    const medico = req.medico || (await Medico.findByUserId(req.usuario.id));
    if (medico && medico.id === turno.medico_id) return 'medico';
  }

  throw ApiError.forbidden('No tenes acceso a este turno');
}

module.exports = {
  reservar,
  misTurnos,
  agendaDelMedico,
  detalle,
  cancelar,
  cancelacionesDePaciente,
  cambiarEstado,
  misPacientes,
};
