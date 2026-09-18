/**
 * components/DictadoVoz.jsx
 * Dictado por voz para la historia clinica.
 *
 * ==========================================================================
 * RESTRICCION DE ARQUITECTURA
 * ==========================================================================
 * El audio NUNCA sale del navegador. El reconocimiento lo hace la Web Speech
 * API del propio navegador (ver hooks/useDictado.js) y este componente solo
 * maneja TEXTO:
 *   - no se instancia MediaRecorder ni se genera ningun Blob;
 *   - no hay FormData, ni multipart, ni subida de archivos;
 *   - el backend solo expone POST /pacientes/:id/historia con { texto }.
 *
 * ==========================================================================
 * Manejo del texto
 * ==========================================================================
 * El texto se ACUMULA: dictar dos veces suma, y lo escrito a mano no se pierde
 * al iniciar un dictado nuevo. Al guardar, el cuadro se limpia SOLO si el
 * backend confirmo: si falla, lo dictado sigue ahi para reintentar.
 */
import { useEffect, useState } from 'react';
import useDictado from '../hooks/useDictado';
import useNivelMicrofono from '../hooks/useNivelMicrofono';
import { Aviso } from './UI';

/**
 * @param {Object}   props
 * @param {Function} props.onTextoListo  async (texto) => void. Si rechaza, el
 *   texto NO se borra.
 * @param {boolean}  props.deshabilitado
 */
export default function DictadoVoz({ onTextoListo, deshabilitado = false }) {
  const {
    soportado, escuchando, texto, textoParcial, error, diagnostico,
    iniciar, detener, limpiar, reemplazarTexto, setError,
  } = useDictado({ idioma: 'es-AR' });

  const medidor = useNivelMicrofono();

  const [guardando, setGuardando] = useState(false);
  const [errorGuardado, setErrorGuardado] = useState(null);
  const [verDiagnostico, setVerDiagnostico] = useState(false);

  // El medidor y el dictado no pueden competir por el microfono.
  useEffect(() => {
    if (escuchando && medidor.midiendo) medidor.detener();
  }, [escuchando, medidor]);

  // Al cerrar el diagnostico se libera el microfono del medidor.
  useEffect(() => {
    if (!verDiagnostico && medidor.midiendo) medidor.detener();
  }, [verDiagnostico, medidor]);

  // Si el navegador no soporta dictado se avisa una sola vez, sin bloquear la
  // carga manual.
  useEffect(() => {
    if (!soportado) setVerDiagnostico(false);
  }, [soportado]);

  const guardar = async () => {
    const limpio = (texto || '').trim();
    if (!limpio) {
      setErrorGuardado('No hay texto para guardar. Dicta algo o escribilo a mano.');
      return;
    }

    if (escuchando) detener();
    setErrorGuardado(null);
    setGuardando(true);

    try {
      await onTextoListo(limpio);
      limpiar();   // recien ahora: si fallaba, el texto tenia que quedar
    } catch (err) {
      setErrorGuardado(err?.message || 'No se pudo guardar la evolucion. El texto sigue aca.');
    } finally {
      setGuardando(false);
    }
  };

  const descartar = () => {
    if (!window.confirm('Descartar el texto?')) return;
    detener();
    limpiar();
    setErrorGuardado(null);
  };

  const hayTexto = Boolean((texto || '').trim());
  // Chrome repitiendo no-speech = capturo audio pero no escucho ninguna voz.
  const hayNoSpeech = diagnostico.eventos.some((e) => e.includes('no-speech'));

  return (
    <div className="space-y-3">
      {/* --------------------------- Controles --------------------------- */}
      <div className="flex flex-wrap items-center gap-3">
        {!escuchando ? (
          <button type="button" className="btn-primario" onClick={iniciar}
            disabled={deshabilitado || guardando || !soportado}>
            🎤 {hayTexto ? 'Seguir dictando' : 'Iniciar dictado'}
          </button>
        ) : (
          <button type="button" className="btn-peligro" onClick={detener}>
            ⏹ Detener
          </button>
        )}

        {escuchando && (
          <span className="flex items-center gap-2 text-sm font-medium text-rose-600">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-3 w-3 animate-ping rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-rose-500" />
            </span>
            Escuchando...
          </span>
        )}

        {/* Feedback inmediato de que la voz se esta reconociendo. */}
        {escuchando && textoParcial && (
          <span className="truncate text-xs italic text-slate-500">
            &ldquo;{textoParcial}&rdquo;
          </span>
        )}
      </div>

      {!soportado && (
        <Aviso tipo="alerta">
          Este navegador no soporta dictado por voz (funciona en Chrome, Edge y Safari).
          Podes escribir la evolucion a mano.
        </Aviso>
      )}
      {error && <Aviso tipo="error" onCerrar={() => setError(null)}>{error}</Aviso>}
      {errorGuardado && (
        <Aviso tipo="error" onCerrar={() => setErrorGuardado(null)}>{errorGuardado}</Aviso>
      )}

      {/* --------------------------- Texto ------------------------------- */}
      <div>
        <label className="label" htmlFor="evolucion-texto">
          Evolucion
          {escuchando && (
            <span className="ml-2 text-xs font-normal text-slate-500">
              (se completa mientras dictas)
            </span>
          )}
        </label>
        <textarea id="evolucion-texto" rows={6} className="input"
          value={texto}
          // Mientras el microfono esta activo el cuadro es de solo lectura: lo
          // que llegue despues pisaria las correcciones.
          readOnly={escuchando}
          onChange={(e) => reemplazarTexto(e.target.value)}
          placeholder="Presiona Iniciar dictado y hablá, o escribi la evolucion a mano." />
        <p className="mt-1 text-xs text-slate-500">
          {escuchando
            ? 'Detene el dictado para poder corregir el texto.'
            : 'Podes corregir el texto antes de guardarlo. Volver a dictar suma al final.'}
          {' '}La transcripcion se hace en tu navegador: el audio no se envia ni se guarda.
        </p>
      </div>

      {/* --------------------------- Acciones ---------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primario"
          disabled={deshabilitado || guardando || !hayTexto}
          onClick={guardar}>
          {guardando ? 'Guardando...' : 'Guardar evolucion'}
        </button>
        {hayTexto && !guardando && (
          <button type="button" className="btn-secundario" onClick={descartar}>
            Descartar
          </button>
        )}

        {soportado && (
          <button type="button"
            className="ml-auto text-xs text-slate-400 underline hover:text-slate-600"
            onClick={() => setVerDiagnostico((v) => !v)}>
            {verDiagnostico ? 'Ocultar diagnostico' : 'Diagnostico'}
          </button>
        )}
      </div>

      {/*
        Panel de diagnostico: muestra la secuencia de eventos que emitio el
        navegador. Si el microfono se enciende pero no aparece texto, aca se ve
        donde se corta (por ejemplo `start audio voz end` sin ningun `texto`).
      */}
      {verDiagnostico && (
        <div className="space-y-3">
          <div className="rounded-lg bg-slate-900 p-3 font-mono text-xs text-slate-200">
            <p className="mb-1 text-slate-400">Diagnostico del reconocimiento</p>
            <p>soporte nativo: {String(soportado)}</p>
            <p>escuchando: {String(escuchando)}</p>
            <p>resultados recibidos: {diagnostico.resultados}</p>
            <p>caracteres en el cuadro: {(texto || '').length}</p>
            <p className="mt-1 break-all">
              eventos: {diagnostico.eventos.length ? diagnostico.eventos.join(' → ') : '(ninguno)'}
            </p>

            {/* Lectura automatica del sintoma mas frecuente. */}
            {hayNoSpeech && (
              <p className="mt-2 rounded bg-amber-500/20 p-2 text-amber-200">
                Chrome respondio <b>no-speech</b>: el servicio funciona pero no escucho ninguna voz.
                Casi siempre significa que esta capturando de un microfono equivocado o silenciado.
                Probalo con el medidor de abajo.
              </p>
            )}
          </div>

          {/* ------------------- Medidor de entrada ---------------------- */}
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">Probar el microfono</p>
                <p className="text-xs text-slate-500">
                  Mide si llega sonido. No graba nada: solo lee el volumen instantaneo.
                </p>
              </div>
              {!medidor.midiendo ? (
                <button type="button" className="btn-secundario btn-sm"
                  onClick={medidor.iniciar} disabled={escuchando}>
                  Probar microfono
                </button>
              ) : (
                <button type="button" className="btn-secundario btn-sm" onClick={medidor.detener}>
                  Detener prueba
                </button>
              )}
            </div>

            {escuchando && (
              <p className="mt-2 text-xs text-amber-600">
                Detene el dictado para poder probar el microfono: no pueden usarlo los dos a la vez.
              </p>
            )}

            {medidor.error && (
              <div className="mt-2"><Aviso tipo="error">{medidor.error}</Aviso></div>
            )}

            {medidor.midiendo && (
              <div className="mt-3 space-y-2">
                <p className="text-xs font-medium text-slate-700">Hablá ahora. La barra deberia moverse:</p>
                <div className="h-5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full transition-[width] duration-75 ${
                      medidor.nivel > 0.05 ? 'bg-emerald-500' : 'bg-slate-300'
                    }`}
                    style={{ width: `${Math.round(medidor.nivel * 100)}%` }}
                  />
                </div>

                <p className={`text-sm font-medium ${
                  medidor.pico > 0.05 ? 'text-emerald-700' : 'text-rose-700'
                }`}>
                  {medidor.pico > 0.05
                    ? `Llega sonido (pico ${Math.round(medidor.pico * 100)}%). El microfono funciona.`
                    : 'No llega ningun sonido. La barra esta en cero.'}
                </p>

                {medidor.dispositivos.length > 0 && (
                  <div className="text-xs text-slate-600">
                    <p className="font-medium">Microfonos detectados:</p>
                    <ul className="mt-1 list-inside list-disc">
                      {medidor.dispositivos.map((d) => (
                        <li key={d.id}>
                          {d.nombre}{d.enUso ? ' — en uso ahora' : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Que hacer segun el resultado. */}
            {medidor.midiendo && medidor.pico <= 0.05 && (
              <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                <p className="font-semibold">Si la barra no se mueve al hablar:</p>
                <ol className="mt-1 list-inside list-decimal space-y-1">
                  <li>
                    Windows: click derecho en el icono de volumen &rarr; <b>Configuracion de sonido</b> &rarr;
                    <b> Entrada</b>. Elegi el microfono correcto y subi el volumen.
                  </li>
                  <li>Revisa que el microfono no tenga el mute fisico activado.</li>
                  <li>Cerra cualquier programa que pueda estar usandolo (Teams, Zoom, Meet).</li>
                  <li>
                    En Chrome: <b>chrome://settings/content/microphone</b>, verifica el dispositivo
                    predeterminado.
                  </li>
                </ol>
                <p className="mt-2">
                  El dictado usa <b>siempre</b> el microfono predeterminado del sistema: no se puede
                  elegir otro desde la pagina.
                </p>
              </div>
            )}

            {medidor.midiendo && medidor.pico > 0.05 && (
              <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-900">
                El microfono capta sonido correctamente. Detene la prueba y volve a intentar el
                dictado: hablá fuerte y claro, cerca del microfono, y esperá un par de segundos
                antes de presionar Detener.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
