/**
 * hooks/useGrabadorAudio.js
 * Grabacion de audio con MediaRecorder para el dictado de la historia clinica.
 *
 * ==========================================================================
 * Por que se dejo el reconocimiento en tiempo real
 * ==========================================================================
 * Antes se usaba la Web Speech API, que reconoce mientras el medico habla.
 * Ese modo tiene dos problemas que se volvieron bloqueantes:
 *
 *   1. REPETICIONES. El navegador corta la sesion cada ~60 s y hay que
 *      reanudarla; los tramos se solapan y las palabras del borde aparecen
 *      dos veces. Tambien devolvia resultados parciales que se pisaban entre si.
 *   2. Dependia de un servicio del navegador que, si no detectaba voz, no
 *      devolvia nada y no habia forma de reintentar sobre lo ya hablado.
 *
 * Ahora se graba el audio COMPLETO y se envia una sola vez al terminar. El
 * servidor lo transcribe de una pasada, sin estado acumulado: por construccion
 * no puede duplicar texto.
 *
 * ==========================================================================
 * El audio no se guarda en ningun lado
 * ==========================================================================
 * Los trozos viven en un array en memoria, se arman en un Blob que se sube y
 * se descartan al terminar. No se ofrece descarga, no se escribe en
 * IndexedDB/localStorage y el servidor lo procesa en RAM sin tocar disco.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** Duracion maxima de un dictado. Evita subidas enormes y timeouts. */
const MAX_SEGUNDOS = 300;   // 5 minutos

/**
 * Elige el mejor contenedor que soporte el navegador.
 * Chrome/Edge -> webm/opus · Firefox -> ogg/opus · Safari -> mp4
 */
function elegirMimeType() {
  const candidatos = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
  ];
  if (typeof MediaRecorder === 'undefined') return null;
  return candidatos.find((t) => MediaRecorder.isTypeSupported(t)) || null;
}

export default function useGrabadorAudio() {
  const soportado = typeof MediaRecorder !== 'undefined'
    && typeof navigator !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia);

  const [grabando, setGrabando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [nivel, setNivel] = useState(0);      // 0..1, para el medidor visual
  const [pico, setPico] = useState(0);
  const [error, setError] = useState(null);

  const grabadorRef = useRef(null);
  const streamRef = useRef(null);
  const trozosRef = useRef([]);
  const contextoRef = useRef(null);
  const animacionRef = useRef(null);
  const cronometroRef = useRef(null);
  // Promesa que resuelve con el Blob cuando MediaRecorder termina de volcar.
  const resolverRef = useRef(null);

  /** Cierra microfono, analizador y temporizadores. */
  const liberar = useCallback(() => {
    if (animacionRef.current) cancelAnimationFrame(animacionRef.current);
    animacionRef.current = null;

    if (cronometroRef.current) clearInterval(cronometroRef.current);
    cronometroRef.current = null;

    // Cortar las pistas apaga el indicador de microfono del navegador.
    streamRef.current?.getTracks().forEach((pista) => pista.stop());
    streamRef.current = null;

    contextoRef.current?.close().catch(() => { /* ya cerrado */ });
    contextoRef.current = null;

    setNivel(0);
  }, []);

  /** Medidor de nivel: confirma que el microfono capta sonido. */
  const engancharMedidor = useCallback((stream) => {
    try {
      const Contexto = window.AudioContext || window.webkitAudioContext;
      const contexto = new Contexto();
      contextoRef.current = contexto;

      const fuente = contexto.createMediaStreamSource(stream);
      const analizador = contexto.createAnalyser();
      analizador.fftSize = 512;
      fuente.connect(analizador);
      // No se conecta a la salida: no hay reproduccion ni eco.

      const muestras = new Uint8Array(analizador.frequencyBinCount);

      const medir = () => {
        analizador.getByteTimeDomainData(muestras);
        let suma = 0;
        for (let i = 0; i < muestras.length; i += 1) {
          const d = (muestras[i] - 128) / 128;
          suma += d * d;
        }
        const valor = Math.min(1, Math.sqrt(suma / muestras.length) * 4);
        setNivel(valor);
        setPico((p) => (valor > p ? valor : p));
        animacionRef.current = requestAnimationFrame(medir);
      };
      medir();
    } catch {
      // El medidor es opcional: si falla, la grabacion sigue funcionando.
    }
  }, []);

  const iniciar = useCallback(async () => {
    if (!soportado) {
      setError('Este navegador no permite grabar audio. Usa Chrome, Edge, Firefox o Safari.');
      return false;
    }

    setError(null);
    setSegundos(0);
    setPico(0);
    trozosRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,   // compensa si el medico habla lejos
          channelCount: 1,
        },
      });
      streamRef.current = stream;

      const mimeType = elegirMimeType();
      const grabador = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      grabadorRef.current = grabador;

      grabador.ondataavailable = (evento) => {
        if (evento.data && evento.data.size > 0) trozosRef.current.push(evento.data);
      };

      grabador.onstop = () => {
        const blob = new Blob(trozosRef.current, {
          type: grabador.mimeType || mimeType || 'audio/webm',
        });
        trozosRef.current = [];           // se sueltan los trozos
        liberar();
        setGrabando(false);
        resolverRef.current?.(blob);
        resolverRef.current = null;
      };

      grabador.onerror = (evento) => {
        setError(`Error al grabar: ${evento.error?.message || 'desconocido'}`);
        liberar();
        setGrabando(false);
        resolverRef.current?.(null);
        resolverRef.current = null;
      };

      // Sin timeslice: un solo volcado al detener. Con este flujo no hace
      // falta recibir trozos parciales.
      grabador.start();
      setGrabando(true);

      engancharMedidor(stream);

      cronometroRef.current = setInterval(() => {
        setSegundos((s) => {
          const siguiente = s + 1;
          if (siguiente >= MAX_SEGUNDOS && grabadorRef.current?.state === 'recording') {
            // Corte de seguridad: no se permiten grabaciones interminables.
            grabadorRef.current.stop();
          }
          return siguiente;
        });
      }, 1000);

      return true;
    } catch (err) {
      const nombre = err?.name || '';
      if (nombre === 'NotAllowedError') {
        setError('El navegador bloqueo el microfono. Toca el candado junto a la direccion y permiti el acceso.');
      } else if (nombre === 'NotFoundError') {
        setError('No se encontro ningun microfono conectado.');
      } else if (nombre === 'NotReadableError') {
        setError('Otro programa esta usando el microfono. Cerralo y volve a intentar.');
      } else {
        setError(`No se pudo abrir el microfono: ${err?.message || nombre}`);
      }
      liberar();
      return false;
    }
  }, [soportado, liberar, engancharMedidor]);

  /**
   * Detiene la grabacion y resuelve con el audio completo.
   * @returns {Promise<Blob|null>}
   */
  const detener = useCallback(() => new Promise((resolve) => {
    const grabador = grabadorRef.current;
    if (!grabador || grabador.state === 'inactive') {
      resolve(null);
      return;
    }
    // onstop resuelve esta promesa con el Blob ya armado.
    resolverRef.current = resolve;
    grabador.stop();
  }), []);

  /** Cancela sin devolver audio: se descarta lo grabado. */
  const cancelar = useCallback(() => {
    const grabador = grabadorRef.current;
    resolverRef.current = null;
    if (grabador && grabador.state !== 'inactive') {
      grabador.onstop = null;
      grabador.stop();
    }
    trozosRef.current = [];
    liberar();
    setGrabando(false);
    setSegundos(0);
  }, [liberar]);

  // Si el componente se va (por ejemplo al cerrar el modal) el microfono no
  // puede quedar abierto ni el audio en memoria.
  useEffect(() => () => {
    resolverRef.current = null;
    const grabador = grabadorRef.current;
    if (grabador && grabador.state !== 'inactive') {
      grabador.onstop = null;
      try { grabador.stop(); } catch { /* ya detenido */ }
    }
    trozosRef.current = [];
    liberar();
  }, [liberar]);

  return {
    soportado,
    grabando,
    segundos,
    maxSegundos: MAX_SEGUNDOS,
    nivel,
    pico,
    error,
    setError,
    iniciar,
    detener,
    cancelar,
  };
}
