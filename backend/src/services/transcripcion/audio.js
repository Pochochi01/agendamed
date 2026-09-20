/**
 * services/transcripcion/audio.js
 * Decodificacion y validacion del audio recibido, TODO EN MEMORIA.
 *
 * ==========================================================================
 * El audio no toca el disco
 * ==========================================================================
 * MediaRecorder envia WebM/Opus, y Whisper necesita PCM crudo a 16 kHz mono.
 * La conversion la hace ffmpeg, pero SIN archivos temporales: se le pasa el
 * buffer por stdin y se lee el resultado de stdout (`pipe:0` y `pipe:1`).
 *
 * Es lo que permite cumplir la restriccion del proyecto: el audio vive solo
 * como Buffer en RAM mientras dura la request y se descarta apenas se obtiene
 * el texto. No hay fs.writeFile, ni carpeta de uploads, ni columna en la base.
 */
const { spawn } = require('child_process');
const rutaFfmpeg = require('ffmpeg-static');

/** Whisper trabaja a 16 kHz mono; convertir a otra cosa degrada el resultado. */
const FRECUENCIA = 16000;

/** Umbral de energia por debajo del cual consideramos que no hubo voz. */
const RMS_SILENCIO = 0.005;

/** Duracion minima util: menos que esto no alcanza ni para una palabra. */
const DURACION_MINIMA_SEG = 0.4;

/**
 * Error de audio con codigo, para que el controlador lo traduzca a un 400
 * con mensaje claro en vez de un 500 generico.
 */
class ErrorAudio extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorAudio';
    this.codigo = codigo;
    this.esDeAudio = true;
  }
}

/**
 * Convierte el audio recibido a Float32 mono 16 kHz usando ffmpeg por tuberias.
 *
 * @param {Buffer} buffer  audio tal como llego del navegador (webm/ogg/mp4...)
 * @returns {Promise<Float32Array>}
 * @throws {ErrorAudio} si ffmpeg no puede decodificarlo
 */
function decodificarAPcm(buffer) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(rutaFfmpeg, [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',        // entrada: stdin
      '-f', 'f32le',         // salida: float32 little-endian, lo que espera Whisper
      '-acodec', 'pcm_f32le',
      '-ac', '1',            // mono
      '-ar', String(FRECUENCIA),
      'pipe:1',              // salida: stdout
    ]);

    const trozos = [];
    let errorSalida = '';

    ffmpeg.stdout.on('data', (t) => trozos.push(t));
    ffmpeg.stderr.on('data', (t) => { errorSalida += t.toString(); });

    ffmpeg.on('error', (err) => {
      reject(new ErrorAudio('FFMPEG_NO_DISPONIBLE',
        `No se pudo ejecutar el conversor de audio: ${err.message}`));
    });

    ffmpeg.on('close', (codigo) => {
      if (codigo !== 0) {
        reject(new ErrorAudio('AUDIO_CORRUPTO',
          `El audio esta danado o en un formato no soportado. ${errorSalida.trim().slice(0, 200)}`));
        return;
      }

      const pcm = Buffer.concat(trozos);
      if (pcm.length < 4) {
        reject(new ErrorAudio('AUDIO_VACIO', 'La grabacion no contiene audio.'));
        return;
      }

      // El Buffer y el Float32Array comparten memoria: no se copia nada.
      resolve(new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 4)));
    });

    // Si ffmpeg muere antes de leer todo, stdin lanza EPIPE: se ignora porque
    // el error real ya viene por el codigo de salida.
    ffmpeg.stdin.on('error', () => {});
    ffmpeg.stdin.end(buffer);
  });
}

/**
 * Comprueba que el audio tenga contenido util antes de gastar CPU (o dinero
 * de una API) en transcribirlo.
 *
 * @param {Float32Array} muestras
 * @returns {{duracionSeg:number, rms:number}}
 * @throws {ErrorAudio} si esta vacio, es muy corto o es silencio
 */
function validarContenido(muestras) {
  const duracionSeg = muestras.length / FRECUENCIA;

  if (muestras.length === 0) {
    throw new ErrorAudio('AUDIO_VACIO', 'La grabacion esta vacia.');
  }
  if (duracionSeg < DURACION_MINIMA_SEG) {
    throw new ErrorAudio('AUDIO_MUY_CORTO',
      'La grabacion es demasiado corta. Manten presionado el dictado mientras hablas.');
  }

  // RMS: energia media de la senal. Un microfono mudo da practicamente cero.
  let suma = 0;
  for (let i = 0; i < muestras.length; i += 1) suma += muestras[i] * muestras[i];
  const rms = Math.sqrt(suma / muestras.length);

  if (rms < RMS_SILENCIO) {
    throw new ErrorAudio('AUDIO_SIN_VOZ',
      'No se detecto voz en la grabacion. Revisa que el microfono correcto este seleccionado '
      + 'y que no este silenciado.');
  }

  return { duracionSeg, rms };
}

module.exports = {
  decodificarAPcm,
  validarContenido,
  ErrorAudio,
  FRECUENCIA,
  DURACION_MINIMA_SEG,
};
