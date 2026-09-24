/**
 * services/qrEnlace.js
 * Codigo QR del enlace de agendamiento, generado y guardado en la base.
 *
 * ==========================================================================
 * Por que se persiste si es derivable
 * ==========================================================================
 * El QR solo codifica la URL del enlace, asi que podria regenerarse cada vez.
 * Se guarda igual por dos motivos:
 *
 *   1. Garantiza que el QR impreso y el enlace apunten SIEMPRE al mismo
 *      lado. Junto al PNG se guarda `qr_url_codificada`, la URL que el codigo
 *      realmente contiene: comparandola con el enlace actual se detecta al
 *      instante si quedaron desalineados (por ejemplo si cambio el dominio) y
 *      se regenera solo en ese caso.
 *   2. El profesional puede haber impreso carteles. Tener registrado que
 *      codifica exactamente cada QR emitido es lo que permite responder
 *      "¿el cartel de la puerta sigue sirviendo?" sin adivinar.
 *
 * Cuesta ~8 KB por medico en un MEDIUMTEXT. Es barato para lo que evita.
 */
const QRCode = require('qrcode');

/**
 * Parametros del QR. Deben coincidir con los del componente del frontend
 * (components/TarjetaQR.jsx) para que ambos produzcan el mismo codigo.
 */
const OPCIONES_QR = {
  width: 720,
  margin: 2,
  // Correccion ALTA: el codigo sigue leyendose aunque el papel se manche, se
  // arrugue o quede parcialmente tapado, que es lo normal en un mostrador.
  errorCorrectionLevel: 'H',
  color: { dark: '#0f172a', light: '#ffffff' },
};

/**
 * Genera el QR de una URL como data URL PNG.
 *
 * @param {string} url
 * @returns {Promise<string>} "data:image/png;base64,..."
 */
function generarQR(url) {
  return QRCode.toDataURL(String(url), OPCIONES_QR);
}

/**
 * Decide si hay que (re)generar el QR guardado.
 *
 * @param {Object} medico  fila de v_medicos
 * @param {string} urlActual  el enlace vigente
 * @returns {{hayQueGenerar:boolean, motivo:string}}
 */
function evaluarQR(medico, urlActual) {
  if (!medico.qr_data_url) {
    return { hayQueGenerar: true, motivo: 'todavia no tenia QR' };
  }
  if (medico.qr_url_codificada !== urlActual) {
    return {
      hayQueGenerar: true,
      motivo: `el QR apuntaba a "${medico.qr_url_codificada}" y el enlace ahora es "${urlActual}"`,
    };
  }
  return { hayQueGenerar: false, motivo: 'el QR ya apunta al enlace vigente' };
}

module.exports = { generarQR, evaluarQR, OPCIONES_QR };
