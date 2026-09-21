/**
 * utils/urlPublica.js
 * Resuelve la URL publica del sitio para armar enlaces que se comparten.
 *
 * ==========================================================================
 * El problema que resuelve
 * ==========================================================================
 * El enlace de agendamiento se construia con `FRONTEND_URL` del .env. Si esa
 * variable quedaba en `http://localhost:5173` —el valor de desarrollo—, el
 * medico copiaba un enlace que solo funciona en la maquina del programador y
 * el paciente recibia algo inservible.
 *
 * Es un error silencioso: la aplicacion anda bien, el enlace se ve bien, y
 * recien falla cuando alguien intenta abrirlo desde afuera.
 *
 * ==========================================================================
 * Como se resuelve, en orden de prioridad
 * ==========================================================================
 *   1. PUBLIC_URL del .env          -> control explicito, gana siempre
 *   2. Las cabeceras de la request  -> detras de Nginx llega el dominio real
 *   3. FRONTEND_URL del .env        -> ultimo recurso
 *
 * El paso 2 es el que hace que funcione en produccion sin configurar nada: el
 * proxy manda `X-Forwarded-Proto` y `X-Forwarded-Host` (ver DEPLOY.md) y de
 * ahi sale `https://tudominio.com`.
 *
 * Nota de seguridad: la cabecera Host la controla quien hace la request, asi
 * que NO sirve para decisiones de seguridad. Aca solo se usa para componer un
 * enlace que se le muestra al propio medico autenticado, que es quien lo
 * comparte; si quedara mal, lo ve al instante. Para fijarlo de forma dura esta
 * PUBLIC_URL.
 */
const { frontendUrl } = require('../config/env');

/** Quita la barra final para no terminar con `//reservar/...`. */
function limpiar(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

/** Un origen es de desarrollo si apunta a la maquina local. */
function esLocal(url) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(limpiar(url));
}

/**
 * @param {import('express').Request} req
 * @returns {string} por ejemplo "https://tudominio.com" (sin barra final)
 */
function baseUrlPublica(req) {
  // 1. Configuracion explicita.
  if (process.env.PUBLIC_URL) return limpiar(process.env.PUBLIC_URL);

  // 2. Lo que informa el proxy. `app.set('trust proxy', 1)` hace que Express
  //    ya resuelva req.protocol y req.hostname desde las cabeceras X-Forwarded.
  const host = req?.get?.('x-forwarded-host') || req?.get?.('host');
  if (host) {
    const protocolo = req.protocol || 'http';
    const candidato = limpiar(`${protocolo}://${host}`);

    /*
     * Solo se toma si es un dominio real.
     *
     * En desarrollo el navegador llega por el proxy de Vite, que con
     * `changeOrigin: true` reescribe el Host al destino: el backend ve
     * "localhost:4000", que es el puerto de la API y NO sirve el frontend.
     * Usarlo daria un enlace roto apuntando al puerto equivocado.
     *
     * Cuando el host es local se cae a FRONTEND_URL, que si conoce el puerto
     * correcto del frontend (5173).
     */
    if (!esLocal(candidato)) return candidato;
  }

  // 3. Desarrollo, o sin cabeceras utiles.
  return limpiar(frontendUrl);
}

/**
 * Indica si el enlace generado sirve para compartir o quedo apuntando a
 * localhost. El frontend lo usa para avisarle al medico en vez de dejarlo
 * copiar un enlace roto.
 */
function esCompartible(url) {
  return Boolean(url) && !esLocal(url);
}

module.exports = { baseUrlPublica, esCompartible, esLocal };
