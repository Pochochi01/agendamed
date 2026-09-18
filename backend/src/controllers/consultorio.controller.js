/**
 * controllers/consultorio.controller.js
 * CRUD de consultorios del medico autenticado.
 *
 * Todas las consultas van filtradas por req.medico.id, que viene del token y
 * nunca del body: asi un tenant no puede leer ni modificar consultorios ajenos.
 */
const Consultorio = require('../models/consultorio.model');
const Catalogo = require('../models/catalogo.model');
const ApiError = require('../utils/ApiError');

/** GET /api/consultorios */
async function listar(req, res) {
  const consultorios = await Consultorio.listarPorMedico(req.medico.id, {
    soloActivos: req.query.activos === 'true',
  });
  return res.json({ ok: true, consultorios });
}

/** GET /api/consultorios/:id */
async function detalle(req, res) {
  const consultorio = await Consultorio.findByIdDelMedico(req.params.id, req.medico.id);
  if (!consultorio) throw ApiError.notFound('Consultorio no encontrado');
  return res.json({ ok: true, consultorio });
}

/**
 * POST /api/consultorios
 * Acepta `localidadId` o el par `localidad` + `provincia` (alta al vuelo en
 * el catalogo, manteniendo la 3FN).
 */
async function crear(req, res) {
  const localidadId = await resolverLocalidad(req.body);

  const consultorio = await Consultorio.create(req.medico.id, {
    nombre: req.body.nombre,
    calle: req.body.calle,
    numero: req.body.numero,
    pisoDepto: req.body.pisoDepto || null,
    localidadId,
    telefono: req.body.telefono || null,
  });

  return res.status(201).json({ ok: true, mensaje: 'Consultorio creado', consultorio });
}

/** PUT /api/consultorios/:id */
async function actualizar(req, res) {
  const existente = await Consultorio.findByIdDelMedico(req.params.id, req.medico.id);
  if (!existente) throw ApiError.notFound('Consultorio no encontrado');

  const localidadId = await resolverLocalidad(req.body);

  const consultorio = await Consultorio.update(req.params.id, req.medico.id, {
    nombre: req.body.nombre,
    calle: req.body.calle,
    numero: req.body.numero,
    pisoDepto: req.body.pisoDepto || null,
    localidadId,
    telefono: req.body.telefono || null,
    activo: req.body.activo ?? existente.activo,
  });

  return res.json({ ok: true, mensaje: 'Consultorio actualizado', consultorio });
}

/**
 * DELETE /api/consultorios/:id
 * Si el consultorio tiene turnos futuros vigentes no se borra: se pide
 * cancelarlos primero. Si solo tiene historial, se hace baja logica para no
 * romper la trazabilidad de los turnos pasados.
 */
async function eliminar(req, res) {
  const existente = await Consultorio.findByIdDelMedico(req.params.id, req.medico.id);
  if (!existente) throw ApiError.notFound('Consultorio no encontrado');

  const turnosFuturos = await Consultorio.contarTurnosFuturos(existente.id);
  if (turnosFuturos > 0) {
    throw ApiError.conflict(
      `No se puede eliminar: hay ${turnosFuturos} turno(s) futuro(s) en este consultorio. Cancelalos primero.`
    );
  }

  try {
    const borrado = await Consultorio.remove(existente.id, req.medico.id);
    if (borrado) return res.json({ ok: true, mensaje: 'Consultorio eliminado' });
  } catch (error) {
    // Hay turnos historicos (FK RESTRICT) -> baja logica.
    if (error.code !== 'ER_ROW_IS_REFERENCED_2') throw error;
  }

  const consultorio = await Consultorio.desactivar(existente.id, req.medico.id);
  return res.json({
    ok: true,
    mensaje: 'El consultorio tiene turnos historicos: se desactivo en lugar de eliminarse',
    consultorio,
  });
}

/** Resuelve el id de localidad desde el body, creandola si hace falta. */
async function resolverLocalidad({ localidadId, localidad, provincia }) {
  if (localidadId) {
    const encontrada = await Catalogo.findLocalidad(localidadId);
    if (!encontrada) throw ApiError.badRequest('La localidad indicada no existe');
    return encontrada.id;
  }
  if (localidad && provincia) {
    return (await Catalogo.crearLocalidadSiNoExiste(localidad.trim(), provincia.trim())).id;
  }
  throw ApiError.badRequest('Indica una localidad (localidadId, o localidad + provincia)');
}

module.exports = { listar, detalle, crear, actualizar, eliminar };
