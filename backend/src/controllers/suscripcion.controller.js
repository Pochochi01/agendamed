/**
 * controllers/suscripcion.controller.js
 * Control del canon mensual que cada medico (tenant) paga a la plataforma.
 *
 * - El admin lista, genera periodos, marca pagos manuales y suspende morosos.
 * - El medico ve su historial y genera el link de pago de su periodo.
 */
const Suscripcion = require('../models/suscripcion.model');
const Medico = require('../models/medico.model');
const User = require('../models/user.model');
const ApiError = require('../utils/ApiError');
const mp = require('../config/mercadopago');
const { negocio, frontendUrl } = require('../config/env');

/** GET /api/suscripciones  (admin) */
async function listar(req, res) {
  await Suscripcion.marcarVencidas();

  const suscripciones = await Suscripcion.listar({
    estado: req.query.estado || null,
    anio: req.query.anio || null,
    mes: req.query.mes || null,
  });

  return res.json({ ok: true, suscripciones });
}

/**
 * POST /api/suscripciones/generar-periodo  (admin)
 * Body: { anio?, mes?, monto? }  (por defecto el mes en curso)
 * Crea el periodo para todos los medicos que aun no lo tengan.
 */
async function generarPeriodo(req, res) {
  const hoy = new Date();
  const anio = Number(req.body.anio || hoy.getFullYear());
  const mes = Number(req.body.mes || hoy.getMonth() + 1);
  const monto = Number(req.body.monto || negocio.suscripcionMonto);

  if (mes < 1 || mes > 12) throw ApiError.badRequest('El mes debe estar entre 1 y 12');

  const medicos = await Medico.listar();
  let creadas = 0;

  for (const medico of medicos) {
    // eslint-disable-next-line no-await-in-loop
    const existente = await Suscripcion.findPeriodo(medico.id, anio, mes);
    if (!existente) {
      // eslint-disable-next-line no-await-in-loop
      await Suscripcion.crearSiNoExiste({ medicoId: medico.id, anio, mes, monto });
      creadas += 1;
    }
  }

  return res.status(201).json({
    ok: true,
    mensaje: `Periodo ${mes}/${anio} generado`,
    creadas,
    yaExistentes: medicos.length - creadas,
  });
}

/**
 * PATCH /api/suscripciones/:id/estado  (admin)
 * Permite registrar un pago fuera de MercadoPago (transferencia, efectivo) o
 * volver a marcar pendiente. Al marcar 'pagada' se rehabilita al medico.
 */
async function cambiarEstado(req, res) {
  const { estado } = req.body;
  if (!['pendiente', 'pagada', 'vencida'].includes(estado)) {
    throw ApiError.badRequest('Estado invalido. Usa: pendiente, pagada o vencida');
  }

  const suscripcion = await Suscripcion.findById(req.params.id);
  if (!suscripcion) throw ApiError.notFound('Suscripcion no encontrada');

  const actualizada = estado === 'pagada'
    ? await Suscripcion.marcarPagada(suscripcion.id)
    : await Suscripcion.cambiarEstado(suscripcion.id, estado);

  // Pagar la suscripcion rehabilita automaticamente al tenant.
  if (estado === 'pagada') {
    const medico = await Medico.findById(suscripcion.medico_id);
    if (medico && medico.estado === 'suspendido') {
      await Medico.setEstado(medico.id, 'activo');
      await User.setActivo(medico.user_id, true);
    }
  }

  return res.json({ ok: true, mensaje: 'Suscripcion actualizada', suscripcion: actualizada });
}

/**
 * POST /api/suscripciones/suspender-morosos  (admin)
 * Suspende a todo medico con al menos un periodo vencido impago.
 */
async function suspenderMorosos(_req, res) {
  await Suscripcion.marcarVencidas();
  const vencidas = await Suscripcion.listar({ estado: 'vencida' });

  const medicosUnicos = [...new Set(vencidas.map((s) => s.medico_id))];
  let suspendidos = 0;

  for (const medicoId of medicosUnicos) {
    // eslint-disable-next-line no-await-in-loop
    const medico = await Medico.findById(medicoId);
    if (medico && medico.estado === 'activo') {
      // eslint-disable-next-line no-await-in-loop
      await Medico.setEstado(medicoId, 'suspendido');
      // eslint-disable-next-line no-await-in-loop
      await User.setActivo(medico.user_id, false);
      suspendidos += 1;
    }
  }

  return res.json({ ok: true, mensaje: `${suspendidos} medico(s) suspendido(s) por mora`, suspendidos });
}

/** GET /api/suscripciones/mis-suscripciones  (medico) */
async function misSuscripciones(req, res) {
  await Suscripcion.marcarVencidas();
  const suscripciones = await Suscripcion.listarPorMedico(req.medico.id);
  const pendiente = suscripciones.find((s) => s.estado !== 'pagada') || null;
  return res.json({ ok: true, suscripciones, pendiente, montoMensual: negocio.suscripcionMonto });
}

/**
 * POST /api/suscripciones/:id/pagar  (medico)
 * Genera la preferencia de MercadoPago del canon mensual.
 */
async function pagar(req, res) {
  const suscripcion = await Suscripcion.findById(req.params.id);
  if (!suscripcion) throw ApiError.notFound('Suscripcion no encontrada');
  if (suscripcion.medico_id !== req.medico.id) throw ApiError.forbidden('La suscripcion no te pertenece');
  if (suscripcion.estado === 'pagada') throw ApiError.conflict('El periodo ya esta pago');

  const referencia = `suscripcion:${suscripcion.id}`;
  const preferencia = await mp.crearPreferencia({
    titulo: `AgendaMed - Suscripcion ${suscripcion.mes}/${suscripcion.anio}`,
    monto: Number(suscripcion.monto),
    referencia,
    emailPagador: suscripcion.medico_email,
    urlsRetorno: {
      success: `${frontendUrl}/medico/suscripcion?estado=success`,
      failure: `${frontendUrl}/medico/suscripcion?estado=failure`,
      pending: `${frontendUrl}/medico/suscripcion?estado=pending`,
    },
  });

  const actualizada = await Suscripcion.setPreferenceId(suscripcion.id, preferencia.id);

  return res.json({
    ok: true,
    suscripcion: actualizada,
    checkout: {
      preferenceId: preferencia.id,
      initPoint: preferencia.initPoint,
      simulado: preferencia.simulado,
    },
  });
}

/**
 * POST /api/suscripciones/:id/confirmar-simulado  (medico, solo sin credenciales)
 * Equivalente al de pagos: cierra el flujo en desarrollo.
 */
async function confirmarSimulado(req, res) {
  if (mp.habilitado) throw ApiError.forbidden('MercadoPago esta configurado: usa el checkout real');

  const suscripcion = await Suscripcion.findById(req.params.id);
  if (!suscripcion) throw ApiError.notFound('Suscripcion no encontrada');
  if (suscripcion.medico_id !== req.medico.id) throw ApiError.forbidden('La suscripcion no te pertenece');

  const actualizada = await Suscripcion.marcarPagada(suscripcion.id, `SIM-SUS-${suscripcion.id}`);

  const medico = await Medico.findById(suscripcion.medico_id);
  if (medico && medico.estado === 'suspendido') {
    await Medico.setEstado(medico.id, 'activo');
    await User.setActivo(medico.user_id, true);
  }

  return res.json({ ok: true, mensaje: 'Suscripcion acreditada (simulado)', suscripcion: actualizada });
}

/**
 * Webhook de suscripciones. Comparte el handler generico con pagos de turnos
 * pero se expone aparte para que MercadoPago pueda apuntar a una URL propia.
 */
async function webhook(req, res) {
  try {
    const tipo = req.body.type || req.query.type;
    const paymentId = req.body?.data?.id || req.query['data.id'];
    if (tipo !== 'payment' || !paymentId) return res.status(200).json({ ok: true, ignorado: true });

    const pagoMp = await mp.obtenerPago(paymentId);
    if (!pagoMp || !pagoMp.referencia) return res.status(200).json({ ok: true, ignorado: true });

    const [tipoRef, id] = pagoMp.referencia.split(':');
    if (tipoRef !== 'suscripcion') return res.status(200).json({ ok: true, ignorado: true });

    if (mp.mapearEstado(pagoMp.status) === 'aprobado') {
      await Suscripcion.marcarPagada(Number(id), pagoMp.id);
      const suscripcion = await Suscripcion.findById(Number(id));
      const medico = await Medico.findById(suscripcion.medico_id);
      if (medico && medico.estado === 'suspendido') {
        await Medico.setEstado(medico.id, 'activo');
        await User.setActivo(medico.user_id, true);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[webhook suscripciones]', error.message);
    return res.status(200).json({ ok: false });
  }
}

module.exports = {
  listar,
  generarPeriodo,
  cambiarEstado,
  suspenderMorosos,
  misSuscripciones,
  pagar,
  confirmarSimulado,
  webhook,
};
