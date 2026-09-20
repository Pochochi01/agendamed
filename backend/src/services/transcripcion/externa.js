/**
 * services/transcripcion/externa.js
 * Proveedor de transcripcion por API EXTERNA compatible con el endpoint
 * `/v1/audio/transcriptions` de OpenAI (Whisper alojado).
 *
 * Se usa cuando el servidor no tiene CPU suficiente para correr Whisper local:
 * en un VPS de 1 vCPU la transcripcion local puede tardar varias veces la
 * duracion del audio.
 *
 * ==========================================================================
 * Implicancia de privacidad que hay que decidir a conciencia
 * ==========================================================================
 * Con este proveedor el audio del paciente SALE del servidor hacia un tercero.
 * La restriccion del proyecto (no persistir audio) se sigue cumpliendo —no se
 * guarda en disco ni en la base— pero el dato viaja. Para historias clinicas
 * conviene el proveedor `local`, o al menos tener un acuerdo de tratamiento de
 * datos con el proveedor externo.
 *
 * El audio se envia tal como llego del navegador (webm/opus): estas APIs lo
 * aceptan directamente, asi que no hace falta pasar por ffmpeg.
 */

/** La API rechaza archivos mas grandes que esto. */
const LIMITE_BYTES = 25 * 1024 * 1024;

/**
 * @param {Object} params
 * @param {Buffer} params.buffer      audio original del navegador
 * @param {string} params.mimeType
 * @param {Object} params.config      config.transcripcion
 * @returns {Promise<{texto:string, modelo:string}>}
 */
async function transcribir({ buffer, mimeType, config }) {
  if (!config.apiKey) {
    const error = new Error(
      'Falta TRANSCRIPCION_API_KEY en el .env para usar el proveedor externo.'
    );
    error.codigo = 'SIN_CREDENCIALES';
    throw error;
  }
  if (buffer.length > LIMITE_BYTES) {
    const error = new Error('La grabacion supera los 25 MB que admite el servicio externo.');
    error.codigo = 'AUDIO_DEMASIADO_GRANDE';
    throw error;
  }

  // FormData y Blob son globales desde Node 18: no hace falta ninguna libreria.
  const formulario = new FormData();
  formulario.append('file', new Blob([buffer], { type: mimeType }), 'dictado.webm');
  formulario.append('model', config.modeloExterno);
  // Fijar el idioma mejora la precision y evita que el modelo traduzca.
  formulario.append('language', config.idiomaIso);
  formulario.append('response_format', 'json');
  // Temperatura 0: salida determinista, menos propensa a inventar texto.
  formulario.append('temperature', '0');

  const respuesta = await fetch(`${config.apiUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: formulario,
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!respuesta.ok) {
    let detalle = '';
    try {
      const cuerpo = await respuesta.json();
      detalle = cuerpo?.error?.message || '';
    } catch { /* la respuesta no era JSON */ }

    const error = new Error(
      respuesta.status === 401
        ? 'El servicio de transcripcion rechazo la credencial. Revisa TRANSCRIPCION_API_KEY.'
        : `El servicio de transcripcion respondio ${respuesta.status}. ${detalle}`.trim()
    );
    error.codigo = 'PROVEEDOR_RECHAZO';
    throw error;
  }

  const datos = await respuesta.json();
  return { texto: String(datos?.text || '').trim(), modelo: config.modeloExterno };
}

module.exports = { transcribir, LIMITE_BYTES };
