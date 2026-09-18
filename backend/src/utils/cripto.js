/**
 * utils/cripto.js
 * Cifrado simetrico reversible para secretos de terceros que el sistema
 * necesita volver a usar (hoy: el access token de MercadoPago de cada medico).
 *
 * No confundir con el hash de contrasenas: aquellas se guardan con bcrypt y
 * NUNCA se descifran. Estas credenciales si deben recuperarse para firmar las
 * llamadas a la API de MercadoPago en nombre del profesional.
 *
 * Algoritmo: AES-256-GCM (cifra y autentica: si el dato fue alterado, el
 * descifrado falla en lugar de devolver basura).
 * Formato guardado: "iv:authTag:contenido", todo en hexadecimal.
 */
const crypto = require('crypto');
const { credSecret } = require('../config/env');

const ALGORITMO = 'aes-256-gcm';
const LONGITUD_IV = 12; // 96 bits, el recomendado para GCM
const SAL = 'agendamed:credenciales:v1';

// La clave se deriva una sola vez al arrancar.
const clave = crypto.scryptSync(credSecret, SAL, 32);

/**
 * Cifra un texto plano.
 * @param {string} textoPlano
 * @returns {string} "iv:authTag:contenido" en hexadecimal
 */
function cifrar(textoPlano) {
  const iv = crypto.randomBytes(LONGITUD_IV);
  const cipher = crypto.createCipheriv(ALGORITMO, clave, iv);

  const contenido = Buffer.concat([cipher.update(String(textoPlano), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${contenido.toString('hex')}`;
}

/**
 * Descifra lo producido por cifrar().
 * @param {string} cifrado
 * @returns {string|null} el texto plano, o null si el dato esta corrupto,
 *   fue manipulado o se cifro con otra clave (por ejemplo si se cambio
 *   CRED_SECRET despues de guardar).
 */
function descifrar(cifrado) {
  try {
    const [ivHex, tagHex, contenidoHex] = String(cifrado).split(':');
    if (!ivHex || !tagHex || !contenidoHex) return null;

    const decipher = crypto.createDecipheriv(ALGORITMO, clave, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));

    return Buffer.concat([
      decipher.update(Buffer.from(contenidoHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Deja visibles solo los ultimos caracteres, para mostrar en pantalla que
 * credencial esta cargada sin revelarla.
 * @example enmascarar('APP_USR-1234-5678-abcdef') -> '****cdef'
 */
function enmascarar(secreto, visibles = 4) {
  const texto = String(secreto || '');
  if (texto.length <= visibles) return '*'.repeat(texto.length);
  return `${'*'.repeat(4)}${texto.slice(-visibles)}`;
}

module.exports = { cifrar, descifrar, enmascarar };
