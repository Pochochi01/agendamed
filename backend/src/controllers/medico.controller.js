/**
 * controllers/medico.controller.js
 * - Vista publica: listado de medicos activos y su disponibilidad.
 * - Vista admin:   listado completo con estado de suscripcion y habilitacion.
 * - Vista tenant:  configuracion y metricas del propio medico.
 */
const bcrypt = require('bcryptjs');
const { transaction } = require('../config/db');
const Medico = require('../models/medico.model');
const User = require('../models/user.model');
const Suscripcion = require('../models/suscripcion.model');
const Catalogo = require('../models/catalogo.model');
const ApiError = require('../utils/ApiError');
const { negocio } = require('../config/env');
const mp = require('../config/mercadopago');
const { cifrar, descifrar } = require('../utils/cripto');
const { slotsDelRango, slotsDelDia } = require('../utils/disponibilidad');
const { hoyIso } = require('../utils/tiempo');

/** Mismo coste que usa auth.controller para las contrasenas. */
const COSTO_BCRYPT = 12;

/**
 * GET /api/medicos  (publico)
 * Solo medicos activos: un tenant suspendido desaparece de la busqueda.
 */
async function listarPublico(req, res) {
  const medicos = await Medico.listar({
    soloActivos: true,
    especialidadId: req.query.especialidadId || null,
    busqueda: req.query.q || '',
  });

  // La vista publica no expone datos de contacto directo del profesional.
  // `mercadopago_configurado` si viaja: el paciente necesita saber de antemano
  // si ese profesional cobra online o confirma el turno sin pago.
  const publicos = medicos.map(({ email, telefono, user_id: _u, ...resto }) => ({
    ...resto,
    mercadopago_configurado: Boolean(resto.mercadopago_configurado),
  }));
  return res.json({ ok: true, medicos: publicos });
}

/** GET /api/medicos/:id  (publico) */
async function detallePublico(req, res) {
  const medico = await Medico.findById(req.params.id);
  if (!medico || medico.estado !== 'activo' || !medico.usuario_activo) {
    throw ApiError.notFound('El profesional no esta disponible');
  }

  const { email, telefono, user_id: _u, ...publico } = medico;
  return res.json({ ok: true, medico: publico });
}

/**
 * GET /api/medicos/:id/disponibilidad?desde=YYYY-MM-DD&dias=14  (publico)
 * Devuelve el calendario de slots libres que consume el paciente.
 */
async function disponibilidad(req, res) {
  const medico = await Medico.findById(req.params.id);
  if (!medico || medico.estado !== 'activo' || !medico.usuario_activo) {
    throw ApiError.notFound('El profesional no esta disponible');
  }

  const desde = req.query.desde || hoyIso();
  const dias = Number(req.query.dias || 14);

  const calendario = await slotsDelRango(medico, desde, dias);

  return res.json({
    ok: true,
    medico: {
      id: medico.id,
      nombre: medico.nombre,
      apellido: medico.apellido,
      especialidad: medico.especialidad,
      duracionTurnoMin: medico.duracion_turno_min,
      precioConsulta: medico.precio_consulta,
      porcentajeSena: medico.porcentaje_sena,
      // Define si el paso final del flujo pide pagar o solo confirmar.
      mercadopagoConfigurado: Boolean(medico.mercadopago_configurado),
    },
    calendario,
  });
}

/** GET /api/medicos/:id/disponibilidad/:fecha  (publico) */
async function disponibilidadDelDia(req, res) {
  const medico = await Medico.findById(req.params.id);
  if (!medico || medico.estado !== 'activo') throw ApiError.notFound('El profesional no esta disponible');

  const slots = await slotsDelDia(medico, req.params.fecha);
  return res.json({ ok: true, fecha: req.params.fecha, slots });
}

/**
 * GET /api/medicos/admin/todos  (admin)
 * Listado completo con el ultimo periodo de suscripcion pegado a cada fila.
 */
async function listarParaAdmin(req, res) {
  const medicos = await Medico.listar({
    especialidadId: req.query.especialidadId || null,
    busqueda: req.query.q || '',
  });

  const resumen = await Suscripcion.resumenPorMedico();
  const porMedico = new Map(resumen.map((s) => [s.medico_id, s]));

  const filas = medicos.map((m) => ({
    ...m,
    suscripcion: porMedico.get(m.id) || null,
  }));

  const estadisticas = await Medico.estadisticasGlobales();
  return res.json({ ok: true, medicos: filas, estadisticas });
}

/**
 * PATCH /api/medicos/:id/estado  (admin)
 * Habilita o suspende al tenant. Suspender no borra nada: el medico deja de
 * aparecer en la busqueda publica y no puede operar su agenda.
 */
async function cambiarEstado(req, res) {
  const { estado } = req.body;
  if (!['activo', 'suspendido'].includes(estado)) {
    throw ApiError.badRequest('El estado debe ser "activo" o "suspendido"');
  }

  const medico = await Medico.findById(req.params.id);
  if (!medico) throw ApiError.notFound('Medico no encontrado');

  const actualizado = await Medico.setEstado(req.params.id, estado);
  // El flag de `users` acompana al estado del tenant: suspendido no loguea.
  await User.setActivo(medico.user_id, estado === 'activo');

  return res.json({
    ok: true,
    mensaje: estado === 'activo' ? 'Medico habilitado' : 'Medico suspendido',
    medico: actualizado,
  });
}

/* ===================================================================== *
 *                      CRUD de medicos (administrador)
 * ===================================================================== */

/**
 * POST /api/medicos  (admin)
 * Alta de un profesional desde el panel de administracion.
 * Crea el usuario y el perfil medico en una sola transaccion, y le abre el
 * periodo de suscripcion del mes en curso.
 */
async function crear(req, res) {
  const { nombre, apellido, email, telefono = null, password, especialidadId, matricula } = req.body;

  if (await User.findByEmail(email)) {
    throw ApiError.conflict('Ya existe un usuario registrado con ese email');
  }

  const especialidad = await Catalogo.findEspecialidad(especialidadId);
  if (!especialidad) throw ApiError.badRequest('La especialidad indicada no existe');

  const passwordHash = await bcrypt.hash(password, COSTO_BCRYPT);

  const userId = await transaction(async (cx) => {
    const nuevoUserId = await User.create(
      { nombre, apellido, email, telefono, passwordHash, rol: 'medico' },
      cx
    );
    await Medico.create(
      {
        userId: nuevoUserId,
        especialidadId,
        matricula,
        duracionTurnoMin: req.body.duracionTurnoMin || 30,
        precioConsulta: req.body.precioConsulta || 0,
        porcentajeSena: req.body.porcentajeSena ?? 30,
      },
      cx
    );
    return nuevoUserId;
  });

  const medico = await Medico.findByUserId(userId);

  const hoy = new Date();
  await Suscripcion.crearSiNoExiste({
    medicoId: medico.id,
    anio: hoy.getFullYear(),
    mes: hoy.getMonth() + 1,
    monto: negocio.suscripcionMonto,
  });

  return res.status(201).json({ ok: true, mensaje: 'Medico creado', medico });
}

/**
 * PUT /api/medicos/:id  (admin)
 * Edita datos personales y profesionales. `password` es opcional: si viene, se
 * resetea la contrasena del profesional.
 */
async function actualizar(req, res) {
  const medico = await Medico.findById(req.params.id);
  if (!medico) throw ApiError.notFound('Medico no encontrado');

  const { nombre, apellido, email, telefono = null, especialidadId, matricula } = req.body;

  // El email es la credencial de acceso: no puede pisar la de otra cuenta.
  const conEseEmail = await User.findByEmail(email);
  if (conEseEmail && conEseEmail.id !== medico.user_id) {
    throw ApiError.conflict('Ese email ya pertenece a otro usuario');
  }

  const especialidad = await Catalogo.findEspecialidad(especialidadId);
  if (!especialidad) throw ApiError.badRequest('La especialidad indicada no existe');

  await User.updateDatosAdmin(medico.user_id, { nombre, apellido, email, telefono });

  await Medico.updateConfiguracion(medico.id, {
    especialidadId,
    matricula,
    duracionTurnoMin: req.body.duracionTurnoMin ?? medico.duracion_turno_min,
    precioConsulta: req.body.precioConsulta ?? medico.precio_consulta,
    porcentajeSena: req.body.porcentajeSena ?? medico.porcentaje_sena,
  });

  let passwordReseteada = false;
  if (req.body.password) {
    await User.updatePassword(medico.user_id, await bcrypt.hash(req.body.password, COSTO_BCRYPT));
    passwordReseteada = true;
  }

  return res.json({
    ok: true,
    mensaje: passwordReseteada ? 'Medico actualizado y contrasena reseteada' : 'Medico actualizado',
    medico: await Medico.findById(medico.id),
  });
}

/**
 * GET /api/medicos/:id/impacto-eliminacion  (admin)
 * Detalle de lo que se perderia al eliminar definitivamente al profesional.
 * El panel lo consulta antes de mostrar la confirmacion.
 */
async function impactoEliminacion(req, res) {
  const medico = await Medico.findById(req.params.id);
  if (!medico) throw ApiError.notFound('Medico no encontrado');

  const impacto = await Medico.impactoEliminacion(medico.id);

  return res.json({
    ok: true,
    medico: {
      id: medico.id,
      nombre: medico.nombre,
      apellido: medico.apellido,
      email: medico.email,
      especialidad: medico.especialidad,
    },
    impacto,
    // La UI exige escribir este texto para habilitar el borrado.
    confirmacionRequerida: medico.email,
  });
}

/**
 * DELETE /api/medicos/:id  (admin)
 * Body: { confirmacion: "<email del medico>" }
 *
 * ELIMINACION DEFINITIVA e irreversible: borra el profesional, su usuario,
 * consultorios, horarios, turnos, pagos y suscripciones.
 *
 * Se exige que el body repita el email del medico. No es burocracia: un
 * DELETE con el id equivocado destruye el historial de otro profesional sin
 * vuelta atras, y este paso obliga a confirmar sobre cual se esta actuando.
 * Para dar de baja sin perder datos existe PATCH /:id/estado (suspender).
 */
async function eliminar(req, res) {
  const medico = await Medico.findById(req.params.id);
  if (!medico) throw ApiError.notFound('Medico no encontrado');

  const confirmacion = String(req.body.confirmacion || '').trim().toLowerCase();
  if (confirmacion !== String(medico.email).toLowerCase()) {
    throw ApiError.badRequest(
      'Para eliminar definitivamente hay que repetir el email del profesional en el campo "confirmacion".'
    );
  }

  const resultado = await Medico.eliminarDefinitivo(medico.id);
  if (!resultado) throw ApiError.notFound('Medico no encontrado');

  // eslint-disable-next-line no-console
  console.warn(
    `[admin] Eliminacion definitiva del medico ${medico.id} (${medico.email}) ` +
    `por el usuario ${req.usuario.id}. Borrados: ${JSON.stringify(resultado.borradas)}`
  );

  return res.json({
    ok: true,
    mensaje: `Se elimino definitivamente a Dr/a. ${medico.apellido}, ${medico.nombre}`,
    eliminado: {
      id: medico.id,
      nombre: medico.nombre,
      apellido: medico.apellido,
      email: medico.email,
    },
    borradas: resultado.borradas,
  });
}

/** GET /api/medicos/mi/perfil  (medico) */
async function miPerfil(req, res) {
  const estadisticas = await Medico.estadisticas(req.medico.id);
  const suscripciones = await Suscripcion.listarPorMedico(req.medico.id);
  return res.json({ ok: true, medico: req.medico, estadisticas, suscripciones });
}

/** PUT /api/medicos/mi/perfil  (medico) */
async function actualizarMiPerfil(req, res) {
  const { especialidadId, matricula, duracionTurnoMin, precioConsulta, porcentajeSena } = req.body;

  const esp = await Catalogo.findEspecialidad(especialidadId);
  if (!esp) throw ApiError.badRequest('La especialidad indicada no existe');

  const medico = await Medico.updateConfiguracion(req.medico.id, {
    especialidadId,
    matricula,
    duracionTurnoMin,
    precioConsulta,
    porcentajeSena,
  });

  return res.json({ ok: true, mensaje: 'Configuracion actualizada', medico });
}

/**
 * PATCH /api/medicos/mi/duracion-turno  (medico)
 * Body: { horas, minutos }
 *
 * El profesional carga la duracion en horas y minutos por separado; aca se
 * consolidan en los minutos totales que guarda la tabla y que despues usa el
 * generador de slots (utils/disponibilidad.js).
 *
 * Cambiar este valor NO altera los turnos ya reservados: solo afecta a la
 * disponibilidad que se calcula de ahora en mas.
 */
async function actualizarDuracionTurno(req, res) {
  const horas = Number(req.body.horas);
  const minutos = Number(req.body.minutos);
  const total = horas * 60 + minutos;

  // El limite coincide con el CHECK ck_medicos_slot del esquema (5 a 240).
  if (total < 5) {
    throw ApiError.badRequest('La duracion del turno no puede ser menor a 5 minutos');
  }
  if (total > 240) {
    throw ApiError.badRequest('La duracion del turno no puede superar las 4 horas');
  }

  const medico = await Medico.updateDuracionTurno(req.medico.id, total);

  return res.json({
    ok: true,
    mensaje: `Duracion del turno actualizada a ${formatearDuracion(total)}`,
    duracionTurnoMin: total,
    medico,
  });
}

/** 90 -> "1 h 30 min"  |  20 -> "20 min"  |  120 -> "2 h" */
function formatearDuracion(minutosTotales) {
  const h = Math.floor(minutosTotales / 60);
  const m = minutosTotales % 60;
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  return `${m} min`;
}

/**
 * PUT /api/medicos/mi/mercadopago  (medico)
 * Body: { accessToken, publicKey? }
 *
 * Conecta la cuenta de MercadoPago DEL PROFESIONAL: el dinero de las consultas
 * va a su cuenta, no a la de la plataforma. El token se verifica contra la API
 * antes de guardarlo (para no descubrir un error de tipeo recien cuando un
 * paciente intenta pagar) y se almacena cifrado.
 *
 * Mientras no haya credenciales, el medico no ofrece pago online: sus turnos
 * se confirman directamente al reservarse.
 */
async function configurarMercadoPago(req, res) {
  const accessToken = String(req.body.accessToken || '').trim();
  const publicKey = String(req.body.publicKey || '').trim() || null;

  const verificacion = await mp.verificarCredencial(accessToken);
  if (!verificacion.valido) throw ApiError.badRequest(verificacion.motivo);

  await Medico.guardarCredencialesMp(req.medico.id, {
    accessTokenCifrado: cifrar(accessToken),
    publicKey,
  });

  const medico = await Medico.findById(req.medico.id);

  return res.json({
    ok: true,
    mensaje: verificacion.cuenta.esPrueba
      ? 'Cuenta de PRUEBA conectada. Los pagos no seran reales hasta que cargues las credenciales de produccion.'
      : 'Cuenta de MercadoPago conectada. Ya podes cobrar tus turnos online.',
    cuenta: verificacion.cuenta,   // sin el token: solo nickname / email / si es de prueba
    medico,
  });
}

/**
 * DELETE /api/medicos/mi/mercadopago  (medico)
 * Desconecta la cuenta. Los turnos futuros pasan a confirmarse sin pago.
 */
async function desconectarMercadoPago(req, res) {
  const medico = await Medico.borrarCredencialesMp(req.medico.id);
  return res.json({
    ok: true,
    mensaje: 'Cuenta desconectada. Tus turnos se confirmaran sin pago online.',
    medico,
  });
}

/**
 * GET /api/medicos/mi/mercadopago  (medico)
 * Estado de la conexion. Nunca devuelve el access token.
 */
async function estadoMercadoPago(req, res) {
  const configurado = Boolean(req.medico.mercadopago_configurado);
  return res.json({
    ok: true,
    configurado,
    publicKey: req.medico.mp_public_key || null,
    // Se informa si el token guardado es de prueba, sin exponerlo.
    esPrueba: configurado ? await tokenEsDePrueba(req.medico.id) : null,
  });
}

/** Lee el token cifrado solo para saber si es de sandbox. No lo devuelve. */
async function tokenEsDePrueba(medicoId) {
  const cifrado = await Medico.getAccessTokenMpCifrado(medicoId);
  const plano = cifrado ? descifrar(cifrado) : null;
  return plano ? plano.startsWith('TEST-') : null;
}

/** GET /api/medicos/mi/estadisticas  (medico) */
async function misEstadisticas(req, res) {
  const estadisticas = await Medico.estadisticas(req.medico.id);
  return res.json({ ok: true, estadisticas });
}

module.exports = {
  listarPublico,
  detallePublico,
  disponibilidad,
  disponibilidadDelDia,
  listarParaAdmin,
  cambiarEstado,
  crear,
  actualizar,
  impactoEliminacion,
  eliminar,
  miPerfil,
  actualizarMiPerfil,
  actualizarDuracionTurno,
  configurarMercadoPago,
  desconectarMercadoPago,
  estadoMercadoPago,
  misEstadisticas,
};
