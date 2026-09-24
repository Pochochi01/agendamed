/**
 * utils/enlaceMedico.js
 * Identificador publico del medico para el enlace /reservar/:identificador
 *
 * ==========================================================================
 * Formato: tratamiento + nombre + apellido + especialidad
 * ==========================================================================
 *     Dra. Laura Romero · Cardiologia  ->  dra-laura-romero-cardiologia
 *
 * El enlace se comparte por WhatsApp y se imprime en un cartel, asi que lo
 * unico que lleva es lo que el paciente necesita reconocer: de quien es el
 * turno y de que. NADA de datos personales del profesional.
 *
 * Historia del formato:
 *   1. token aleatorio de 128 bits         -> ilegible, parecia spam
 *   2. matricula + apellido + nombre
 *   3. DNI + apellido + matricula          -> exponia el DNI en la URL
 *   4. tratamiento + nombre + apellido + especialidad   (actual)
 *
 * El paso 3 se revirtio a proposito: el DNI viajaba a la vista en cada enlace
 * compartido y en cada cartel impreso. Es un dato personal que no aporta nada
 * a quien saca un turno.
 *
 * A DIFERENCIA del DNI y la matricula, esta combinacion NO es unica por si
 * sola: puede haber dos "Juan Perez" de la misma especialidad. Por eso la
 * unicidad la resuelve `construirIdentificadorUnico` consultando la base y
 * agregando un sufijo numerico cuando hace falta. Nunca se da por sentada.
 *
 * Los enlaces YA generados no se tocan: `asegurarHashPublico` solo crea uno
 * cuando falta. Un profesional que ya venia operando conserva el suyo, porque
 * puede haberlo impreso o compartido; para pasarlo al formato nuevo hay que
 * regenerarlo a mano, y ahi se avisa que el anterior deja de resolver.
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
 * El slug se arma con columnas de la base, asi que su largo maximo no es
 * arbitrario: se deduce de ellas.
 *
 *     tratamiento ("dra")               3
 *     users.nombre            VARCHAR(80)
 *     users.apellido          VARCHAR(80)
 *     especialidades.nombre  VARCHAR(100)
 *     separadores                       3
 *     sufijo de regeneracion       hasta 6   ("-id123")
 *     ---------------------------------------------
 *     PEOR CASO                   272 caracteres
 *
 * Ese peor caso NO entra en la columna, asi que el recorte de mas abajo si
 * puede activarse: con nombres y especialidades reales sobra lugar, pero el
 * limite existe y se respeta. El recorte corta por guion y conserva siempre
 * el sufijo, que es lo que invalida el enlace anterior.
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
 *     { genero: 'femenino', nombre: 'Laura', apellido: 'Romero',
 *       especialidad: 'Cardiologia' }   ->   dra-laura-romero-cardiologia
 *
 * El tratamiento se incluye solo si el profesional cargo su genero: sin eso
 * seria "dr-a", que no se lee. La especialidad tambien es opcional, para no
 * fallar si el dato falta.
 *
 * NO recibe DNI ni matricula a proposito: son datos personales o
 * administrativos que no tienen por que viajar en un enlace que se manda por
 * WhatsApp y se pega en la puerta del consultorio.
 *
 * @param {Object} datos
 * @param {string} datos.nombre
 * @param {string} datos.apellido
 * @param {string} [datos.especialidad]
 * @param {'masculino'|'femenino'|null} [datos.genero]
 * @param {number|string} [datos.sufijo] se agrega al regenerar, para
 *   invalidar el enlace anterior
 * @returns {string} por ejemplo "dra-laura-romero-cardiologia"
 */
function generarIdentificador({ nombre, apellido, especialidad, genero, sufijo = null }) {
  // "Dr." / "Dra." -> "dr" / "dra". Sin genero cargado no se pone nada.
  const titulo = genero === 'masculino' ? 'dr' : (genero === 'femenino' ? 'dra' : '');

  const partes = [titulo, aFragmento(nombre), aFragmento(apellido), aFragmento(especialidad)];

  let base = partes.filter(Boolean).join('-');

  const fragmentoSufijo = sufijo ? `-${aFragmento(String(sufijo))}` : '';

  /*
   * El recorte se hace sobre la BASE, antes de pegar el sufijo.
   *
   * Antes se recortaba el resultado ya con el sufijo puesto, y con un nombre
   * largo el recorte se comia justamente el sufijo: regenerar devolvia el
   * mismo identificador, el enlace viejo seguia sirviendo y
   * construirIdentificadorUnico entraba en un bucle de colisiones.
   *
   * Con el formato actual esto SI puede pasar: una especialidad larga con un
   * nombre y apellido largos supera los 255.
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
