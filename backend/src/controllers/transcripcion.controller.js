/**
 * controllers/transcripcion.controller.js
 * Convierte una grabacion completa en texto. NO guarda nada.
 *
 * ==========================================================================
 * Por que transcribir y guardar son dos pasos separados
 * ==========================================================================
 * Este endpoint devuelve el texto y termina; el guardado sigue pasando por
 * POST /pacientes/:id/historia, que no cambio.
 *
 * Son dos pasos a proposito:
 *   1. El medico REVISA la transcripcion antes de que entre a la historia
 *      clinica. Un modelo de voz se equivoca con la terminologia medica y
 *      nada deberia persistirse sin que un humano lo lea.
 *   2. La ruta de guardado queda intacta, con sus validaciones y su control
 *      de acceso ya probados.
 *
 * ==========================================================================
 * El audio muere en esta funcion
 * ==========================================================================
 * Llega como Buffer en RAM (multer.memoryStorage), se transcribe y se
 * desreferencia. No se escribe a disco, no se guarda en la base y no se
 * registra en los logs: solo su tamano y duracion.
 */
const transcripcionService = require('../services/transcripcion');
const ApiError = require('../utils/ApiError');
const { transcripcion: config } = require('../config/env');

/** Mapea los errores de audio a un 400 con mensaje accionable. */
function traducirError(error) {
  if (error?.esDeAudio) {
    // Falta ffmpeg: es un problema del servidor, no del audio del usuario.
    if (error.codigo === 'FFMPEG_NO_DISPONIBLE') {
      return new ApiError(503,
        'El servidor no puede procesar audio en este momento. Avisa al administrador.');
    }
    return ApiError.badRequest(error.message);
  }

  switch (error?.codigo) {
    case 'SIN_CREDENCIALES':
      return new ApiError(503, 'La transcripcion no esta configurada en el servidor.');
    case 'AUDIO_DEMASIADO_GRANDE':
      return ApiError.badRequest(error.message);
    case 'PROVEEDOR_RECHAZO':
      return new ApiError(502, error.message);
    default:
      return null;
  }
}

/**
 * POST /api/transcripcion   (medico)
 * Content-Type: multipart/form-data
 * Campo `audio`: la grabacion completa (webm/ogg/mp4/wav)
 *
 * Respuesta 200:
 *   {
 *     ok: true,
 *     texto: "paciente refiere dolor precordial...",
 *     duracionSeg: 12.4,
 *     proveedor: "local",
 *     modelo: "Xenova/whisper-base",
 *     msProceso: 3820
 *   }
 */
async function transcribir(req, res) {
  if (!req.file) {
    throw ApiError.badRequest('No se recibio ningun audio. Envia el archivo en el campo "audio".');
  }

  // `let` para poder soltar la referencia al Buffer apenas se use.
  let buffer = req.file.buffer;
  const bytes = buffer?.length || 0;
  const mimeType = req.file.mimetype;

  if (bytes === 0) {
    throw ApiError.badRequest('La grabacion llego vacia. Volve a intentar el dictado.');
  }

  try {
    const resultado = await transcripcionService.transcribir({ buffer, mimeType });

    // eslint-disable-next-line no-console
    console.log(
      `[transcripcion] medico ${req.medico.id}: ${(bytes / 1024).toFixed(0)} KB, `
      + `${resultado.duracionSeg ?? '?'}s -> ${resultado.texto.length} caracteres `
      + `en ${resultado.msProceso}ms (${resultado.proveedor})`
    );

    return res.json({
      ok: true,
      texto: resultado.texto,
      duracionSeg: resultado.duracionSeg,
      proveedor: resultado.proveedor,
      modelo: resultado.modelo,
      msProceso: resultado.msProceso,
      // Recordatorio explicito para quien consuma la API.
      audioDescartado: true,
    });
  } catch (error) {
    const traducido = traducirError(error);
    if (traducido) throw traducido;

    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new ApiError(504,
        'La transcripcion tardo demasiado. Proba con un dictado mas corto.');
    }
    throw error;
  } finally {
    // El audio deja de estar referenciado aca: el recolector lo libera y no
    // queda copia en ningun lado.
    buffer = null;
    req.file.buffer = null;
  }
}

/**
 * GET /api/transcripcion/estado   (medico)
 * Para que el frontend sepa si puede ofrecer el dictado y con que limites.
 * No expone la API key.
 */
async function estado(_req, res) {
  return res.json({
    ok: true,
    disponible: config.proveedor === 'local' || Boolean(config.apiKey),
    proveedor: config.proveedor,
    modelo: config.proveedor === 'local' ? config.modeloLocal : config.modeloExterno,
    maxMb: config.maxMb,
    idioma: config.idiomaIso,
    // Con el proveedor externo el audio sale del servidor: el frontend lo avisa.
    audioSaleDelServidor: config.proveedor === 'externo',
  });
}

module.exports = { transcribir, estado };
