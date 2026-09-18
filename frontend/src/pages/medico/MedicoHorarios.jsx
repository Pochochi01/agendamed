/**
 * pages/medico/MedicoHorarios.jsx
 * CRUD de la plantilla semanal de atencion.
 *
 * La validacion de superposicion entre consultorios vive en el backend; aca
 * se muestra el mensaje de conflicto que devuelve la API.
 */
import { useCallback, useEffect, useState } from 'react';
import { horariosApi, consultoriosApi, medicosApi } from '../../api/servicios';
import { Aviso, Cargando, Campo, Modal, SinDatos } from '../../components/UI';
import { DIAS_SEMANA, hora } from '../../utils/formato';

const FORM_INICIAL = { consultorioId: '', diaSemana: 1, horaInicio: '09:00', horaFin: '13:00' };

/** Los cuadros de duracion arrancan siempre en 0, como pide el formulario. */
const DURACION_INICIAL = { horas: '0', minutos: '0' };

/**
 * Rango admitido por cada cuadro. Se aplica al tipear (ver alCambiarDuracion)
 * y se repite en el backend (validators/index.js) y en el CHECK de la tabla.
 */
const LIMITES = {
  horas:   { min: 0, max: 4,  etiqueta: 'El campo Horas' },
  minutos: { min: 0, max: 60, etiqueta: 'El campo Minutos' },
};

/** 90 -> "1 h 30 min" | 20 -> "20 min" | 120 -> "2 h" */
function formatearDuracion(minutosTotales) {
  const h = Math.floor(minutosTotales / 60);
  const m = minutosTotales % 60;
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  return `${m} min`;
}

export default function MedicoHorarios() {
  const [porDia, setPorDia] = useState({});
  const [consultorios, setConsultorios] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);

  const [modalAbierto, setModalAbierto] = useState(false);
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState(FORM_INICIAL);
  const [guardando, setGuardando] = useState(false);

  // --- Duracion del turno (seccion propia, arriba de la plantilla) ---
  const [duracion, setDuracion] = useState(DURACION_INICIAL);
  const [duracionActual, setDuracionActual] = useState(null); // minutos guardados
  const [errorDuracion, setErrorDuracion] = useState(null);
  // Aviso breve cuando se rechaza una tecla por salirse del rango del cuadro.
  const [rechazo, setRechazo] = useState(null);
  const [guardandoDuracion, setGuardandoDuracion] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [datos, listaConsultorios, perfil] = await Promise.all([
        horariosApi.listar(),
        consultoriosApi.listar({ activos: 'true' }),
        medicosApi.miPerfil(),
      ]);
      setPorDia(datos.porDia);
      setConsultorios(listaConsultorios);
      setDuracionActual(Number(perfil.medico.duracion_turno_min));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  /**
   * Control de lo que se puede tipear en cada cuadro.
   *
   * Se valida en el propio ingreso, tecla por tecla:
   *   - se descartan los caracteres que no son digitos (letras, signos, puntos);
   *   - si el numero resultante se pasa del limite del campo, la tecla se
   *     rechaza y el cuadro conserva el valor anterior (no se recorta a la
   *     fuerza: escribir "7" en Horas no debe convertirse en un silencioso 4);
   *   - se normalizan los ceros a la izquierda ("020" queda en "20").
   *
   * El campo vacio se permite mientras se edita y cuenta como 0 al guardar.
   */
  const alCambiarDuracion = (campo) => (e) => {
    const soloDigitos = e.target.value.replace(/\D/g, '');

    if (soloDigitos === '') {
      setRechazo(null);
      setDuracion({ ...duracion, [campo]: '' });
      return;
    }

    const valor = Number(soloDigitos);

    if (valor > LIMITES[campo].max) {
      setRechazo(
        `${LIMITES[campo].etiqueta} solo admite valores de ${LIMITES[campo].min} a ${LIMITES[campo].max}.`
      );
      return; // se descarta el cambio: el cuadro queda como estaba
    }

    setRechazo(null);
    setDuracion({ ...duracion, [campo]: String(valor) });
  };

  const guardarDuracion = async (e) => {
    e.preventDefault();
    setErrorDuracion(null);
    setRechazo(null);

    const horas = Number(duracion.horas || 0);
    const minutos = Number(duracion.minutos || 0);
    const total = horas * 60 + minutos;

    // Validacion en el cliente para dar la respuesta al instante; el backend
    // vuelve a validar lo mismo (5 min a 4 h, igual que el CHECK de la tabla).
    if (total === 0) {
      setErrorDuracion('Cargá cuánto dura el turno. Por ejemplo: 0 horas y 20 minutos.');
      return;
    }
    // Red de seguridad: alCambiarDuracion ya impide tipear fuera de rango,
    // pero el valor podria llegar por autocompletado o pegado del navegador.
    if (horas > LIMITES.horas.max) {
      setErrorDuracion(`Las horas van de ${LIMITES.horas.min} a ${LIMITES.horas.max}.`);
      return;
    }
    if (minutos > LIMITES.minutos.max) {
      setErrorDuracion(`Los minutos van de ${LIMITES.minutos.min} a ${LIMITES.minutos.max}.`);
      return;
    }
    if (total < 5) {
      setErrorDuracion('La duración mínima del turno es de 5 minutos.');
      return;
    }
    if (total > 240) {
      setErrorDuracion('La duración máxima del turno es de 4 horas.');
      return;
    }

    setGuardandoDuracion(true);
    try {
      const respuesta = await medicosApi.actualizarDuracionTurno({ horas, minutos });
      setDuracionActual(respuesta.duracionTurnoMin);
      setDuracion(DURACION_INICIAL); // vuelven a 0 tras guardar
      setAviso(respuesta.mensaje);
    } catch (err) {
      setErrorDuracion(err.message);
    } finally {
      setGuardandoDuracion(false);
    }
  };

  const abrirNuevo = (diaSemana = 1) => {
    setEditando(null);
    setForm({ ...FORM_INICIAL, diaSemana, consultorioId: consultorios[0]?.id || '' });
    setError(null);
    setModalAbierto(true);
  };

  const abrirEdicion = (h) => {
    setEditando(h);
    setForm({
      consultorioId: h.consultorio_id,
      diaSemana: h.dia_semana,
      horaInicio: hora(h.hora_inicio),
      horaFin: hora(h.hora_fin),
    });
    setError(null);
    setModalAbierto(true);
  };

  const guardar = async (e) => {
    e.preventDefault();
    setError(null);
    setGuardando(true);

    const datos = {
      consultorioId: Number(form.consultorioId),
      diaSemana: Number(form.diaSemana),
      horaInicio: form.horaInicio,
      horaFin: form.horaFin,
    };

    try {
      const { mensaje } = editando
        ? await horariosApi.actualizar(editando.id, datos)
        : await horariosApi.crear(datos);
      setAviso(mensaje);
      setModalAbierto(false);
      await cargar();
    } catch (err) {
      setError(err); // incluye el detalle del conflicto de superposicion
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = async (h) => {
    if (!window.confirm(`Eliminar el bloque de ${hora(h.hora_inicio)} a ${hora(h.hora_fin)}?`)) return;
    try {
      const respuesta = await horariosApi.eliminar(h.id);
      setAviso(respuesta.advertencia || respuesta.mensaje);
      await cargar();
    } catch (err) {
      setError(err);
    }
  };

  if (cargando) return <Cargando texto="Cargando horarios..." />;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Horarios de atencion</h1>
          <p className="text-sm text-slate-600">
            Plantilla semanal. Los turnos disponibles se generan a partir de estos bloques.
          </p>
        </div>
        <button type="button" className="btn-primario" disabled={consultorios.length === 0}
          onClick={() => abrirNuevo()}>
          + Nuevo bloque
        </button>
      </header>

      {consultorios.length === 0 && (
        <Aviso tipo="alerta">
          Primero cargá al menos un consultorio activo: los horarios se asignan a un consultorio.
        </Aviso>
      )}

      {aviso && <Aviso tipo="exito" onCerrar={() => setAviso(null)}>{aviso}</Aviso>}
      {error && !modalAbierto && (
        <Aviso tipo="error" detalles={error.detalles} onCerrar={() => setError(null)}>{error.message}</Aviso>
      )}

      {/* =================== Duracion de los turnos ======================= */}
      <section className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Duracion de los turnos</h2>
            <p className="text-sm text-slate-600">
              Define cada cuanto se corta la agenda. Cada bloque horario se divide
              en turnos de esta duracion.
            </p>
          </div>
          {duracionActual !== null && (
            <div className="rounded-lg bg-marca-50 px-3 py-2 text-right ring-1 ring-inset ring-marca-200">
              <p className="text-[11px] font-medium uppercase tracking-wide text-marca-700">
                Configuracion actual
              </p>
              <p className="text-lg font-bold text-marca-800">{formatearDuracion(duracionActual)}</p>
            </div>
          )}
        </div>

        {/* ---------------------- Ejemplo de carga ---------------------- */}
        <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Como cargarlo
          </p>
          <p className="mt-1 text-sm text-slate-700">
            Escribi las horas en el primer cuadro y los minutos en el segundo.
          </p>
          <p className="mt-2 text-sm text-slate-700">
            <b>Ejemplo:</b> para turnos de 20 minutos, cargá{' '}
            <span className="rounded bg-white px-1.5 py-0.5 font-mono font-semibold text-marca-700 ring-1 ring-slate-300">0</span>
            {' '}en <b>Horas</b> y{' '}
            <span className="rounded bg-white px-1.5 py-0.5 font-mono font-semibold text-marca-700 ring-1 ring-slate-300">20</span>
            {' '}en <b>Minutos</b>.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Si el turno dura una hora y media: 1 en Horas y 30 en Minutos.
          </p>
        </div>

        <form onSubmit={guardarDuracion} className="mt-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-24">
              <label htmlFor="duracion-horas" className="label">Horas</label>
              <input id="duracion-horas" type="text" inputMode="numeric" className="input text-center"
                value={duracion.horas} onChange={alCambiarDuracion('horas')}
                maxLength={1} placeholder="0"
                aria-describedby="duracion-ayuda"
                aria-valuemin={LIMITES.horas.min} aria-valuemax={LIMITES.horas.max} />
              <p className="mt-1 text-center text-[11px] text-slate-400">
                {LIMITES.horas.min} a {LIMITES.horas.max}
              </p>
            </div>

            <span className="pb-7 text-lg font-semibold text-slate-400">:</span>

            <div className="w-24">
              <label htmlFor="duracion-minutos" className="label">Minutos</label>
              <input id="duracion-minutos" type="text" inputMode="numeric" className="input text-center"
                value={duracion.minutos} onChange={alCambiarDuracion('minutos')}
                maxLength={2} placeholder="20"
                aria-describedby="duracion-ayuda"
                aria-valuemin={LIMITES.minutos.min} aria-valuemax={LIMITES.minutos.max} />
              <p className="mt-1 text-center text-[11px] text-slate-400">
                {LIMITES.minutos.min} a {LIMITES.minutos.max}
              </p>
            </div>

            <button type="submit" className="btn-primario mb-6" disabled={guardandoDuracion}>
              {guardandoDuracion ? 'Guardando...' : 'Guardar duracion'}
            </button>
          </div>

          {/* Aviso inmediato cuando se rechaza una tecla fuera de rango. */}
          {rechazo && (
            <p className="mt-1 text-xs font-medium text-amber-600" role="status">
              {rechazo}
            </p>
          )}

          <p id="duracion-ayuda" className="mt-2 text-xs text-slate-500">
            Horas: de {LIMITES.horas.min} a {LIMITES.horas.max}.
            Minutos: de {LIMITES.minutos.min} a {LIMITES.minutos.max}.
            El turno debe durar entre 5 minutos y 4 horas en total.
          </p>

          {errorDuracion && (
            <div className="mt-3">
              <Aviso tipo="error" onCerrar={() => setErrorDuracion(null)}>{errorDuracion}</Aviso>
            </div>
          )}
        </form>

        <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
          El cambio se aplica a los turnos que se reserven de ahora en mas. Los turnos
          ya agendados mantienen la duracion con la que fueron tomados.
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4, 5, 6, 7].map((dia) => {
          const bloques = porDia[dia] || [];
          return (
            <div key={dia} className="card">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">{DIAS_SEMANA[dia]}</h3>
                <button type="button" onClick={() => abrirNuevo(dia)}
                  className="text-xs font-medium text-marca-600 hover:text-marca-700"
                  disabled={consultorios.length === 0}>
                  + Agregar
                </button>
              </div>

              {bloques.length === 0 ? (
                <p className="py-4 text-center text-xs text-slate-400">Sin atencion</p>
              ) : (
                <ul className="space-y-2">
                  {bloques.map((h) => (
                    <li key={h.id}
                      className={`rounded-lg border p-2.5 text-sm ${
                        h.activo ? 'border-slate-200' : 'border-dashed border-slate-300 opacity-60'
                      }`}>
                      <p className="font-semibold text-slate-900">
                        {hora(h.hora_inicio)} - {hora(h.hora_fin)}
                      </p>
                      <p className="truncate text-xs text-slate-500">{h.consultorio}</p>
                      <p className="truncate text-xs text-slate-400">{h.localidad}</p>
                      <div className="mt-2 flex gap-2">
                        <button type="button" onClick={() => abrirEdicion(h)}
                          className="text-xs font-medium text-marca-600 hover:underline">Editar</button>
                        <button type="button" onClick={() => eliminar(h)}
                          className="text-xs font-medium text-rose-600 hover:underline">Eliminar</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {Object.values(porDia).every((b) => !b || b.length === 0) && consultorios.length > 0 && (
        <SinDatos icono="⏰" titulo="Todavia no cargaste horarios"
          descripcion="Defini en que dias y franjas atendes en cada consultorio."
          accion={<button type="button" className="btn-primario" onClick={() => abrirNuevo()}>Cargar el primero</button>} />
      )}

      {/* ---------------------------- Formulario -------------------------- */}
      <Modal abierto={modalAbierto} onCerrar={() => setModalAbierto(false)}
        titulo={editando ? 'Editar bloque horario' : 'Nuevo bloque horario'}>
        <form onSubmit={guardar} className="space-y-4">
          {error && (
            <Aviso tipo="error" detalles={error.detalles} onCerrar={() => setError(null)}>
              {error.message}
            </Aviso>
          )}

          <Campo label="Consultorio" requerido>
            <select className="input" value={form.consultorioId} required
              onChange={(e) => setForm({ ...form, consultorioId: e.target.value })}>
              <option value="">Seleccionar...</option>
              {consultorios.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre} - {c.localidad}</option>
              ))}
            </select>
          </Campo>

          <Campo label="Dia de la semana" requerido>
            <select className="input" value={form.diaSemana}
              onChange={(e) => setForm({ ...form, diaSemana: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <option key={d} value={d}>{DIAS_SEMANA[d]}</option>
              ))}
            </select>
          </Campo>

          <div className="grid grid-cols-2 gap-4">
            <Campo label="Desde" requerido>
              <input type="time" className="input" value={form.horaInicio} required
                onChange={(e) => setForm({ ...form, horaInicio: e.target.value })} />
            </Campo>
            <Campo label="Hasta" requerido>
              <input type="time" className="input" value={form.horaFin} required
                onChange={(e) => setForm({ ...form, horaFin: e.target.value })} />
            </Campo>
          </div>

          <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
            No podes tener dos bloques superpuestos el mismo dia, ni siquiera en consultorios
            distintos: el sistema lo valida antes de guardar.
          </p>

          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secundario" onClick={() => setModalAbierto(false)}>
              Cancelar
            </button>
            <button type="submit" className="btn-primario" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
