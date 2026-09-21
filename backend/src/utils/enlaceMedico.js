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

/** Longitud maxima, alineada con la columna VARCHAR(120) de `medicos`. */
const LARGO_MAXIMO = 120;

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
  const partes = [aFragmento(matricula), aFragmento(apellido), aFragmento(nombre)]
    .filter(Boolean);

  if (sufijo) partes.push(String(sufijo));

  let identificador = partes.join('-');

  // Si se pasa del largo de la columna se recorta por guion, para no cortar
  // una palabra por la mitad.
  if (identificador.length > LARGO_MAXIMO) {
    identificador = identificador.slice(0, LARGO_MAXIMO).replace(/-[^-]*$/, '');
  }

  return identificador;
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
};
