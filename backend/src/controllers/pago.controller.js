/**
 * controllers/pago.controller.js
 * Cobro de turnos con MercadoPago (sena o total) + webhook de notificaciones.
 *
 * Flujo:
 *  1. El paciente elige tipo de pago -> POST /api/pagos/preferencia
 *  2. Se crea la fila en `pagos` (pendiente) y la preferencia en MercadoPago.
 *  3. El paciente paga en el checkout y MercadoPago notifica al webhook.
 *  4. El webhook consulta el pago real contra la API y actualiza `pagos`.
 *     Si se aprueba, el turno pasa a 'confirmado'.
 *
 * El external_reference tiene el formato "turno:<id>:<tipo>" para poder
 * reconciliar la notificacion con la fila correcta.
 */
const Pago = require('../models/pago.model');
const Turno = require('../models/turno.model');
const Paciente = require('../models/paciente.model');
const Medico = require('../models/medico.model');
const ApiError = require('../utils/ApiError');
const mp = require('../config/mercadopago');
const { descifrar } = require('../utils/cripto');
const { frontendUrl, mercadopago: mpCfg } = require('../config/env');

const webhookUrl = mpCfg.webhookUrl;

/**
 * Devuelve el access token de MercadoPago del profesional, descifrado.
 * Uso exclusivamente interno: su resultado jamas viaja al cliente.
 *
 * @returns {Promise<string|null>} null si no tiene credenciales cargadas o si
 *   el dato guardado no se puede descifrar (por ejemplo si cambio CRED_SECRET).
 */
async function obtenerAccessTokenDelMedico(medicoId) {
  const cifrado = await Medico.getAccessTokenMpCifrado(medicoId);
  if (!cifrado) return null;

  const plano = descifrar(cifrado);
  if (!plano) {
    // eslint-disable-next-line no-console
    console.error(`[pagos] No se pudo descifrar el token del medico ${medicoId}. Debe volver a conectarlo.`);
    return null;
  }
  return plano;
}

/**
 * POST /api/pagos/preferencia   (paciente)
 * Body: turnoId, tipo ('sena' | 'total')
 */
async function crearPreferencia(req, res) {
  const { turnoId, tipo } = req.body;
  if (!['sena', 'total'].includes(tipo)) {
    throw ApiError.badRequest('El tipo de pago debe ser "sena" o "total"');
  }

  const paciente = await Paciente.findByUserId(req.usuario.id);
  if (!paciente) throw ApiError.forbidden('Tu usuario no tiene perfil de paciente');

  const turno = await Turno.findById(turnoId);
  if (!turno) throw ApiError.notFound('Turno no encontrado');
  if (turno.paciente_id !== paciente.id) throw ApiError.forbidden('El turno no te pertenece');
  if (turno.estado === 'cancelado') throw ApiError.conflict('El turno esta cancelado');

  const medico = await Medico.findById(turno.medico_id);

  // El cobro usa las credenciales DEL PROFESIONAL. Sin ellas no hay pago
  // online: el turno ya quedo confirmado al reservarse y se abona en el
  // consultorio, asi que no hay nada que cobrar por aca.
  const accessTokenMedico = await obtenerAccessTokenDelMedico(medico.id);
  if (!accessTokenMedico) {
    throw ApiError.conflict(
      'Este profesional no acepta pagos online. Tu turno ya esta confirmado y se abona en el consultorio.'
    );
  }

  const total = Number(turno.monto_total) || Number(medico.precio_consulta);
  if (total <= 0) throw ApiError.unprocessable('El profesional no configuro el precio de la consulta');

  const yaPagado = await Pago.totalAprobadoDeTurno(turno.id);
  if (yaPagado >= total) throw ApiError.conflict('El turno ya esta pago en su totalidad');

  // La sena se calcula sobre el total y se descuenta lo ya acreditado.
  const monto = tipo === 'sena'
    ? Math.round((total * Number(medico.porcentaje_sena)) / 100)
    : Math.round(total - yaPagado);

  if (monto <= 0) throw ApiError.conflict('No hay saldo pendiente para este turno');

  const referencia = `turno:${turno.id}:${tipo}`;
  const preferencia = await mp.crearPreferencia({
    titulo: `Consulta ${medico.especialidad} - Dr/a. ${medico.apellido} (${turno.fecha} ${turno.hora_inicio.slice(0, 5)})`,
    monto,
    referencia,
    emailPagador: turno.paciente_email,
    accessToken: accessTokenMedico,
    // El turno viaja en la URL del webhook: al recibir la notificacion hay que
    // saber de que profesional es el cobro para consultarlo con SU token.
    urlWebhook: webhookUrl ? `${webhookUrl}?turno=${turno.id}` : undefined,
    urlsRetorno: {
      success: `${frontendUrl}/paciente/pago/resultado?estado=success&turno=${turno.id}`,
      failure: `${frontendUrl}/paciente/pago/resultado?estado=failure&turno=${turno.id}`,
      pending: `${frontendUrl}/paciente/pago/resultado?estado=pending&turno=${turno.id}`,
    },
  });

  const pago = await Pago.create({
    turnoId: turno.id,
    pacienteId: paciente.id,
    monto,
    tipo,
    mpPreferenceId: preferencia.id,
  });

  return res.status(201).json({
    ok: true,
    mensaje: 'Preferencia de pago creada',
    pago,
    checkout: {
      preferenceId: preferencia.id,
      initPoint: preferencia.initPoint,
      simulado: preferencia.simulado,
      publicKey: mp.habilitado ? undefined : null,
    },
  });
}

/**
 * POST /api/pagos/webhook   (publico, lo llama MercadoPago)
 *
 * Responde 200 siempre que pueda: si devolviera error, MercadoPago
 * reintentaria la notificacion indefinidamente.
 */
async function webhook(req, res) {
  try {
    const tipo = req.body.type || req.query.type;
    const paymentId = req.body?.data?.id || req.query['data.id'];

    if (tipo !== 'payment' || !paymentId) {
      return res.status(200).json({ ok: true, ignorado: true });
    }

    // El turno viene en la query de la notification_url. Sirve para resolver
    // el profesional y consultar el pago con SU access token, que es con el
    // que se creo la preferencia.
    const turnoDeLaUrl = Number(req.query.turno) || null;
    if (!turnoDeLaUrl) return res.status(200).json({ ok: true, ignorado: true });

    const turnoRef = await Turno.findById(turnoDeLaUrl);
    if (!turnoRef) return res.status(200).json({ ok: true, ignorado: true });

    const accessTokenMedico = await obtenerAccessTokenDelMedico(turnoRef.medico_id);
    if (!accessTokenMedico) return res.status(200).json({ ok: true, ignorado: true });

    const pagoMp = await mp.obtenerPago(paymentId, accessTokenMedico);
    if (!pagoMp || !pagoMp.referencia) {
      return res.status(200).json({ ok: true, ignorado: true });
    }

    const [tipoRef, id] = pagoMp.referencia.split(':');
    if (tipoRef !== 'turno') return res.status(200).json({ ok: true, ignorado: true });

    // El pago tiene que ser del turno que indica la URL: evita que una
    // notificacion apunte a un turno ajeno.
    if (Number(id) !== turnoDeLaUrl) return res.status(200).json({ ok: true, ignorado: true });

    // Se ubica la fila pendiente de ese turno por preference id o por monto.
    const pagos = await Pago.listarPorTurno(Number(id));
    const pago = pagos.find((p) => p.estado === 'pendiente') || pagos[0];
    if (!pago) return res.status(200).json({ ok: true, ignorado: true });

    const estado = mp.mapearEstado(pagoMp.status);
    await Pago.actualizarEstado(pago.id, {
      estado,
      mpPaymentId: pagoMp.id,
      statusDetail: pagoMp.statusDetail,
    });

    if (estado === 'aprobado') await Turno.cambiarEstado(Number(id), 'confirmado');

    return res.status(200).json({ ok: true });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[webhook mercadopago]', error.message);
    return res.status(200).json({ ok: false });
  }
}

/*
 * NOTA: no existe un endpoint de "pago simulado" para turnos.
 *
 * Antes habia uno, habilitado cuando la plataforma no tenia credenciales de
 * MercadoPago. Al pasar el cobro de turnos a las credenciales de cada medico
 * ese permiso dejo de tener sentido y se volvia peligroso: un paciente podria
 * marcar como aprobado un pago creado con el token real del profesional sin
 * haber pagado nada.
 *
 * Para probar sin dinero real, el medico carga sus credenciales de PRUEBA
 * (las que empiezan con TEST-) desde /medico/cobros: el checkout es el real
 * de sandbox y el flujo se recorre completo.
 */

/** GET /api/pagos/mis-pagos   (paciente) */
async function misPagos(req, res) {
  const paciente = await Paciente.findByUserId(req.usuario.id);
  if (!paciente) throw ApiError.forbidden('Tu usuario no tiene perfil de paciente');
  const pagos = await Pago.listarPorPaciente(paciente.id);
  return res.json({ ok: true, pagos });
}

/** GET /api/pagos/recibidos   (medico) */
async function pagosRecibidos(req, res) {
  const pagos = await Pago.listarPorMedico(req.medico.id, {
    desde: req.query.desde || null,
    hasta: req.query.hasta || null,
  });
  const totalAcreditado = pagos
    .filter((p) => p.estado === 'aprobado')
    .reduce((acc, p) => acc + Number(p.monto), 0);

  return res.json({ ok: true, pagos, totalAcreditado });
}

/** GET /api/pagos/turno/:turnoId */
async function pagosDeTurno(req, res) {
  const turno = await Turno.findById(req.params.turnoId);
  if (!turno) throw ApiError.notFound('Turno no encontrado');

  // Solo el paciente dueno, el medico de la agenda o el admin.
  if (req.usuario.rol === 'paciente') {
    const paciente = await Paciente.findByUserId(req.usuario.id);
    if (!paciente || paciente.id !== turno.paciente_id) throw ApiError.forbidden('Sin acceso');
  } else if (req.usuario.rol === 'medico') {
    const medico = await Medico.findByUserId(req.usuario.id);
    if (!medico || medico.id !== turno.medico_id) throw ApiError.forbidden('Sin acceso');
  }

  const pagos = await Pago.listarPorTurno(turno.id);
  const acreditado = await Pago.totalAprobadoDeTurno(turno.id);

  return res.json({
    ok: true,
    pagos,
    resumen: {
      total: Number(turno.monto_total),
      acreditado,
      saldo: Math.max(Number(turno.monto_total) - acreditado, 0),
    },
  });
}

module.exports = {
  crearPreferencia,
  webhook,
  misPagos,
  pagosRecibidos,
  pagosDeTurno,
};
