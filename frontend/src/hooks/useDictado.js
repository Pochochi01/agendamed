/**
 * hooks/useDictado.js
 * Dictado por voz sobre la Web Speech API NATIVA del navegador.
 *
 * ==========================================================================
 * Por que no se usa react-speech-recognition
 * ==========================================================================
 * El microfono se activaba (Chrome mostraba el indicador y registraba la
 * actividad) pero `transcript` nunca se llenaba. Ese sintoma —captura de audio
 * OK, texto vacio— es de la capa del wrapper, no del permiso: los eventos
 * `onresult` del objeto de reconocimiento no llegaban al estado de React.
 *
 * Hablando con la API nativa se elimina esa capa, y sobre todo se pueden
 * enganchar `onerror` y `onend`, que el wrapper no expone. Chrome informa ahi
 * la causa real (`no-speech`, `network`, `not-allowed`, `audio-capture`,
 * `service-not-allowed`, `aborted`), que antes se perdia en silencio.
 *
 * La restriccion de arquitectura se mantiene intacta: el reconocimiento lo
 * hace el navegador y este hook solo maneja TEXTO. No hay MediaRecorder, ni
 * Blob, ni stream que se guarde en ningun lado.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** Une dos fragmentos cuidando el espacio del medio. */
export function unir(previo, nuevo) {
  const a = (previo || '').trim();
  const b = (nuevo || '').trim();
  if (!a) return b;
  if (!b) return a;
  return `${a} ${b}`;
}

/** Constructor nativo, con el prefijo de Chrome/Safari. */
function obtenerConstructor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

/** Traduce el codigo de error de la API a algo accionable. */
function explicarError(codigo) {
  switch (codigo) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'El navegador bloqueo el microfono. Tocá el candado junto a la direccion y permiti el acceso.';
    case 'audio-capture':
      return 'No se detecto ningun microfono conectado.';
    case 'no-speech':
      return 'No se detecto voz. Acercate al microfono y volve a intentar.';
    case 'network':
      return 'El reconocimiento de voz de Chrome necesita conexion a internet y no pudo alcanzar el servicio.';
    case 'aborted':
      return 'El dictado se interrumpio.';
    case 'language-not-supported':
      return 'El navegador no tiene soporte para el idioma configurado.';
    default:
      return `El navegador reporto: ${codigo}`;
  }
}

/**
 * @param {Object} opciones
 * @param {string} [opciones.idioma='es-AR']
 * @returns {Object} estado y controles del dictado
 */
export default function useDictado({ idioma = 'es-AR' } = {}) {
  const Constructor = obtenerConstructor();
  const soportado = Boolean(Constructor);

  const [escuchando, setEscuchando] = useState(false);
  const [textoFinal, setTextoFinal] = useState('');   // resultados definitivos
  const [textoParcial, setTextoParcial] = useState(''); // lo que se esta diciendo
  const [error, setError] = useState(null);
  // Diagnostico visible: sirve para saber que paso si no aparece texto.
  const [diagnostico, setDiagnostico] = useState({ eventos: [], resultados: 0 });

  const recRef = useRef(null);
  // El usuario quiere seguir dictando? Distingue un corte automatico de
  // Chrome (hay que reanudar) de un Detener deliberado.
  const queremosEscuchar = useRef(false);

  const anotar = useCallback((evento) => {
    setDiagnostico((d) => ({ ...d, eventos: [...d.eventos.slice(-5), evento] }));
  }, []);

  /** Crea y cablea una instancia nueva de reconocimiento. */
  const crear = useCallback(() => {
    const rec = new Constructor();
    rec.lang = idioma;
    rec.continuous = true;      // no corta en la primera pausa
    rec.interimResults = true;  // feedback en vivo mientras habla
    rec.maxAlternatives = 1;

    rec.onstart = () => { setEscuchando(true); anotar('start'); };

    rec.onaudiostart = () => anotar('audio');
    rec.onspeechstart = () => anotar('voz');

    rec.onresult = (evento) => {
      let definitivo = '';
      let parcial = '';

      // resultIndex marca desde donde hay novedades: lo anterior ya se proceso.
      for (let i = evento.resultIndex; i < evento.results.length; i += 1) {
        const resultado = evento.results[i];
        const texto = resultado[0]?.transcript || '';
        if (resultado.isFinal) definitivo += texto;
        else parcial += texto;
      }

      setDiagnostico((d) => ({ ...d, resultados: d.resultados + 1 }));

      if (definitivo.trim()) {
        setTextoFinal((previo) => unir(previo, definitivo));
        setTextoParcial('');
        anotar('texto');
      } else {
        setTextoParcial(parcial);
      }
    };

    rec.onerror = (evento) => {
      anotar(`error:${evento.error}`);
      // `no-speech` y `aborted` son ruido normal en dictados largos: Chrome los
      // emite al reanudar. Solo se muestran si el usuario ya dejo de dictar.
      if (evento.error === 'no-speech' || evento.error === 'aborted') return;
      setError(explicarError(evento.error));
      if (evento.error === 'not-allowed' || evento.error === 'audio-capture') {
        queremosEscuchar.current = false;
        setEscuchando(false);
      }
    };

    rec.onend = () => {
      // Solo la instancia ACTIVA puede reanudarse. Sin esta comparacion, el
      // onend de una instancia que se acaba de abortar relanzaria un segundo
      // reconocimiento en paralelo, y dos sesiones compitiendo por el
      // microfono es otra forma de terminar sin texto.
      if (recRef.current !== rec) return;

      anotar('end');
      // Chrome corta la sesion cada ~60s o tras un silencio, aun con
      // continuous=true. Si el usuario no presiono Detener, se reanuda.
      if (!queremosEscuchar.current) {
        setEscuchando(false);
        return;
      }

      try {
        rec.start();
        anotar('reanuda');
      } catch {
        // InvalidStateError: la instancia todavia no termino de liberarse.
        // Se reintenta una vez tras un respiro en vez de cortar el dictado en
        // silencio, que es como se perdian las evoluciones largas.
        anotar('reintenta');
        setTimeout(() => {
          if (recRef.current !== rec || !queremosEscuchar.current) return;
          try {
            rec.start();
            anotar('reanuda');
          } catch {
            setEscuchando(false);
            setError('El dictado se interrumpio. Presiona "Seguir dictando" para continuar.');
          }
        }, 300);
      }
    };

    return rec;
  }, [Constructor, idioma, anotar]);

  const iniciar = useCallback(() => {
    if (!soportado) {
      setError('Este navegador no soporta dictado por voz. Usa Chrome, Edge o Safari.');
      return;
    }
    setError(null);
    setTextoParcial('');
    setDiagnostico({ eventos: [], resultados: 0 });

    // Se corta cualquier instancia previa ANTES de marcar que queremos
    // escuchar: asi su `onend` no intenta reanudarla.
    queremosEscuchar.current = false;
    try { recRef.current?.abort(); } catch { /* no habia ninguna activa */ }
    recRef.current = null;

    queremosEscuchar.current = true;

    // Instancia nueva en cada dictado: reutilizar una que ya termino es una
    // fuente conocida de sesiones que arrancan mudas.
    const rec = crear();
    recRef.current = rec;

    try {
      rec.start();
    } catch (err) {
      // InvalidStateError: ya estaba iniciada. Se reintenta tras el corte.
      anotar(`start-fallo:${err.name}`);
      setTimeout(() => { try { rec.start(); } catch { setEscuchando(false); } }, 250);
    }
  }, [soportado, crear, anotar]);

  const detener = useCallback(() => {
    queremosEscuchar.current = false;
    try {
      // stop() deja que lleguen los resultados pendientes; abort() los tira.
      recRef.current?.stop();
    } catch { /* ya estaba detenida */ }
    setEscuchando(false);
  }, []);

  const limpiar = useCallback(() => {
    setTextoFinal('');
    setTextoParcial('');
    setError(null);
  }, []);

  /** Permite al componente corregir el texto a mano. */
  const reemplazarTexto = useCallback((texto) => {
    setTextoFinal(texto);
    setTextoParcial('');
  }, []);

  // Al desmontar (por ejemplo si se cierra el modal) el microfono no puede
  // quedar abierto.
  useEffect(() => () => {
    queremosEscuchar.current = false;
    try { recRef.current?.abort(); } catch { /* nada activo */ }
  }, []);

  return {
    soportado,
    escuchando,
    // Lo confirmado mas lo que se esta diciendo en este momento.
    texto: unir(textoFinal, textoParcial),
    textoFinal,
    textoParcial,
    error,
    diagnostico,
    iniciar,
    detener,
    limpiar,
    reemplazarTexto,
    setError,
  };
}
