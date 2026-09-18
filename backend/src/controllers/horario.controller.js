/**
 * controllers/horario.controller.js
 * CRUD de la plantilla semanal de atencion.
 *
 * Validacion clave del sistema: NO se permite que dos bloques del mismo
 * medico se superpongan, aunque esten en consultorios distintos (un medico no
 * puede atender en dos direcciones a la vez). Tampoco se permite que dos
 * medicos ocupen el mismo consultorio en el mismo tramo.
 */
const Horario = require('../models/horario.model');
const Consultorio = require('../models/consultorio.model');
const Turno = require('../models/turno.model');
const ApiError = require('../utils/ApiError');
const { normalizarHora, horaAMinutos, DIAS_SEMANA } = require('../utils/tiempo');

/**
 * Valida el payload y devuelve los datos normalizados.
 * @param {number} excluirId  id del propio horario al editar
 */
async function validarBloque(req, excluirId = null) {
  const { consultorioId, diaSemana } = req.body;
  const horaInicio = normalizarHora(req.body.horaInicio);
  const horaFin = normalizarHora(req.body.horaFin);

  if (horaAMinutos(horaInicio) >= horaAMinutos(horaFin)) {
    throw ApiError.badRequest('La hora de inicio debe ser anterior a la hora de fin');
  }

  // El consultorio debe pertenecer al tenant (aislamiento).
  const consultorio = await Consultorio.findByIdDelMedico(consultorioId, req.medico.id);
  if (!consultorio) throw ApiError.badRequest('El consultorio no existe o no te pertenece');
  if (!consultorio.activo) throw ApiError.badRequest('El consultorio esta desactivado');

  // 1) Choque con otro bloque del mismo medico (en cualquier consultorio).
  const propios = await Horario.findSuperpuestos(
    req.medico.id, diaSemana, horaInicio, horaFin, excluirId
  );
  if (propios.length) {
    const c = propios[0];
    throw ApiError.conflict(
      `Ya atendes los ${DIAS_SEMANA[diaSemana]} de ${c.hora_inicio.slice(0, 5)} a ` +
      `${c.hora_fin.slice(0, 5)} en "${c.consultorio}". No podes estar en dos consultorios a la vez.`
    );
  }

  // 2) Choque con otro medico en el mismo consultorio.
  const ajenos = await Horario.findSuperpuestosEnConsultorio(
    consultorioId, diaSemana, horaInicio, horaFin, excluirId
  );
  const deOtroMedico = ajenos.filter((h) => h.medico_id !== req.medico.id);
  if (deOtroMedico.length) {
    throw ApiError.conflict('El consultorio ya esta ocupado por otro profesional en ese horario');
  }

  return { consultorioId, diaSemana: Number(diaSemana), horaInicio, horaFin };
}

/**
 * GET /api/horarios
 * Devuelve la plantilla plana y agrupada por dia (lo que pinta la agenda).
 */
async function listar(req, res) {
  const horarios = await Horario.listarPorMedico(req.medico.id, {
    soloActivos: req.query.activos === 'true',
  });

  const porDia = {};
  for (let d = 1; d <= 7; d += 1) porDia[d] = [];
  horarios.forEach((h) => porDia[h.dia_semana].push(h));

  return res.json({ ok: true, horarios, porDia, dias: DIAS_SEMANA });
}

/** GET /api/horarios/:id */
async function detalle(req, res) {
  const horario = await Horario.findByIdDelMedico(req.params.id, req.medico.id);
  if (!horario) throw ApiError.notFound('Horario no encontrado');
  return res.json({ ok: true, horario });
}

/** POST /api/horarios */
async function crear(req, res) {
  const datos = await validarBloque(req);
  const horario = await Horario.create(req.medico.id, datos);
  return res.status(201).json({ ok: true, mensaje: 'Horario creado', horario });
}

/** PUT /api/horarios/:id */
async function actualizar(req, res) {
  const existente = await Horario.findByIdDelMedico(req.params.id, req.medico.id);
  if (!existente) throw ApiError.notFound('Horario no encontrado');

  const datos = await validarBloque(req, Number(req.params.id));
  const horario = await Horario.update(req.params.id, req.medico.id, {
    ...datos,
    activo: req.body.activo ?? existente.activo,
  });

  return res.json({ ok: true, mensaje: 'Horario actualizado', horario });
}

/**
 * DELETE /api/horarios/:id
 * Borrar la plantilla no cancela los turnos ya reservados dentro de ella: se
 * avisa cuantos quedan para que el medico decida cancelarlos desde la agenda.
 */
async function eliminar(req, res) {
  const existente = await Horario.findByIdDelMedico(req.params.id, req.medico.id);
  if (!existente) throw ApiError.notFound('Horario no encontrado');

  await Horario.remove(req.params.id, req.medico.id);

  const futuros = await Turno.listarPorMedico(req.medico.id, { desde: new Date().toISOString().slice(0, 10) });
  const afectados = futuros.filter(
    (t) => t.estado !== 'cancelado'
      && t.consultorio_id === existente.consultorio_id
      && t.hora_inicio >= existente.hora_inicio
      && t.hora_inicio < existente.hora_fin
  );

  return res.json({
    ok: true,
    mensaje: 'Horario eliminado',
    turnosFuturosAfectados: afectados.length,
    ...(afectados.length
      ? { advertencia: `Quedan ${afectados.length} turno(s) ya reservados en esa franja. Cancelalos desde la agenda si corresponde.` }
      : {}),
  });
}

module.exports = { listar, detalle, crear, actualizar, eliminar };
