/**
 * hooks/useNivelMicrofono.js
 * Medidor de nivel de entrada del microfono, solo para diagnostico.
 *
 * ==========================================================================
 * Por que existe
 * ==========================================================================
 * Cuando la Web Speech API devuelve `no-speech` una y otra vez con el
 * microfono encendido, hay dos explicaciones posibles y desde el codigo no se
 * distinguen: o el servicio de reconocimiento no procesa, o el navegador esta
 * capturando SILENCIO (dispositivo de entrada equivocado, silenciado, o con
 * el volumen en cero).
 *
 * Este medidor responde esa pregunta: si la barra no se mueve al hablar, no
 * llega sonido y el problema es del dispositivo, no de la aplicacion.
 *
 * ==========================================================================
 * Y la restriccion de no guardar audio?
 * ==========================================================================
 * Se respeta. Aca se abre un stream y se lee su AMPLITUD instantanea con un
 * AnalyserNode, que trabaja sobre el buffer que ya esta en memoria:
 *
 *   - NO se instancia MediaRecorder;
 *   - NO se crea ningun Blob ni archivo;
 *   - NO se envia nada al servidor;
 *   - las muestras no se acumulan: cada frame se descarta al siguiente.
 *
 * Ademas es opcional y explicito: solo se activa si el medico abre el
 * diagnostico y presiona "Probar microfono", y el stream se cierra al salir.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export default function useNivelMicrofono() {
  const [midiendo, setMidiendo] = useState(false);
  const [nivel, setNivel] = useState(0);        // 0..1
  const [pico, setPico] = useState(0);          // maximo detectado en la sesion
  const [dispositivos, setDispositivos] = useState([]);
  const [error, setError] = useState(null);

  const streamRef = useRef(null);
  const contextoRef = useRef(null);
  const animacionRef = useRef(null);

  /** Cierra todo: pista de audio, contexto y bucle de animacion. */
  const detener = useCallback(() => {
    if (animacionRef.current) cancelAnimationFrame(animacionRef.current);
    animacionRef.current = null;

    // Cortar las pistas apaga el indicador de microfono del navegador.
    streamRef.current?.getTracks().forEach((pista) => pista.stop());
    streamRef.current = null;

    contextoRef.current?.close().catch(() => { /* ya estaba cerrado */ });
    contextoRef.current = null;

    setMidiendo(false);
    setNivel(0);
  }, []);

  const iniciar = useCallback(async () => {
    setError(null);
    setPico(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // Sin procesamiento: queremos ver la senal como llega.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = stream;

      // Que dispositivo eligio el navegador. La Web Speech API usa SIEMPRE el
      // predeterminado del sistema, asi que este es el que importa.
      try {
        const lista = await navigator.mediaDevices.enumerateDevices();
        setDispositivos(lista.filter((d) => d.kind === 'audioinput').map((d) => ({
          id: d.deviceId,
          nombre: d.label || '(sin permiso para ver el nombre)',
          enUso: stream.getAudioTracks()[0]?.getSettings?.().deviceId === d.deviceId,
        })));
      } catch { /* enumerar no es critico */ }

      const Contexto = window.AudioContext || window.webkitAudioContext;
      const contexto = new Contexto();
      contextoRef.current = contexto;

      const fuente = contexto.createMediaStreamSource(stream);
      const analizador = contexto.createAnalyser();
      analizador.fftSize = 512;
      fuente.connect(analizador);
      // El analizador NO se conecta a la salida: no hay reproduccion ni eco.

      const muestras = new Uint8Array(analizador.frequencyBinCount);

      const medir = () => {
        analizador.getByteTimeDomainData(muestras);

        // RMS de la forma de onda: 128 es el silencio en este formato.
        let suma = 0;
        for (let i = 0; i < muestras.length; i += 1) {
          const desviacion = (muestras[i] - 128) / 128;
          suma += desviacion * desviacion;
        }
        const rms = Math.sqrt(suma / muestras.length);
        // x4 para que la voz normal llene buena parte de la barra.
        const valor = Math.min(1, rms * 4);

        setNivel(valor);
        setPico((anterior) => (valor > anterior ? valor : anterior));

        animacionRef.current = requestAnimationFrame(medir);
      };

      setMidiendo(true);
      medir();
    } catch (err) {
      const nombre = err?.name || '';
      if (nombre === 'NotAllowedError') {
        setError('El navegador bloqueo el microfono. Tocá el candado junto a la direccion y permiti el acceso.');
      } else if (nombre === 'NotFoundError') {
        setError('No se encontro ningun microfono conectado.');
      } else if (nombre === 'NotReadableError') {
        setError('Otro programa esta usando el microfono. Cerralo y volve a probar.');
      } else {
        setError(`No se pudo abrir el microfono: ${err?.message || nombre}`);
      }
      detener();
    }
  }, [detener]);

  // Nunca dejar el microfono abierto si el componente se va.
  useEffect(() => detener, [detener]);

  return { midiendo, nivel, pico, dispositivos, error, iniciar, detener };
}
