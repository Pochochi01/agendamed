/**
 * utils/hash.js
 * Identificadores publicos no enumerables.
 *
 * Los enlaces que se comparten por WhatsApp no deben llevar el id
 * autoincremental del medico: cualquiera probaria /reservar/1, /reservar/2 y
 * recorreria toda la cartilla. Se usa un token aleatorio de 128 bits en
 * base64url, que es opaco y se puede regenerar para invalidar el enlace viejo.
 */
const crypto = require('crypto');

/** Longitud del hash: 16 bytes -> 22 caracteres base64url (sin padding). */
const BYTES = 16;

/** @returns {string} token url-safe de 22 caracteres */
function generarHashPublico() {
  return crypto.randomBytes(BYTES).toString('base64url').slice(0, 22);
}

/**
 * Valida la forma del hash antes de tocar la base: evita consultas con
 * basura y da un 404 limpio.
 */
function esHashPublicoValido(valor) {
  return typeof valor === 'string' && /^[A-Za-z0-9_-]{22}$/.test(valor);
}

module.exports = { generarHashPublico, esHashPublicoValido };
