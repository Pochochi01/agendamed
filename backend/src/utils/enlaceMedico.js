/**
 * utils/enlaceMedico.js
 * Identificador publico del medico para el enlace /reservar/:identificador
 *
 * ==========================================================================
 * Formato: DNI + apellido + matricula
 * ==========================================================================
 *     28456789 · Romero · MP-14523   ->   28456789-romero-mp-14523
 *
 * El DNI y la matricula son UNICOS por profesional, asi que la combinacion no
 * puede repetirse. Aun asi el alta verifica contra la base antes de asignar,
 * porque la unicidad tiene que garantizarla quien escribe, no la suerte.
 *
 * Historia del formato:
 *   1. token aleatorio de 128 bits  -> ilegible, parecia spam en WhatsApp
 *   2. matricula + apellido + nombre
 *   3. DNI + apellido + matricula   (actual)
 *
 * Los enlaces YA generados no se tocan: `asegurarHashPublico` solo crea uno
 * cuando falta. Un profesional que ya venia operando conserva el suyo, porque
 * puede haberlo impreso o compartido.
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
 *     medicos.dni         VARCHAR(20)
 *     users.apellido      VARCHAR(80)
 *     medicos.matricula   VARCHAR(40)
 *     separadores                   2
 *     sufijo de regeneracion   hasta 6   ("-id123")
 *     -------------------------------------------
 *     PEOR CASO                   148 caracteres
 *
 * (El formato anterior usaba el nombre en lugar del DNI y llegaba a 208; la
 *  columna se dimensiono para ese caso y sigue sobrando.)
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
 * Construye el identificador publico del medico: DNI + apellido + matricula.
 *
 * Si falta el DNI —los profesionales cargados antes de que el campo existiera
 * no lo tienen— se arma con lo que haya. No se inventa nada ni se falla: esos
 * casos ya tienen su enlace generado y este generador no los toca.
 *
 * @param {Object} datos
 * @param {string} [datos.dni]
 * @param {string} datos.apellido
 * @param {string} datos.matricula
 * @param {string} [datos.nombre]  solo se usa si no hay DNI, como desempate
 * @param {number|string} [datos.sufijo] se agrega al regenerar, para
 *   invalidar el enlace anterior
 * @returns {string} por ejemplo "28456789-romero-mp-14523"
 */
function generarIdentificador({ dni, apellido, matricula, nombre, sufijo = null }) {
  const partes = [aFragmento(dni), aFragmento(apellido), aFragmento(matricula)];

  // Sin DNI se cae al nombre para que el identificador siga siendo distintivo.
  if (!aFragmento(dni) && nombre) partes.push(aFragmento(nombre));

  let base = partes.filter(Boolean).join('-');

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
