/**
 * components/DictadoVoz.jsx
 * Dictado de la historia clinica: grabar -> detener -> transcribir -> revisar.
 *
 * ==========================================================================
 * Flujo (y por que cambio)
 * ==========================================================================
 * Antes el navegador reconocia la voz EN TIEMPO REAL, y eso duplicaba
 * palabras: el reconocimiento se cortaba cada ~60 s, había que reanudarlo y
 * los tramos solapados repetían las frases del borde.
 *
 * Ahora:
 *   1. "Iniciar dictado"  -> MediaRecorder captura el audio completo.
 *   2. "Detener"          -> se arma un Blob con toda la grabacion.
 *   3. Se sube UNA VEZ a POST /api/transcripcion.
 *   4. El servidor transcribe de una pasada y devuelve el texto.
 *   5. El medico lo revisa y corrige antes de guardarlo.
 *
 * Al procesarse la grabacion entera de una sola vez no hay estado acumulado
 * entre tramos, asi que la duplicacion no puede ocurrir.
 *
 * ==========================================================================
 * El audio no se persiste
 * ==========================================================================
 * El Blob vive en memoria hasta que se sube, y el servidor lo procesa en RAM
 * y lo descarta. No se guarda en disco, ni en la base, ni en el navegador.
 */
import { useEffect, useState } from 'react';
import useGrabadorAudio from '../hooks/useGrabadorAudio';
import { transcripcionApi } from '../api/servicios';
import { Aviso } from './UI';

/** 95 -> "1:35" */
function formatearTiempo(segundos) {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Une dos fragmentos cuidando el espacio del medio. */
function unir(previo, nuevo) {
  const a = (previo || '').trim();
  const b = (nuevo || '').trim();
  if (!a) return b;
  if (!b) return a;
  return `${a} ${b}`;
}

/**
 * @param {Object}   props
 * @param {Function} props.onTextoListo  async (texto) => void. Si rechaza, el
 *   texto NO se borra: el medico no pierde lo dictado.
 * @param {boolean}  props.deshabilitado
 */
export default function DictadoVoz({ onTextoListo, deshabilitado = false }) {
  const grabador = useGrabadorAudio();

  // Texto confirmado y editable. Las transcripciones se le van sumando.
  const [texto, setTexto] = useState('');
  const [transcribiendo, setTranscribiendo] = useState(false);
  const [progresoSubida, setProgresoSubida] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [estadoServicio, setEstadoServicio] = useState(null);

  // Se consulta si el servidor puede transcribir, para no ofrecer un boton
  // que va a fallar.
  useEffect(() => {
    transcripcionApi.estado()
      .then(setEstadoServicio)
      .catch(() => setEstadoServicio({ disponible: false }));
  }, []);

  /** Paso 1: abre el microfono y empieza a grabar. */
  const iniciarGrabacion = async () => {
    setError(null);
    setAviso(null);
    await grabador.iniciar();
  };

  /**
   * Pasos 2 a 4: corta la grabacion, la sube completa y suma el texto.
   */
  const detenerYTranscribir = async () => {
    setError(null);
    const blob = await grabador.detener();

    if (!blob || blob.size === 0) {
      setError('No se capturo audio. Revisa que el microfono este funcionando.');
      return;
    }

    setTranscribiendo(true);
    setProgresoSubida(0);

    try {
      const respuesta = await transcripcionApi.transcribir(blob, setProgresoSubida);
      // Se SUMA al texto previo: dictar de nuevo agrega, no reemplaza.
      setTexto((previo) => unir(previo, respuesta.texto));
      setAviso(
        `Transcripcion lista (${respuesta.duracionSeg ?? '?'}s de audio en `
        + `${(respuesta.msProceso / 1000).toFixed(1)}s). Revisala antes de guardar.`
      );
    } catch (err) {
      // El backend devuelve mensajes especificos: audio vacio, sin voz, corrupto.
      setError(err?.message || 'No se pudo transcribir el audio.');
    } finally {
      setTranscribiendo(false);
      setProgresoSubida(0);
    }
  };

  const cancelarGrabacion = () => {
    grabador.cancelar();
    setAviso('Grabacion descartada.');
  };

  /** Paso 5: guarda en la historia clinica. */
  const guardar = async () => {
    const limpio = texto.trim();
    if (!limpio) {
      setError('No hay texto para guardar.');
      return;
    }

    setError(null);
    setGuardando(true);
    try {
      await onTextoListo(limpio);
      setTexto('');          // recien ahora: si falla, el texto queda
      setAviso(null);
    } catch (err) {
      setError(err?.message || 'No se pudo guardar la evolucion. El texto sigue aca.');
    } finally {
      setGuardando(false);
    }
  };

  const descartarTexto = () => {
    if (!window.confirm('Descartar el texto?')) return;
    setTexto('');
    setError(null);
    setAviso(null);
  };

  const hayTexto = Boolean(texto.trim());
  const ocupado = deshabilitado || transcribiendo || guardando;
  const servicioCaido = estadoServicio && !estadoServicio.disponible;

  return (
    <div className="space-y-3">
      {/* --------------------------- Controles --------------------------- */}
      <div className="flex flex-wrap items-center gap-3">
        {!grabador.grabando ? (
          <button type="button" className="btn-primario"
            onClick={iniciarGrabacion}
            disabled={ocupado || !grabador.soportado || servicioCaido}>
            🎤 {hayTexto ? 'Dictar otro tramo' : 'Iniciar dictado'}
          </button>
        ) : (
          <>
            <button type="button" className="btn-peligro" onClick={detenerYTranscribir}>
              ⏹ Detener y transcribir
            </button>
            <button type="button" className="btn-secundario btn-sm" onClick={cancelarGrabacion}>
              Cancelar
            </button>
          </>
        )}

        {grabador.grabando && (
          <span className="flex items-center gap-2 text-sm font-medium text-rose-600">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-3 w-3 animate-ping rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-rose-500" />
            </span>
            Grabando {formatearTiempo(grabador.segundos)}
          </span>
        )}

        {transcribiendo && (
          <span className="flex items-center gap-2 text-sm font-medium text-marca-700">
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            {progresoSubida > 0 && progresoSubida < 100
              ? `Subiendo audio ${progresoSubida}%`
              : 'Transcribiendo...'}
          </span>
        )}
      </div>

      {/* ---------------------- Medidor de nivel ------------------------- */}
      {grabador.grabando && (
        <div className="space-y-1">
          <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className={`h-full transition-[width] duration-75 ${
                grabador.nivel > 0.05 ? 'bg-emerald-500' : 'bg-slate-300'
              }`}
              style={{ width: `${Math.round(grabador.nivel * 100)}%` }}
            />
          </div>
          <p className={`text-xs ${grabador.pico > 0.05 ? 'text-slate-500' : 'text-rose-600'}`}>
            {grabador.pico > 0.05
              ? 'El microfono esta captando tu voz.'
              : 'No se detecta sonido. Revisa el microfono antes de seguir.'}
            {' '}Maximo {formatearTiempo(grabador.maxSegundos)}.
          </p>
        </div>
      )}

      {/* ----------------------------- Avisos ---------------------------- */}
      {!grabador.soportado && (
        <Aviso tipo="alerta">
          Este navegador no permite grabar audio. Podes escribir la evolucion a mano.
        </Aviso>
      )}
      {servicioCaido && (
        <Aviso tipo="alerta">
          El servidor no tiene la transcripcion configurada. Podes escribir la evolucion a mano.
        </Aviso>
      )}
      {estadoServicio?.audioSaleDelServidor && (
        <Aviso tipo="info">
          El dictado se procesa con un servicio externo: el audio sale del servidor para
          transcribirse. No se guarda en ningun lado.
        </Aviso>
      )}
      {grabador.error && (
        <Aviso tipo="error" onCerrar={() => grabador.setError(null)}>{grabador.error}</Aviso>
      )}
      {error && <Aviso tipo="error" onCerrar={() => setError(null)}>{error}</Aviso>}
      {aviso && <Aviso tipo="exito" onCerrar={() => setAviso(null)}>{aviso}</Aviso>}

      {/* ----------------------------- Texto ----------------------------- */}
      <div>
        <label className="label" htmlFor="evolucion-texto">Evolucion</label>
        <textarea id="evolucion-texto" rows={6} className="input"
          value={texto}
          readOnly={transcribiendo}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Presiona Iniciar dictado y hablá, o escribi la evolucion a mano." />
        <p className="mt-1 text-xs text-slate-500">
          La transcripcion es un borrador: revisala antes de guardar. El audio se procesa
          en memoria y se descarta — no se guarda en el servidor ni en la base.
        </p>
      </div>

      {/* --------------------------- Acciones ---------------------------- */}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primario"
          disabled={ocupado || grabador.grabando || !hayTexto}
          onClick={guardar}>
          {guardando ? 'Guardando...' : 'Guardar evolucion'}
        </button>
        {hayTexto && !guardando && (
          <button type="button" className="btn-secundario" onClick={descartarTexto}>
            Descartar texto
          </button>
        )}
      </div>
    </div>
  );
}
