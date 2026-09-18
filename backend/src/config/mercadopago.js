/**
 * config/mercadopago.js
 * Envoltorio del SDK oficial de MercadoPago (v2).
 *
 * Hay DOS orígenes de credenciales:
 *
 *  1. Las de cada MEDICO (su propia cuenta). Se usan para cobrar los turnos,
 *     porque ese dinero es del profesional. Llegan por parametro `accessToken`
 *     desde el controlador, que las lee descifradas de la tabla `medicos`.
 *     Un medico sin credenciales simplemente no cobra online.
 *
 *  2. La de la PLATAFORMA (MP_ACCESS_TOKEN del .env). Se usa solo para
 *     cobrarle la suscripcion mensual a los medicos. Si no esta configurada,
 *     ese cobro corre en "modo simulado" para poder desarrollar sin cuenta.
 */
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const { mercadopago: cfg } = require('./env');

/** Cliente de la plataforma (suscripciones). */
let clientePlataforma = null;
if (cfg.habilitado) {
  clientePlataforma = new MercadoPagoConfig({
    accessToken: cfg.accessToken,
    options: { timeout: 8000 },
  });
}

/** Crea un cliente para el access token de un profesional. */
function clienteDe(accessToken) {
  return new MercadoPagoConfig({ accessToken, options: { timeout: 8000 } });
}

/**
 * Verifica que un access token sea valido consultando la cuenta asociada.
 * Se llama antes de guardar las credenciales de un medico, para que no cargue
 * un token con un error de tipeo y se entere recien cuando un paciente
 * intente pagar.
 *
 * @param {string} accessToken
 * @returns {Promise<{valido:boolean, cuenta?:object, motivo?:string}>}
 */
async function verificarCredencial(accessToken) {
  try {
    const respuesta = await fetch('https://api.mercadopago.com/users/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8000),
    });

    if (respuesta.status === 401 || respuesta.status === 403) {
      return { valido: false, motivo: 'MercadoPago rechazo el access token. Revisa que lo hayas copiado completo.' };
    }
    if (!respuesta.ok) {
      return { valido: false, motivo: `MercadoPago respondio ${respuesta.status}. Reintenta en unos minutos.` };
    }

    const datos = await respuesta.json();
    return {
      valido: true,
      cuenta: {
        id: String(datos.id),
        nickname: datos.nickname,
        email: datos.email,
        // Los tokens de prueba empiezan con TEST-; sirve para avisar al medico
        // que todavia no esta cobrando dinero real.
        esPrueba: String(accessToken).startsWith('TEST-'),
      },
    };
  } catch (error) {
    return { valido: false, motivo: `No se pudo contactar a MercadoPago: ${error.message}` };
  }
}

/**
 * Crea una preferencia de pago (Checkout Pro).
 *
 * @param {Object} datos
 * @param {string} datos.titulo        Descripcion visible en el checkout
 * @param {number} datos.monto         Importe en ARS
 * @param {string} datos.referencia    external_reference (ej: "turno:12:sena")
 * @param {string} [datos.emailPagador]
 * @param {Object} datos.urlsRetorno   { success, failure, pending }
 * @param {string} [datos.accessToken] Token del medico. Si se omite, se usa el
 *   de la plataforma (caso suscripciones).
 * @param {string} [datos.urlWebhook]  notification_url especifica.
 * @returns {Promise<{id:string, initPoint:string, simulado:boolean}>}
 */
async function crearPreferencia({
  titulo, monto, referencia, emailPagador, urlsRetorno, accessToken = null, urlWebhook = null,
}) {
  const client = accessToken ? clienteDe(accessToken) : clientePlataforma;

  // Sin credenciales: preferencia falsa para poder recorrer el flujo en
  // desarrollo. Solo aplica a la plataforma; un medico sin token nunca
  // llega hasta aca (el controlador corta antes).
  if (!client) {
    return {
      id: `SIMULADO-${referencia}-${Date.now()}`,
      initPoint: `${urlsRetorno.success}?simulado=1&referencia=${encodeURIComponent(referencia)}`,
      simulado: true,
    };
  }

  const preference = new Preference(client);
  const respuesta = await preference.create({
    body: {
      items: [
        {
          id: referencia,
          title: titulo,
          quantity: 1,
          unit_price: Number(monto),
          currency_id: 'ARS',
        },
      ],
      payer: emailPagador ? { email: emailPagador } : undefined,
      external_reference: referencia,
      back_urls: {
        success: urlsRetorno.success,
        failure: urlsRetorno.failure,
        pending: urlsRetorno.pending,
      },
      auto_return: 'approved',
      notification_url: urlWebhook || cfg.webhookUrl || undefined,
      binary_mode: false,
    },
  });

  return {
    id: respuesta.id,
    initPoint: respuesta.init_point,
    simulado: false,
  };
}

/**
 * Consulta un pago por su id. El webhook la usa para confirmar el estado real
 * contra MercadoPago en vez de confiar en el payload entrante.
 *
 * @param {string} paymentId
 * @param {string} [accessToken] Token del medico duenio del cobro.
 * @returns {Promise<{id,status,statusDetail,referencia,monto}|null>}
 */
async function obtenerPago(paymentId, accessToken = null) {
  const client = accessToken ? clienteDe(accessToken) : clientePlataforma;
  if (!client) return null;

  const payment = new Payment(client);
  const p = await payment.get({ id: paymentId });

  return {
    id: String(p.id),
    status: p.status,                       // approved | rejected | pending | refunded ...
    statusDetail: p.status_detail,
    referencia: p.external_reference,
    monto: p.transaction_amount,
  };
}

/** Traduce el status de MercadoPago al ENUM de la tabla `pagos`. */
function mapearEstado(statusMp) {
  switch (statusMp) {
    case 'approved':
      return 'aprobado';
    case 'rejected':
    case 'cancelled':
      return 'rechazado';
    case 'refunded':
    case 'charged_back':
      return 'reembolsado';
    default:
      return 'pendiente';
  }
}

module.exports = {
  crearPreferencia,
  obtenerPago,
  mapearEstado,
  verificarCredencial,
  /** Indica si la PLATAFORMA tiene credenciales (afecta solo suscripciones). */
  habilitado: cfg.habilitado,
};
