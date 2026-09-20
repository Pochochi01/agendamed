/**
 * services/transcripcion/local.js
 * Proveedor de transcripcion LOCAL: Whisper corriendo en el propio servidor
 * con @xenova/transformers (ONNX, sin GPU).
 *
 * Es el proveedor recomendado para datos clinicos: el audio no sale del
 * servidor ni se comparte con terceros.
 *
 * ==========================================================================
 * Por que no se repiten palabras
 * ==========================================================================
 * El problema anterior venia del reconocimiento en tiempo real: cada tramo se
 * reconocia por separado y los solapes entre tramos duplicaban palabras.
 *
 * Aca se transcribe el audio COMPLETO de una sola vez. Para las grabaciones
 * largas, Whisper las parte internamente en ventanas de `chunk_length_s` con
 * un solape de `stride_length_s`, y el propio modelo reconcilia ese solape
 * (long-form transcription). El resultado es un texto continuo, sin las
 * repeticiones que producia el modo incremental.
 */
const { FRECUENCIA } = require('./audio');

/**
 * El pipeline se carga una sola vez y queda en memoria: la primera llamada
 * descarga el modelo (unos 40-250 MB segun cual) y las siguientes lo reusan.
 * Se guarda la promesa, no el resultado, para que dos requests simultaneas
 * durante el arranque no disparen dos descargas.
 */
let promesaPipeline = null;
let modeloCargado = null;

/**
 * @param {string} modelo  id del modelo en Hugging Face
 * @returns {Promise<Function>} pipeline de reconocimiento de voz
 */
async function obtenerPipeline(modelo) {
  if (promesaPipeline && modeloCargado === modelo) return promesaPipeline;

  /*
   * Import dinamico, no `require`.
   *
   * @xenova/transformers se publica como ES Module puro: intentar cargarlo con
   * require() desde este backend CommonJS falla con
   * "require() of ES Module ... not supported".
   *
   * `await import()` si funciona desde CommonJS y, de paso, mantiene la carga
   * diferida: el paquete es pesado y solo hace falta si el proveedor
   * configurado es el local.
   */
  const { pipeline, env } = await import('@xenova/transformers');

  // Los modelos se bajan del hub y se cachean en disco. Eso es el MODELO, no
  // audio: ningun dato del paciente se persiste.
  env.allowLocalModels = false;

  modeloCargado = modelo;
  promesaPipeline = pipeline('automatic-speech-recognition', modelo, { quantized: true });

  try {
    return await promesaPipeline;
  } catch (error) {
    // Si falla la carga se limpia para poder reintentar en la proxima request.
    promesaPipeline = null;
    modeloCargado = null;
    throw error;
  }
}

/**
 * Transcribe el audio completo.
 *
 * @param {Object} params
 * @param {Float32Array} params.muestras   PCM mono 16 kHz
 * @param {number} params.duracionSeg
 * @param {Object} params.config           config.transcripcion
 * @returns {Promise<{texto:string, modelo:string}>}
 */
async function transcribir({ muestras, duracionSeg, config }) {
  const transcriptor = await obtenerPipeline(config.modeloLocal);

  const salida = await transcriptor(muestras, {
    language: config.idioma,      // 'spanish' fuerza el idioma y evita que
    task: 'transcribe',           // el modelo "traduzca" al ingles
    // Ventanas con solape: Whisper reconcilia el solape internamente, que es
    // lo que evita las palabras repetidas en grabaciones largas.
    chunk_length_s: 30,
    stride_length_s: 5,
    // Audio corto: no hace falta trocear.
    ...(duracionSeg <= 30 ? { chunk_length_s: undefined, stride_length_s: undefined } : {}),
    return_timestamps: false,
  });

  const texto = String(salida?.text || '').trim();
  return { texto, modelo: config.modeloLocal };
}

/** Permite precargar el modelo al arrancar, para que la primera consulta no espere. */
function precargar(config) {
  return obtenerPipeline(config.modeloLocal);
}

module.exports = { transcribir, precargar, FRECUENCIA };
