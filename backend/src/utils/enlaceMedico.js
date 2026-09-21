/**
 * utils/enlaceMedico.js
 * Identificador publico del medico para el enlace /reservar/:identificador
 *
 * ==========================================================================
 * Formato: matricula + apellido + nombre
 * ==========================================================================
 *     MP-14523 · Romero · Laura   ->   mp-14523-romero-laura
 *
 * Antes era un token aleatorio de 128 bits. El cambio lo pidio el consultorio:
 * un enlace legible se reconoce al pegarlo en WhatsApp y da confianza al
 * paciente, en vez de un "elvJc7LnEfGs2EDCuuW5Sw" que parece spam.
 *
 * ==========================================================================
 * Que se pierde y por que es aceptable
 * ==========================================================================
 * Un identificador legible es ADIVINABLE: sabiendo la matricula y el nombre de
 * un profesional se puede construir su enlace sin que lo compartan.
 *
 * Eso no filtra nada nuevo. La pagina publica muestra nombre, especialidad,
 * precio y turnos libres, que es exactamente lo que ya devuelve la busqueda
 * publica de /api/medicos a cualquiera. El enlace nunca fue un secreto: es un
 * atajo directo al perfil de un profesional.
 *
 * Lo que si se pierde es poder invalidar un enlace rotando el identificador,
 * porque regenerarlo daria el mismo slug. Para conservar esa capacidad:
 *   - `enlace_activo` permite apagarlo sin perder el identificador;
 *   - regenerar agrega un sufijo numerico (`...-romero-laura-2`), con lo que
 *     el anterior deja de resolver.
 */

/**
 * ==========================================================================
 * Longitud: por que 255 y no un numero cualquiera
 * ==========================================================================
 * El slug se arma con tres columnas de la base, asi que su largo maximo no es
 * arbitrario: se deduce de ellas.
 *
 *     medicos.matricula   VARCHAR(40)
 *     users.apellido      VARCHAR(80)
 *     users.nombre        VARCHAR(80)
 *     separadores                   2
 *     sufijo de regeneracion   hasta 6   ("-id123")
 *     -------------------------------------------
 *     PEOR CASO                   208 caracteres
 *
 * La columna `medicos.hash_publico` es VARCHAR(255): entra el peor caso con
 * margen, asi que el recorte de abajo no llega a activarse nunca en la
 * practica y queda solo como red de seguridad.
 *
 * Historia: la columna nacio como CHAR(22) (token aleatorio). Al pasar al
 * slug legible se amplio a 120, que alcanzaba para nombres normales pero NO
 * para el peor caso, y una base sin la migracion aplicada seguia en CHAR(22)
 * y fallaba con ER_DATA_TOO_LONG en cuanto un medico tenia un nombre un poco
 * largo. Ver db/migrations/004_hash_publico_255.sql
 *
 * SI SE CAMBIA ESTE NUMERO hay que cambiar la columna en la misma migracion.
 * El chequeo de arranque (config/verificarEsquema.js) avisa si se desalinean.
 */
const LARGO_MAXIMO = 255;

/** Margen que se reserva para el sufijo de regeneracion al recortar. */
const LARGO_SUFIJO_RESERVADO = 8;

/**
 * Normaliza un texto a un fragmento de URL: sin tildes, en minusculas y con
 * guiones en lugar de espacios o simbolos.
 *
 * @param {string} texto
 * @returns {string}
 */
function aFragmento(texto) {
  return String(texto || '')
    .normalize('NFD')                  // separa la letra de su tilde
    .replace(/[̀-ͯ]/g, '')   // y elimina la tilde
    .replace(/ñ/gi, 'n')               // la enie no lleva tilde combinante
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')       // todo lo demas pasa a guion
    .replace(/^-+|-+$/g, '')           // sin guiones al principio ni al final
    .replace(/-{2,}/g, '-');           // ni guiones repetidos
}

/**
 * Construye el identificador publico del medico.
 *
 * @param {Object} datos
 * @param {string} datos.matricula
 * @param {string} datos.apellido
 * @param {string} datos.nombre
 * @param {number} [datos.sufijo]  se agrega al regenerar, para invalidar el anterior
 * @returns {string} por ejemplo "mp-14523-romero-laura"
 */
function generarIdentificador({ matricula, apellido, nombre, sufijo = null }) {
  let base = [aFragmento(matricula), aFragmento(apellido), aFragmento(nombre)]
    .filter(Boolean)
    .join('-');

  const fragmentoSufijo = sufijo ? `-${aFragmento(String(sufijo))}` : '';

  /*
   * El recorte se hace sobre la BASE, antes de pegar el sufijo.
   *
   * Antes se recortaba el resultado ya con el sufijo puesto, y con un nombre
   * largo el recorte se comia justamente el sufijo: regenerar devolvia el
   * mismo identificador, el enlace viejo seguia sirviendo y
   * construirIdentificadorUnico entraba en un bucle de colisiones.
   */
  const espacioParaBase = LARGO_MAXIMO - Math.max(fragmentoSufijo.length, LARGO_SUFIJO_RESERVADO);

  if (base.length > espacioParaBase) {
    // Se corta por guion para no partir una palabra al medio.
    base = base.slice(0, espacioParaBase).replace(/-[^-]*$/, '');
  }

  return `${base}${fragmentoSufijo}`;
}

/**
 * Valida la forma del identificador antes de tocar la base: evita consultas
 * con basura y permite responder 404 limpio.
 *
 * Acepta tambien los tokens aleatorios de 22 caracteres del formato anterior,
 * para que los enlaces ya compartidos sigan funcionando durante la transicion.
 *
 * @param {string} valor
 * @returns {boolean}
 */
function esIdentificadorValido(valor) {
  if (typeof valor !== 'string') return false;
  if (valor.length < 3 || valor.length > LARGO_MAXIMO) return false;

  // Formato nuevo: minusculas, digitos y guiones.
  if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(valor)) return true;

  // Formato anterior: token base64url de 22 caracteres.
  return /^[A-Za-z0-9_-]{22}$/.test(valor);
}

module.exports = {
  generarIdentificador,
  esIdentificadorValido,
  aFragmento,
  LARGO_MAXIMO,
  LARGO_SUFIJO_RESERVADO,
};
