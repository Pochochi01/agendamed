/**
 * controllers/historia.controller.js
 * Obra social del paciente + evoluciones de la historia clinica.
 *
 * --------------------------------------------------------------------------
 * RESTRICCION DE ARQUITECTURA: aca NO entra audio.
 * --------------------------------------------------------------------------
 * El dictado se transcribe en el navegador con la Web Speech API
 * (frontend/src/components/DictadoVoz.jsx). Este controlador recibe unicamente
 * el campo `texto`. No hay multer, no hay multipart, no hay Buffer de audio:
 * si un cliente intentara subir un archivo, express.json lo rechaza antes de
 * llegar hasta aca. Por eso tampoco existe ninguna columna de audio en
 * `historias_clinicas`.
 */
const Historia = require('../models/historia.model');
const Paciente = require('../models/paciente.model');
const Turno = require('../models/turno.model');
const Catalogo = require('../models/catalogo.model');
const ApiError = require('../utils/ApiError');

/**
 * Verifica que el paciente haya tenido al menos un turno con este medico.
 *
 * Es la barrera de acceso a datos clinicos: sin esta comprobacion, cualquier
 * medico del sistema podria leer o escribir la historia de cualquier paciente
 * pasando un id. La relacion medico-paciente la establece el turno.
 *
 * @returns {Promise<Object>} el paciente
 */
async function pacienteAtendidoPor(pacienteId, medicoId) {
  const paciente = await Paciente.findById(pacienteId);
  if (!paciente) throw ApiError.notFound('Paciente no encontrado');

  if (!(await Turno.existeRelacion(paciente.id, medicoId))) {
    throw ApiError.forbidden('Este paciente no tiene turnos con vos');
  }

  return paciente;
}

/* ===================================================================== *
 *                            OBRA SOCIAL
 * ===================================================================== */

/**
 * PATCH /api/pacientes/:id/obra-social  (medico)
 * Body: { obraSocialId, nroAfiliado }
 *
 * La obra social se guarda en el PACIENTE, no en el turno: es un dato
 * persistente de la persona, no del evento. El medico la carga una vez y
 * queda disponible en los turnos siguientes.
 *
 * `obraSocialId: null` significa paciente particular (sin cobertura).
 */
async function actualizarObraSocial(req, res) {
  const paciente = await pacienteAtendidoPor(req.params.id, req.medico.id);

  const obraSocialId = req.body.obraSocialId ? Number(req.body.obraSocialId) : null;
  const nroAfiliado = req.body.nroAfiliado ? String(req.body.nroAfiliado).trim() : null;

  if (obraSocialId) {
    const obra = await Catalogo.findObraSocial(obraSocialId);
    if (!obra) throw ApiError.badRequest('La obra social indicada no existe');
  } else if (nroAfiliado) {
    throw ApiError.badRequest('No se puede cargar un numero de afiliado sin obra social');
  }

  const actualizado = await Paciente.actualizarObraSocial(paciente.id, { obraSocialId, nroAfiliado });

  return res.json({
    ok: true,
    mensaje: obraSocialId ? 'Obra social actualizada' : 'El paciente quedo registrado como particular',
    paciente: actualizado,
  });
}

/**
 * PATCH /api/pacientes/:id  (medico)
 * Corrige datos del paciente. NO toca el DNI (es la clave de identificacion)
 * ni el WhatsApp de origen (que es de solo lectura por requisito).
 */
async function actualizarDatosPaciente(req, res) {
  const paciente = await pacienteAtendidoPor(req.params.id, req.medico.id);

  const actualizado = await Paciente.actualizarDatos(paciente.id, {
    nombre: req.body.nombre,
    apellido: req.body.apellido,
    telefono: req.body.telefono || null,
    fechaNacimiento: req.body.fechaNacimiento || null,
  });

  return res.json({ ok: true, mensaje: 'Datos del paciente actualizados', paciente: actualizado });
}

/** GET /api/pacientes/:id  (medico) Ficha del paciente para el modal. */
async function fichaPaciente(req, res) {
  const paciente = await pacienteAtendidoPor(req.params.id, req.medico.id);
  const resumen = await Historia.resumen(paciente.id, req.medico.id);

  return res.json({
    ok: true,
    paciente,
    historia: { total: Number(resumen.total), ultima: resumen.ultima },
  });
}

/* ===================================================================== *
 *                         HISTORIA CLINICA
 * ===================================================================== */

/**
 * GET /api/pacientes/:id/historia  (medico)
 * Lista cronologica de evoluciones (mas nuevas primero).
 */
async function listarEvoluciones(req, res) {
  const paciente = await pacienteAtendidoPor(req.params.id, req.medico.id);
  const evoluciones = await Historia.listarPorPaciente(paciente.id, req.medico.id);

  return res.json({
    ok: true,
    paciente: {
      id: paciente.id,
      nombre: paciente.nombre,
      apellido: paciente.apellido,
      dni: paciente.dni,
    },
    evoluciones,
    total: evoluciones.length,
  });
}

/**
 * POST /api/pacientes/:id/historia  (medico)
 * Body: { texto, turnoId?, origen? }
 *
 * Inserta la evolucion. `texto` es lo unico que se recibe: si vino de un
 * dictado, la transcripcion ya se hizo en el navegador y el audio se descarto
 * ahi mismo. `origen: 'dictado'` queda registrado para que el medico sepa
 * cuales conviene releer.
 */
async function crearEvolucion(req, res) {
  const paciente = await pacienteAtendidoPor(req.params.id, req.medico.id);

  const texto = String(req.body.texto || '').trim();
  if (!texto) throw ApiError.badRequest('La evolucion no puede estar vacia');

  const origen = req.body.origen === 'dictado' ? 'dictado' : 'manual';

  // Si se asocia a un turno, tiene que ser de este medico y de este paciente.
  let turnoId = null;
  if (req.body.turnoId) {
    const turno = await Turno.findById(req.body.turnoId);
    if (!turno) throw ApiError.badRequest('El turno indicado no existe');
    if (turno.medico_id !== req.medico.id) throw ApiError.forbidden('El turno no pertenece a tu agenda');
    if (turno.paciente_id !== paciente.id) {
      throw ApiError.badRequest('El turno no corresponde a este paciente');
    }
    turnoId = turno.id;
  }

  const evolucion = await Historia.create({
    pacienteId: paciente.id,
    medicoId: req.medico.id,
    turnoId,
    texto,
    origen,
  });

  // Se devuelve la lista completa para que el frontend renderice la historia
  // actualizada sin una segunda llamada.
  const evoluciones = await Historia.listarPorPaciente(paciente.id, req.medico.id);

  return res.status(201).json({
    ok: true,
    mensaje: 'Evolucion guardada',
    evolucion,
    evoluciones,
  });
}

/** PUT /api/pacientes/:pacienteId/historia/:id  (medico) */
async function actualizarEvolucion(req, res) {
  const paciente = await pacienteAtendidoPor(req.params.pacienteId, req.medico.id);

  const texto = String(req.body.texto || '').trim();
  if (!texto) throw ApiError.badRequest('La evolucion no puede estar vacia');

  const evolucion = await Historia.update(req.params.id, req.medico.id, texto);
  if (!evolucion) throw ApiError.notFound('Evolucion no encontrada o no te pertenece');

  const evoluciones = await Historia.listarPorPaciente(paciente.id, req.medico.id);
  return res.json({ ok: true, mensaje: 'Evolucion actualizada', evolucion, evoluciones });
}

/** DELETE /api/pacientes/:pacienteId/historia/:id  (medico) */
async function eliminarEvolucion(req, res) {
  const paciente = await pacienteAtendidoPor(req.params.pacienteId, req.medico.id);

  const borrada = await Historia.remove(req.params.id, req.medico.id);
  if (!borrada) throw ApiError.notFound('Evolucion no encontrada o no te pertenece');

  const evoluciones = await Historia.listarPorPaciente(paciente.id, req.medico.id);
  return res.json({ ok: true, mensaje: 'Evolucion eliminada', evoluciones });
}

module.exports = {
  actualizarObraSocial,
  actualizarDatosPaciente,
  fichaPaciente,
  listarEvoluciones,
  crearEvolucion,
  actualizarEvolucion,
  eliminarEvolucion,
};
