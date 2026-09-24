/**
 * pages/medico/MedicoAgendaDiaria.jsx
 * Agenda diaria del profesional con react-big-calendar.
 *
 * Muestra exclusivamente dias y turnos, con los intervalos diferenciados:
 *   - "Ocupado"    (azul)  -> turno reservado. Al hacer clic abre el modal.
 *   - "Disponible" (verde) -> slot libre de la plantilla. No es clickeable.
 *   - "Cancelado"  (gris)  -> turno cancelado, queda a la vista.
 *
 * Ademas permite cancelar la jornada: si el medico tiene mas de un
 * consultorio puede marcar a cuales no se presentara.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { es } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';

import { agendaApi } from '../../api/servicios';
import { Aviso, Cargando, Metrica, Modal, SinDatos } from '../../components/UI';
import ModalTurno from '../../components/ModalTurno';
import { fechaLarga, hora, hoyIso, sumarDias } from '../../utils/formato';

/** Localizador en espanol; la semana arranca el lunes, como el resto del sistema. */
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales: { es },
});

const MENSAJES = {
  date: 'Fecha', time: 'Hora', event: 'Turno', allDay: 'Todo el dia',
  week: 'Semana', day: 'Dia', month: 'Mes', previous: 'Anterior', next: 'Siguiente',
  today: 'Hoy', agenda: 'Lista', noEventsInRange: 'No hay turnos en este rango.',
  showMore: (total) => `+${total} mas`,
};

/** "2026-09-21T09:00:00" -> Date local, sin pasar por el parser de UTC. */
function aDateLocal(iso) {
  const [fecha, tiempo = '00:00:00'] = String(iso).split('T');
  const [a, m, d] = fecha.split('-').map(Number);
  const [hh, mm, ss] = tiempo.split(':').map(Number);
  return new Date(a, m - 1, d, hh || 0, mm || 0, ss || 0);
}

export default function MedicoAgendaDiaria() {
  const [fecha, setFecha] = useState(hoyIso());
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [procesando, setProcesando] = useState(false);

  // Modal del turno ocupado
  const [turnoAbierto, setTurnoAbierto] = useState(null);

  // Cancelacion de jornada
  const [modalCancelar, setModalCancelar] = useState(false);
  const [seleccionados, setSeleccionados] = useState([]);
  const [motivo, setMotivo] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setDatos(await agendaApi.dia({ fecha }));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setCargando(false);
    }
  }, [fecha]);

  useEffect(() => { cargar(); }, [cargar]);

  /** Intervalos -> eventos del calendario. */
  const eventos = useMemo(() => (datos?.intervalos || []).map((i) => ({
    id: i.key,
    title: i.tipo === 'ocupado'
      ? `${hora(i.horaInicio)} ${i.paciente.apellido}, ${i.paciente.nombre}`
      // Con orden de llegada, el backend marca cual de los huecos libres es
      // el que el paciente tiene habilitado ahora mismo. Los demas existen,
      // pero todavia no se ofrecen: decirlo evita que el medico crea que el
      // enlace esta roto al ver un solo turno del lado del paciente.
      : `${hora(i.horaInicio)} ${i.habilitado === false ? 'En fila' : 'Disponible'}`,
    start: aDateLocal(i.fechaHoraInicio),
    end: aDateLocal(i.fechaHoraFin),
    recurso: i,
  })), [datos]);

  /**
   * Color por tipo de intervalo. Es la diferenciacion visual pedida: ocupado,
   * disponible y cancelado se distinguen de un vistazo.
   */
  const estiloEvento = (evento) => {
    const i = evento.recurso;

    if (i.tipo === 'disponible') {
      // Libre pero todavia no ofrecido (orden de llegada, jornada lejos).
      if (i.habilitado === false) {
        return {
          style: {
            backgroundColor: '#f8fafc',          // slate-50
            border: '1px dashed #cbd5e1',
            color: '#94a3b8',
            fontSize: '0.75rem',
            cursor: 'default',
          },
        };
      }
      return {
        style: {
          backgroundColor: '#ecfdf5',            // emerald-50
          border: '1px dashed #6ee7b7',
          color: '#065f46',
          fontSize: '0.75rem',
          cursor: 'default',
        },
      };
    }
    if (i.estado === 'cancelado') {
      return {
        style: {
          backgroundColor: '#f1f5f9',            // slate-100
          border: '1px solid #cbd5e1',
          color: '#64748b',
          textDecoration: 'line-through',
          fontSize: '0.75rem',
        },
      };
    }
    // Ocupado. Si el paciente cancelo repetidamente, se marca en rojo
    // (coherente con la agenda semanal).
    const marcado = Number(i.cancelacionesPaciente) > 2;
    return {
      style: {
        backgroundColor: marcado ? '#fecdd3' : '#dbeafe',  // rose-200 / marca-100
        border: `1px solid ${marcado ? '#fb7185' : '#60a5fa'}`,
        color: marcado ? '#881337' : '#1e3a8a',
        fontSize: '0.75rem',
        cursor: 'pointer',
        fontWeight: 500,
      },
    };
  };

  /** Solo los ocupados abren el modal. */
  const alSeleccionar = (evento) => {
    const i = evento.recurso;
    if (i.tipo !== 'ocupado') return;
    setTurnoAbierto(i);
  };

  const abrirCancelar = () => {
    // Por defecto se proponen todos los consultorios que no esten ya bloqueados.
    setSeleccionados((datos?.consultorios || []).filter((c) => !c.bloqueado).map((c) => c.id));
    setMotivo('');
    setModalCancelar(true);
  };

  const cancelarJornada = async () => {
    setProcesando(true);
    setError(null);
    try {
      const { mensaje } = await agendaApi.cancelarDia({
        fecha,
        consultorioIds: seleccionados,
        motivo: motivo || null,
      });
      setAviso(mensaje);
      setModalCancelar(false);
      await cargar();
    } catch (err) {
      setError(err);
    } finally {
      setProcesando(false);
    }
  };

  const reactivarJornada = async () => {
    setProcesando(true);
    try {
      const { mensaje } = await agendaApi.reactivarDia({ fecha });
      setAviso(mensaje);
      await cargar();
    } catch (err) {
      setError(err);
    } finally {
      setProcesando(false);
    }
  };

  const alternarConsultorio = (id) => {
    setSeleccionados((prev) => (
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    ));
  };

  const consultorios = datos?.consultorios || [];
  const variosConsultorios = consultorios.length > 1;
  const hayBloqueados = consultorios.some((c) => c.bloqueado);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Agenda del dia</h1>
          <p className="text-sm capitalize text-slate-600">{fechaLarga(fecha)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {hayBloqueados ? (
            <button type="button" className="btn-exito" disabled={procesando}
              onClick={reactivarJornada}>
              Reactivar jornada
            </button>
          ) : (
            <button type="button" className="btn-peligro" disabled={procesando || !consultorios.length}
              onClick={abrirCancelar}>
              Cancelar el dia
            </button>
          )}
        </div>
      </header>

      {/* --------------------- Navegacion por dia ------------------------ */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-secundario btn-sm"
            onClick={() => setFecha(sumarDias(fecha, -1))}>&larr; Dia anterior</button>
          <button type="button" className="btn-secundario btn-sm"
            onClick={() => setFecha(hoyIso())}>Hoy</button>
          <button type="button" className="btn-secundario btn-sm"
            onClick={() => setFecha(sumarDias(fecha, 1))}>Dia siguiente &rarr;</button>
          <input type="date" className="input ml-auto sm:max-w-[180px]"
            value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
      </div>

      {aviso && <Aviso tipo="exito" onCerrar={() => setAviso(null)}>{aviso}</Aviso>}
      {error && (
        <Aviso tipo="error" detalles={error.detalles} onCerrar={() => setError(null)}>
          {error.message}
        </Aviso>
      )}

      {cargando ? (
        <Cargando texto="Cargando la agenda..." />
      ) : (
        <>
          {datos.resumen.diaBloqueado && (
            <Aviso tipo="alerta">
              La jornada esta cancelada en todos tus consultorios: no se ofrecen turnos nuevos
              para este dia.
            </Aviso>
          )}

          {datos.resumen.modoAgenda === 'orden_llegada'
            && datos.resumen.habilitados < datos.resumen.disponibles && (
            <Aviso tipo="info">
              Estas en <b>orden de llegada</b>: de los {datos.resumen.disponibles} horarios
              libres, el paciente ve {datos.resumen.habilitados} por ahora. Los demas se van
              habilitando a medida que se ocupan, y se muestran todos cuando falten menos
              de 6 horas para la jornada.
            </Aviso>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <Metrica titulo="Turnos ocupados" valor={datos.resumen.ocupados} icono="📘" />
            <Metrica titulo="Disponibles" valor={datos.resumen.disponibles} icono="🟢" color="verde" />
            <Metrica titulo="Cancelados" valor={datos.resumen.cancelados} icono="✖️" color="rojo" />
          </div>

          {/* --------------------------- Leyenda -------------------------- */}
          <div className="card flex flex-wrap items-center gap-4 py-3 text-xs">
            <span className="flex items-center gap-2">
              <span className="inline-block h-3 w-6 rounded border border-marca-400 bg-marca-100" />
              Ocupado (clic para abrir)
            </span>
            <span className="flex items-center gap-2">
              <span className="inline-block h-3 w-6 rounded border border-dashed border-emerald-300 bg-emerald-50" />
              Disponible
            </span>
            {datos?.resumen?.modoAgenda === 'orden_llegada' && (
              <span className="flex items-center gap-2">
                <span className="inline-block h-3 w-6 rounded border border-dashed border-slate-300 bg-slate-50" />
                Libre, pero todavia en fila
              </span>
            )}
            <span className="flex items-center gap-2">
              <span className="inline-block h-3 w-6 rounded border border-slate-300 bg-slate-100" />
              Cancelado
            </span>
            <span className="flex items-center gap-2">
              <span className="inline-block h-3 w-6 rounded border border-rose-400 bg-rose-200" />
              Paciente con cancelaciones reiteradas
            </span>
          </div>

          {/* ------------------------- Calendario ------------------------- */}
          {eventos.length === 0 ? (
            <SinDatos icono="📅" titulo="No hay actividad este dia"
              descripcion="No tenes horarios cargados para este dia de la semana, o la jornada esta cancelada." />
          ) : (
            <div className="card">
              <Calendar
                localizer={localizer}
                culture="es"
                messages={MENSAJES}
                events={eventos}
                defaultView="day"
                views={['day', 'agenda']}
                date={aDateLocal(`${fecha}T00:00:00`)}
                // La navegacion se maneja con los botones de arriba: el
                // calendario queda fijo en el dia elegido.
                onNavigate={(nuevaFecha) => setFecha(format(nuevaFecha, 'yyyy-MM-dd'))}
                step={15}
                timeslots={2}
                min={aDateLocal(`${fecha}T06:00:00`)}
                max={aDateLocal(`${fecha}T23:00:00`)}
                style={{ height: 620 }}
                eventPropGetter={estiloEvento}
                onSelectEvent={alSeleccionar}
                tooltipAccessor={(e) => {
                  if (e.recurso.tipo === 'ocupado') {
                    return `${e.recurso.paciente.apellido}, ${e.recurso.paciente.nombre} - ${e.recurso.consultorio}`;
                  }
                  return e.recurso.habilitado === false
                    ? `Libre, pero todavia no se ofrece (orden de llegada) - ${e.recurso.consultorio}`
                    : `Disponible - ${e.recurso.consultorio}`;
                }}
              />
            </div>
          )}
        </>
      )}

      {/* ------------------ Modal del turno ocupado ---------------------- */}
      <ModalTurno
        turno={turnoAbierto}
        abierto={Boolean(turnoAbierto)}
        onCerrar={() => setTurnoAbierto(null)}
        onCambio={cargar}
      />

      {/* ------------------ Cancelar la jornada -------------------------- */}
      <Modal abierto={modalCancelar} onCerrar={() => setModalCancelar(false)}
        titulo="Cancelar la jornada">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Se van a cancelar los turnos vigentes del <b className="capitalize">{fechaLarga(fecha)}</b>{' '}
            y ese dia dejara de ofrecer turnos nuevos.
          </p>

          {/* Con un solo consultorio no hay nada que elegir. */}
          {variosConsultorios ? (
            <div>
              <p className="label">A que consultorios no te presentaras?</p>
              <div className="space-y-2">
                {consultorios.map((c) => (
                  <label key={c.id}
                    className={`flex items-center gap-3 rounded-lg border p-3 text-sm ${
                      c.bloqueado
                        ? 'border-slate-200 bg-slate-50 opacity-60'
                        : 'cursor-pointer border-slate-200 hover:bg-slate-50'
                    }`}>
                    <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-marca-600"
                      checked={seleccionados.includes(c.id)}
                      disabled={c.bloqueado}
                      onChange={() => alternarConsultorio(c.id)} />
                    <span className="flex-1">
                      <span className="font-medium text-slate-900">{c.nombre}</span>
                      <span className="block text-xs text-slate-500">{c.localidad}</span>
                    </span>
                    {c.bloqueado && <span className="badge-gris">ya cancelado</span>}
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Desmarcá los consultorios en los que si vas a atender.
              </p>
            </div>
          ) : (
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <p className="font-medium text-slate-900">{consultorios[0]?.nombre}</p>
              <p className="text-xs text-slate-500">{consultorios[0]?.localidad}</p>
            </div>
          )}

          <div>
            <label className="label">Motivo (se informa a los pacientes)</label>
            <textarea rows={2} className="input" maxLength={255}
              value={motivo} onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: imprevisto personal" />
          </div>

          <Aviso tipo="alerta">
            Los turnos cancelados no se restauran si despues reactivas la jornada: los pacientes
            tendran que volver a reservar.
          </Aviso>

          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secundario" onClick={() => setModalCancelar(false)}>
              Volver
            </button>
            <button type="button" className="btn-peligro"
              disabled={procesando || seleccionados.length === 0}
              onClick={cancelarJornada}>
              {procesando ? 'Cancelando...' : 'Cancelar jornada'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
