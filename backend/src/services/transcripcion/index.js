/**
 * services/transcripcion/index.js
 * Orquestador de la transcripcion. Es el unico punto que conoce el
 * controlador: decide el proveedor, valida el audio y limpia el texto.
 *
 * ==========================================================================
 * El audio se transcribe UNA SOLA VEZ, al terminar la grabacion
 * ==========================================================================
 * Antes el reconocimiento era incremental en el navegador: cada tramo se
 * procesaba por separado mientras el medico hablaba, y los solapes entre
 * tramos duplicaban palabras y frases.
 *
 * Ahora entra la grabacion COMPLETA y se procesa de una pasada. No hay estado
 * acumulado entre llamadas, asi que no existe la clase de error que producia
 * las repeticiones.
 *
 * ==========================================================================
 * El audio nunca se persiste
 * ==========================================================================
 * Llega como Buffer en memoria (multer.memoryStorage), se decodifica por
 * tuberias hacia ffmpeg y se descarta al terminar. No hay escritura a disco ni
 * columna de audio en la base: solo se devuelve texto.
 */
const { decodificarAPcm, validarContenido, ErrorAudio } = require('./audio');
const proveedorLocal = require('./local');
const proveedorExterno = require('./externa');
const { transcripcion: config } = require('../../config/env');

/**
 * Limpia artefactos tipicos de los modelos de voz.
 *
 * Whisper a veces repite la ultima frase cuando el audio termina en silencio
 * (conocido como "repetition loop"). Se detecta y se recorta: es la ultima
 * red contra el sintoma que motivo este cambio.
 *
 * @param {string} texto
 * @returns {string}
 */
function limpiarTexto(texto) {
  let limpio = String(texto || '')
    .replace(/\s+/g, ' ')                       // espacios repetidos
    .replace(/\s+([,.;:!?])/g, '$1')            // espacio antes de puntuacion
    .trim();

  if (!limpio) return '';

  /*
   * Colapso de frases repetidas consecutivas.
   * Se parte por signos de puntuacion fuerte y se descarta una oracion si es
   * identica a la anterior (ignorando mayusculas y tildes de puntuacion).
   */
  const oraciones = limpio.split(/(?<=[.!?])\s+/);
  const resultado = [];
  for (const oracion of oraciones) {
    const normalizada = oracion.toLowerCase().replace(/[.,;:!?]/g, '').trim();
    const anterior = resultado.length
      ? resultado[resultado.length - 1].toLowerCase().replace(/[.,;:!?]/g, '').trim()
      : null;
    if (normalizada && normalizada === anterior) continue;   // duplicado exacto
    resultado.push(oracion);
  }
  limpio = resultado.join(' ');

  /*
   * Colapso de una misma palabra repetida muchas veces seguidas
   * ("el el el el"), otro artefacto clasico del modelo. Se conservan hasta
   * dos repeticiones, que en castellano pueden ser legitimas ("muy muy").
   */
  limpio = limpio.replace(/\b(\p{L}+)(\s+\1\b){2,}/giu, '$1 $1');

  return limpio.trim();
}

/**
 * Transcribe una grabacion completa.
 *
 * @param {Object} params
 * @param {Buffer} params.buffer    audio tal como lo envio el navegador
 * @param {string} params.mimeType
 * @returns {Promise<{texto:string, proveedor:string, modelo:string, duracionSeg:number, msProceso:number}>}
 * @throws {ErrorAudio} audio vacio, corto, mudo o corrupto
 */
async function transcribir({ buffer, mimeType }) {
  const inicio = Date.now();

  if (!buffer || buffer.length === 0) {
    throw new ErrorAudio('AUDIO_VACIO', 'No se recibio ningun audio.');
  }

  let texto;
  let modelo;
  let duracionSeg;

  if (config.proveedor === 'externo') {
    // El servicio externo acepta webm directamente: no hace falta decodificar.
    // Aun asi se valida el contenido para no gastar una llamada paga en una
    // grabacion muda, salvo que ffmpeg no este disponible.
    try {
      const muestras = await decodificarAPcm(buffer);
      ({ duracionSeg } = validarContenido(muestras));
    } catch (error) {
      if (error.esDeAudio && error.codigo !== 'FFMPEG_NO_DISPONIBLE') throw error;
      // Sin ffmpeg se delega la validacion al proveedor.
      duracionSeg = null;
    }

    ({ texto, modelo } = await proveedorExterno.transcribir({ buffer, mimeType, config }));
  } else {
    const muestras = await decodificarAPcm(buffer);
    ({ duracionSeg } = validarContenido(muestras));
    ({ texto, modelo } = await proveedorLocal.transcribir({ muestras, duracionSeg, config }));
  }

  const limpio = limpiarTexto(texto);

  if (!limpio) {
    throw new ErrorAudio('SIN_TEXTO',
      'No se pudo reconocer ninguna palabra en la grabacion. Proba hablando mas cerca del microfono.');
  }

  return {
    texto: limpio,
    proveedor: config.proveedor,
    modelo,
    duracionSeg: duracionSeg ? Number(duracionSeg.toFixed(1)) : null,
    msProceso: Date.now() - inicio,
  };
}

/** Precarga el modelo local al arrancar, si corresponde. */
async function precalentar() {
  if (config.proveedor !== 'local' || !config.precargar) return false;
  await proveedorLocal.precargar(config);
  return true;
}

module.exports = { transcribir, limpiarTexto, precalentar, ErrorAudio };
