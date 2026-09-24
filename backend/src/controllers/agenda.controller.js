/**
 * controllers/agenda.controller.js
 * Agenda DIARIA del medico: la grilla que alimenta react-big-calendar.
 *
 * A diferencia de /turnos/agenda (que lista solo los turnos reservados), aca
 * se devuelve la jornada completa intercalando los dos tipos de intervalo:
 *
 *   - "ocupado":    un turno reservado, con los datos del paciente
 *   - "disponible": un slot libre de la plantilla del medico
 *
 * El frontend los pinta distinto y solo abre el modal en los ocupados.
 */
const Turno = require('../models/turno.model');
const Consultorio = require('../models/consultorio.model');
const Ausencia = require('../models/ausencia.model');
const ApiError = require('../utils/ApiError');
const { slotsDelDia } = require('../utils/disponibilidad');
const { hoyIso, horaAMinutos } = require('../utils/tiempo');

/**
 * GET /api/agenda/dia?fecha=YYYY-MM-DD&consultorioId=  (medico)
 *
 * Devuelve los intervalos del dia listos para el calendario. `fechaHoraInicio`
 * viene en formato ISO local ("2026-09-21T09:00:00") porque es lo que
 * react-big-calendar espera convertir a Date sin ambiguedad de zona.
 */
async function agendaDelDia(req, res) {
  const fecha = req.query.fecha || hoyIso();
  const filtroConsultorio = req.query.consultorioId ? Number(req.query.consultorioId) : null;

  // 1. Turnos reservados (incluye los cancelados, para que el medico los vea).
  const turnos = await Turno.listarPorMedico(req.medico.id, { desde: fecha, hasta: fecha });

  /*
   * 2. Slots libres. slotsDelDia ya descuenta turnos vigentes y ausencias.
   *
   * Se pide SIN aplicar el modo de agenda: el medico tiene que ver todos sus
   * huecos reales para saber como viene el dia. Con el filtro de orden de
   * llegada puesto veria un unico hueco verde y el resto de la jornada como
   * si no existiera. Cada slot trae `habilitado`, que dice cual de esos
   * huecos puede tomar ahora mismo un paciente.
   */
  const libres = await slotsDelDia(req.medico, fecha, { aplicarModoAgenda: false });

  // 3. Consultorios del medico + los que estan marcados como ausencia ese dia.
  const consultorios = await Consultorio.listarPorMedico(req.medico.id, { soloActivos: true });
  const bloqueados = await Ausencia.consultoriosBloqueados(req.medico.id, fecha);
  const ausencias = await Ausencia.listarPorMedico(req.medico.id, { desde: fecha, hasta: fecha });

  const ocupados = turnos
    .filter((t) => !filtroConsultorio || t.consultorio_id === filtroConsultorio)
    .map((t) => ({
      tipo: 'ocupado',
      // Id unico para el calendario: no puede chocar con los de los libres.
      key: `turno-${t.id}`,
      turnoId: t.id,
      fecha: String(t.fecha).slice(0, 10),
      horaInicio: t.hora_inicio,
      horaFin: t.hora_fin,
      fechaHoraInicio: `${String(t.fecha).slice(0, 10)}T${t.hora_inicio}`,
      fechaHoraFin: `${String(t.fecha).slice(0, 10)}T${t.hora_fin}`,
      estado: t.estado,
      consultorioId: t.consultorio_id,
      consultorio: t.consultorio,
      paciente: {
        id: t.paciente_id,
        nombre: t.paciente_nombre,
        apellido: t.paciente_apellido,
        dni: t.paciente_dni,
        telefono: t.paciente_telefono,
        whatsapp: t.telefono_whatsapp || t.paciente_whatsapp,
        esInvitado: Boolean(t.paciente_es_invitado),
        obraSocial: t.obra_social,
        nroAfiliado: t.nro_afiliado,
      },
      canal: t.canal,
      montoPagado: Number(t.monto_pagado),
      montoTotal: Number(t.monto_total),
      cancelacionesPaciente: Number(t.cancelaciones_paciente),
    }));

  const disponibles = libres
    .filter((s) => !filtroConsultorio || s.consultorioId === filtroConsultorio)
    .map((s) => ({
      tipo: 'disponible',
      key: `libre-${s.consultorioId}-${s.horaInicio}`,
      fecha: s.fecha,
      horaInicio: s.horaInicio,
      horaFin: s.horaFin,
      fechaHoraInicio: `${s.fecha}T${s.horaInicio}`,
      fechaHoraFin: `${s.fecha}T${s.horaFin}`,
      consultorioId: s.consultorioId,
      consultorio: s.consultorio,
      // Con seleccion libre siempre es true. Con orden de llegada distingue
      // el turno que el paciente puede tomar de los que estan mas atras en
      // la fila, que se muestran al medico pero todavia no se ofrecen.
      habilitado: s.habilitado !== false,
      jornadaInicio: s.jornadaInicio,
      jornadaProxima: Boolean(s.jornadaProxima),
    }));

  const intervalos = [...ocupados, ...disponibles]
    .sort((a, b) => horaAMinutos(a.horaInicio) - horaAMinutos(b.horaInicio));

  return res.json({
    ok: true,
    fecha,
    intervalos,
    consultorios: consultorios.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      localidad: c.localidad,
      // Marca si ese consultorio esta cancelado para esta fecha.
      bloqueado: bloqueados.includes(c.id),
    })),
    ausencias,
    resumen: {
      ocupados: ocupados.filter((o) => o.estado !== 'cancelado').length,
      cancelados: ocupados.filter((o) => o.estado === 'cancelado').length,
      disponibles: disponibles.length,
      // Cuantos de esos huecos puede tomar hoy un paciente. Con orden de
      // llegada es menor que `disponibles` mientras la jornada este lejos.
      habilitados: disponibles.filter((d) => d.habilitado).length,
      modoAgenda: req.medico.modo_agenda || 'libre',
      diaBloqueado: consultorios.length > 0 && consultorios.every((c) => bloqueados.includes(c.id)),
    },
  });
}

/**
 * POST /api/agenda/cancelar-dia  (medico)
 * Body: { fecha, consultorioIds?: number[], motivo? }
 *
 * Cancela la jornada. Si el medico tiene varios consultorios puede elegir a
 * cuales no se presentara; si no se envia `consultorioIds` se cancelan todos.
 *
 * Hace las dos cosas que la operacion requiere, en una transaccion:
 *   1. cancela los turnos vigentes de esa fecha y consultorios;
 *   2. registra la ausencia, para que no entren turnos nuevos.
 */
async function cancelarDia(req, res) {
  const { fecha, motivo = null } = req.body;

  const consultorios = await Consultorio.listarPorMedico(req.medico.id, { soloActivos: true });
  if (!consultorios.length) throw ApiError.badRequest('No tenes consultorios activos');

  const idsDelMedico = consultorios.map((c) => c.id);

  // Sin seleccion explicita -> el dia completo.
  let ids = Array.isArray(req.body.consultorioIds) && req.body.consultorioIds.length
    ? req.body.consultorioIds.map(Number)
    : idsDelMedico;

  // Aislamiento: solo consultorios propios. Se ignoran los ajenos en lugar de
  // fallar, pero si no queda ninguno valido se corta.
  const ajenos = ids.filter((id) => !idsDelMedico.includes(id));
  ids = ids.filter((id) => idsDelMedico.includes(id));
  if (!ids.length) throw ApiError.badRequest('Ninguno de los consultorios indicados te pertenece');

  const resultado = await Ausencia.cancelarDia(req.medico.id, fecha, ids, motivo);

  const nombres = consultorios.filter((c) => ids.includes(c.id)).map((c) => c.nombre);
  const diaCompleto = ids.length === idsDelMedico.length;

  return res.json({
    ok: true,
    mensaje: diaCompleto
      ? `Dia ${fecha} cancelado por completo. Se cancelaron ${resultado.turnosCancelados} turno(s).`
      : `No atenderas en ${nombres.join(', ')} el ${fecha}. Se cancelaron ${resultado.turnosCancelados} turno(s).`,
    fecha,
    diaCompleto,
    consultoriosCancelados: nombres,
    turnosCancelados: resultado.turnosCancelados,
    detalle: resultado.detalle,
    ...(ajenos.length ? { advertencia: 'Se ignoraron consultorios que no te pertenecen' } : {}),
  });
}

/**
 * DELETE /api/agenda/cancelar-dia  (medico)
 * Body: { fecha, consultorioIds? }
 *
 * Reactiva la jornada: vuelve a ofrecer los slots. Los turnos que ya se
 * cancelaron NO se restauran: los pacientes fueron avisados y pudieron
 * reservar en otro lado, asi que deben volver a pedir turno.
 */
async function reactivarDia(req, res) {
  const { fecha } = req.body;
  const ids = Array.isArray(req.body.consultorioIds) && req.body.consultorioIds.length
    ? req.body.consultorioIds.map(Number)
    : null;

  const quitadas = await Ausencia.reactivar(req.medico.id, fecha, ids);
  if (!quitadas) throw ApiError.notFound('Ese dia no estaba cancelado');

  return res.json({
    ok: true,
    mensaje: `Jornada del ${fecha} reactivada. Los turnos ya cancelados no se restauran.`,
    ausenciasQuitadas: quitadas,
  });
}

/**
 * GET /api/agenda/ausencias?desde&hasta  (medico)
 * Devuelve los periodos agrupados y tambien el detalle dia por dia.
 */
async function listarAusencias(req, res) {
  const rango = {
    desde: req.query.desde || hoyIso(),
    hasta: req.query.hasta || null,
  };

  const [ausencias, periodos] = await Promise.all([
    Ausencia.listarPorMedico(req.medico.id, rango),
    Ausencia.listarPeriodos(req.medico.id, rango),
  ]);

  return res.json({ ok: true, ausencias, periodos, motivos: Ausencia.MOTIVOS });
}

/**
 * POST /api/agenda/suspender  (medico)
 * Body: { desde, hasta, consultorioIds?, tipoMotivo, motivo? }
 *
 * Suspende un dia o un RANGO de dias completo. Hace lo mismo que cancelar un
 * dia, pero repetido sobre el periodo y agrupado bajo un identificador comun
 * para poder levantarlo despues de una sola vez.
 *
 * Igual que la cancelacion de un dia, hace las dos cosas que la operacion
 * necesita: cancela los turnos existentes Y bloquea la reserva de nuevos.
 */
async function suspenderRango(req, res) {
  const { desde, tipoMotivo = 'otro', motivo = null } = req.body;
  const hasta = req.body.hasta || desde;

  if (hasta < desde) {
    throw ApiError.badRequest('La fecha de fin no puede ser anterior a la de inicio');
  }

  const consultorios = await Consultorio.listarPorMedico(req.medico.id, { soloActivos: true });
  if (!consultorios.length) throw ApiError.badRequest('No tenes consultorios activos');

  const idsDelMedico = consultorios.map((c) => c.id);

  // Sin seleccion explicita se suspenden todos los consultorios.
  let ids = Array.isArray(req.body.consultorioIds) && req.body.consultorioIds.length
    ? req.body.consultorioIds.map(Number).filter((id) => idsDelMedico.includes(id))
    : idsDelMedico;

  if (!ids.length) throw ApiError.badRequest('Ninguno de los consultorios indicados te pertenece');

  const resultado = await Ausencia.suspenderRango(req.medico.id, desde, hasta, ids, {
    tipoMotivo, motivo,
  });

  const etiqueta = Ausencia.MOTIVOS[tipoMotivo] || 'Suspension';
  const nombres = consultorios.filter((c) => ids.includes(c.id)).map((c) => c.nombre);

  return res.status(201).json({
    ok: true,
    mensaje: resultado.dias === 1
      ? `${etiqueta}: dia ${desde} suspendido. Se cancelaron ${resultado.turnosCancelados} turno(s).`
      : `${etiqueta}: ${resultado.dias} dias suspendidos (${desde} al ${hasta}). `
        + `Se cancelaron ${resultado.turnosCancelados} turno(s).`,
    suspension: { ...resultado, consultorios: nombres },
  });
}

/**
 * DELETE /api/agenda/suspender/:rangoId  (medico)
 * Levanta una suspension completa.
 *
 * Los turnos que se cancelaron NO se restauran: los pacientes fueron
 * avisados y pudieron reservar en otro lado, asi que deben volver a pedir.
 */
async function levantarSuspension(req, res) {
  const quitadas = await Ausencia.levantarRango(req.medico.id, req.params.rangoId);
  if (!quitadas) throw ApiError.notFound('No se encontro esa suspension');

  return res.json({
    ok: true,
    mensaje: 'Suspension levantada. Esos dias vuelven a ofrecer turnos. '
      + 'Los turnos ya cancelados no se restauran.',
    diasLiberados: quitadas,
  });
}

module.exports = {
  agendaDelDia,
  cancelarDia,
  reactivarDia,
  listarAusencias,
  suspenderRango,
  levantarSuspension,
};
