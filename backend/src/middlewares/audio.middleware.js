/**
 * middlewares/audio.middleware.js
 * Recepcion del audio del dictado con multer, EN MEMORIA.
 *
 * ==========================================================================
 * memoryStorage, no diskStorage: es la pieza que hace cumplir la restriccion
 * ==========================================================================
 * `multer.memoryStorage()` deja el archivo en `req.file.buffer`, un Buffer en
 * RAM. No se crea ningun archivo temporal, asi que no queda rastro del audio
 * en el disco del servidor ni hay nada que limpiar despues.
 *
 * Este es el UNICO endpoint de toda la API que acepta multipart/form-data, y
 * acepta un solo campo (`audio`). Cualquier otro archivo se rechaza.
 */
const multer = require('multer');
const ApiError = require('../utils/ApiError');
const { transcripcion } = require('../config/env');

/**
 * Formatos que produce MediaRecorder segun el navegador.
 * Chrome/Edge: audio/webm;codecs=opus · Firefox: audio/ogg · Safari: audio/mp4
 */
const TIPOS_PERMITIDOS = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
];

const subidaAudio = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: transcripcion.maxMb * 1024 * 1024,
    files: 1,       // un solo archivo por request
    fields: 4,      // campos de texto acompanantes (turnoId, etc.)
  },
  fileFilter: (_req, file, cb) => {
    // El navegador agrega el codec: "audio/webm;codecs=opus".
    const tipoBase = String(file.mimetype || '').split(';')[0].trim().toLowerCase();

    if (!TIPOS_PERMITIDOS.includes(tipoBase)) {
      cb(ApiError.badRequest(
        `Formato de audio no soportado (${file.mimetype}). Se esperaba webm, ogg, mp4 o wav.`
      ));
      return;
    }
    cb(null, true);
  },
});

/**
 * Envuelve el middleware de multer para traducir sus errores a ApiError, y
 * que el cliente reciba un mensaje util en vez de un 500.
 */
function recibirAudio(req, res, next) {
  subidaAudio.single('audio')(req, res, (error) => {
    if (!error) return next();

    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return next(ApiError.badRequest(
          `La grabacion supera el limite de ${transcripcion.maxMb} MB. `
          + 'Divi­dila en dictados mas cortos.'
        ));
      }
      if (error.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(ApiError.badRequest('Solo se admite un archivo, en el campo "audio".'));
      }
      return next(ApiError.badRequest(`No se pudo recibir el audio: ${error.message}`));
    }

    return next(error);   // ya es un ApiError del fileFilter
  });
}

module.exports = { recibirAudio, TIPOS_PERMITIDOS };
