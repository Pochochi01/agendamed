/**
 * pages/medico/MedicoAgenda.jsx
 * Agenda semanal del profesional: navegacion por semana, turnos agrupados por
 * dia, cambio de estado y cancelacion con motivo.
 */
import { useCallback, useEffect, useState } from 'react';
import { turnosApi, medicosApi } from '../../api/servicios';
import { Aviso, Cargando, Metrica, Modal, SinDatos } from '../../components/UI';
import {
  DIAS_CORTOS, diaSemanaDeFecha, fechaCorta, fechaLarga, hora, hoyIso,
  lunesDeLaSemana, moneda, sumarDias, estiloEstadoTurno,
} from '../../utils/formato';

export default function MedicoAgenda() {
  const [lunes, setLunes] = useState(() => lunesDeLaSemana(hoyIso()));
  const [turnos, setTurnos] = useState([]);
  // A partir de cuantas cancelaciones previas se marca al paciente. Lo define
  // el backend (CANCELACIONES_ALERTA); es "mas de N".
  const [umbral, setUmbral] = useState(2);
  const [historial, setHistorial] = useState(null); // registro de un paciente
  const [estadisticas, setEstadisticas] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [aCancelar, setACancelar] = useState(null);
  const [motivo, setMotivo] = useState('');
  const [procesando, setProcesando] = useState(false);

  const domingo = sumarDias(lunes, 6);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [datos, stats] = await Promise.all([
        turnosApi.agenda({ desde: lunes, hasta: sumarDias(lunes, 6) }),
        medicosApi.misEstadisticas(),
      ]);
      setTurnos(datos.turnos);
      setUmbral(datos.umbralCancelaciones ?? 2);
      setEstadisticas(stats);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setCargando(false);
    }
  }, [lunes]);

  useEffect(() => { cargar(); }, [cargar]);

  const cancelar = async () => {
    setProcesando(true);
    try {
      await turnosApi.cancelar(aCancelar.id, motivo);
      setAviso('Turno cancelado. El horario vuelve a quedar disponible.');
      setACancelar(null);
      setMotivo('');
      await cargar();
    } catch (err) {
      setError(err);
    } finally {
      setProcesando(false);
    }
  };

  const cambiarEstado = async (turno, estado) => {
    try {
      await turnosApi.cambiarEstado(turno.id, estado);
      await cargar();
    } catch (err) {
      setError(err);
    }
  };

  /** Abre el detalle de cancelaciones del paciente (fechas y antelacion). */
  const verHistorial = async (turno) => {
    try {
      setHistorial({ cargando: true, turno });
      const datos = await turnosApi.cancelacionesDePaciente(turno.paciente_id);
      setHistorial({ ...datos, turno });
    } catch (err) {
      setError(err);
      setHistorial(null);
    }
  };

  /**
   * Un paciente queda marcado cuando cancelo mas veces que el umbral.
   * Los turnos ya cancelados no se marcan: la alerta sirve para los que
   * siguen en pie, que son los que el medico puede decidir sostener o no.
   */
  const estaMarcado = (turno) => Number(turno.cancelaciones_paciente) > umbral
    && turno.estado !== 'cancelado';

  // Turnos agrupados por fecha para pintar las 7 columnas de la semana.
  const dias = Array.from({ length: 7 }, (_, i) => {
    const fecha = sumarDias(lunes, i);
    return { fecha, turnos: turnos.filter((t) => t.fecha.slice(0, 10) === fecha) };
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Mi agenda</h1>
        <p className="text-sm text-slate-600">Turnos de la semana y su estado.</p>
      </header>

      {estadisticas && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metrica titulo="Turnos hoy" valor={estadisticas.turnos_hoy} icono="📅" />
          <Metrica titulo="Proximos 7 dias" valor={estadisticas.turnos_semana} icono="🗓️" />
          <Metrica titulo="Cancelados (30d)" valor={estadisticas.cancelados_mes} icono="✖️" color="rojo" />
          <Metrica titulo="Cobrado (30d)" valor={moneda(estadisticas.recaudado_mes)} icono="💰" color="verde" />
        </div>
      )}

      {aviso && <Aviso tipo="exito" onCerrar={() => setAviso(null)}>{aviso}</Aviso>}
      {error && <Aviso tipo="error" onCerrar={() => setError(null)}>{error.message}</Aviso>}

      {/* --------------------- Navegacion de la semana -------------------- */}
      <div className="card">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button type="button" className="btn-secundario btn-sm"
              onClick={() => setLunes(sumarDias(lunes, -7))}>&larr; Anterior</button>
            <button type="button" className="btn-secundario btn-sm"
              onClick={() => setLunes(lunesDeLaSemana(hoyIso()))}>Hoy</button>
            <button type="button" className="btn-secundario btn-sm"
              onClick={() => setLunes(sumarDias(lunes, 7))}>Siguiente &rarr;</button>
          </div>
          <p className="text-sm font-medium text-slate-700">
            {fechaLarga(lunes)} al {fechaLarga(domingo)}
          </p>
        </div>

        {cargando ? (
          <Cargando />
        ) : (
          <div className="grid gap-3 lg:grid-cols-7">
            {dias.map(({ fecha, turnos: delDia }) => {
              const esHoy = fecha === hoyIso();
              return (
                <div key={fecha}
                  className={`rounded-lg border p-2 ${esHoy ? 'border-marca-300 bg-marca-50/40' : 'border-slate-200'}`}>
                  <div className="mb-2 border-b border-slate-200 pb-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {DIAS_CORTOS[diaSemanaDeFecha(fecha)]}
                    </p>
                    <p className={`text-lg font-bold ${esHoy ? 'text-marca-700' : 'text-slate-800'}`}>
                      {fecha.slice(8, 10)}
                    </p>
                  </div>

                  {delDia.length === 0 ? (
                    <p className="py-3 text-center text-xs text-slate-400">Sin turnos</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {delDia.map((t) => {
                        const estilo = estiloEstadoTurno(t.estado);
                        const marcado = estaMarcado(t);

                        // Fondo rojo translucido (10% de opacidad) + borde: se
                        // distingue de un vistazo sin tapar el texto, que
                        // mantiene el contraste sobre blanco.
                        const fondo = t.estado === 'cancelado'
                          ? 'border-slate-200 bg-slate-50 opacity-60'
                          : marcado
                            ? 'border-rose-300 bg-rose-500/10'
                            : 'border-slate-200 bg-white';

                        return (
                          <li key={t.id} className={`rounded-md border p-2 text-xs ${fondo}`}>
                            <p className="font-semibold text-slate-900">{hora(t.hora_inicio)}</p>
                            <p className="truncate text-slate-700">
                              {t.paciente_apellido}, {t.paciente_nombre}
                            </p>
                            <p className="truncate text-slate-400">{t.consultorio}</p>

                            {marcado && (
                              <button type="button" onClick={() => verHistorial(t)}
                                className="mt-1 flex w-full items-center gap-1 rounded bg-rose-100 px-1.5 py-1 text-left font-semibold text-rose-800 hover:bg-rose-200"
                                title="Ver el registro de cancelaciones de este paciente">
                                <span>⚠</span>
                                <span className="truncate">
                                  {t.cancelaciones_paciente} cancelaciones
                                </span>
                              </button>
                            )}

                            <span className={`${estilo.clase} mt-1`}>{estilo.texto}</span>

                            {/* Con el paciente marcado, el telefono a mano para
                                poder llamarlo sin salir de la agenda. */}
                            {marcado && t.paciente_telefono && (
                              <a href={`tel:${t.paciente_telefono}`}
                                className="mt-1 block truncate text-[11px] font-medium text-rose-700 hover:underline">
                                📞 {t.paciente_telefono}
                              </a>
                            )}

                            {t.estado !== 'cancelado' && t.estado !== 'completado' && (
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                <button type="button" className="text-[11px] font-medium text-emerald-600 hover:underline"
                                  onClick={() => cambiarEstado(t, 'completado')}>Atendido</button>
                                <button type="button" className="text-[11px] font-medium text-amber-600 hover:underline"
                                  onClick={() => cambiarEstado(t, 'ausente')}>Ausente</button>
                                <button type="button" className="text-[11px] font-medium text-rose-600 hover:underline"
                                  onClick={() => { setACancelar(t); setMotivo(''); }}>Cancelar</button>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ------------------------ Listado detallado ----------------------- */}
      {/* Leyenda: se muestra solo si hay algun turno marcado en la semana. */}
      {turnos.some(estaMarcado) && (
        <div className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-500/10 p-3">
          <span className="text-lg">⚠</span>
          <p className="text-sm text-slate-700">
            Los turnos con <b>fondo rojo</b> son de pacientes que cancelaron mas de {umbral} veces
            con vos. Tocá el contador para ver fechas y antelacion, y decidi si mantenes el turno
            o te comunicas con el paciente.
          </p>
        </div>
      )}

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Detalle de la semana</h2>
        {turnos.length === 0 ? (
          <SinDatos icono="🗓️" titulo="Sin turnos esta semana"
            descripcion="Los turnos que reserven tus pacientes van a aparecer aca." />
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Fecha y hora</th>
                  <th>Paciente</th>
                  <th>Contacto</th>
                  <th>Consultorio</th>
                  <th>Pagado</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {turnos.map((t) => {
                  const estilo = estiloEstadoTurno(t.estado);
                  const marcado = estaMarcado(t);
                  return (
                    <tr key={t.id}
                      className={marcado ? 'bg-rose-500/10 hover:bg-rose-500/20' : 'hover:bg-slate-50'}>
                      <td className="whitespace-nowrap">
                        <p className="font-medium text-slate-900">{hora(t.hora_inicio)} - {hora(t.hora_fin)}</p>
                        <p className="text-xs text-slate-500">{fechaLarga(t.fecha)}</p>
                      </td>
                      <td>
                        <p className="font-medium text-slate-900">{t.paciente_apellido}, {t.paciente_nombre}</p>
                        <p className="text-xs text-slate-500">DNI {t.paciente_dni}</p>
                        {marcado && (
                          <button type="button" onClick={() => verHistorial(t)}
                            className="mt-1 inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800 hover:bg-rose-200">
                            ⚠ {t.cancelaciones_paciente} cancelaciones previas
                          </button>
                        )}
                      </td>
                      <td className="text-xs text-slate-500">
                        <p>{t.paciente_email}</p>
                        <p className={marcado ? 'font-semibold text-rose-700' : ''}>
                          {t.paciente_telefono || '-'}
                        </p>
                      </td>
                      <td className="text-xs">{t.consultorio}</td>
                      <td className="whitespace-nowrap">
                        {moneda(t.monto_pagado)}
                        <span className="text-xs text-slate-400"> / {moneda(t.monto_total)}</span>
                      </td>
                      <td><span className={estilo.clase}>{estilo.texto}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ------------- Registro de cancelaciones del paciente ------------- */}
      <Modal abierto={Boolean(historial)} onCerrar={() => setHistorial(null)}
        titulo="Registro de cancelaciones" ancho="max-w-2xl">
        {historial?.cargando ? (
          <Cargando texto="Cargando registro..." />
        ) : historial && (
          <div className="space-y-4">
            <div className="rounded-lg bg-rose-500/10 p-3 ring-1 ring-inset ring-rose-200">
              <p className="font-semibold text-slate-900">
                {historial.paciente.apellido}, {historial.paciente.nombre}
              </p>
              <p className="text-sm text-slate-700">
                Cancelo <b>{historial.total}</b> turno(s) con vos.
              </p>
              <div className="mt-2 flex flex-wrap gap-3 text-sm">
                {historial.paciente.telefono && (
                  <a href={`tel:${historial.paciente.telefono}`}
                    className="font-medium text-rose-700 hover:underline">
                    📞 {historial.paciente.telefono}
                  </a>
                )}
                <a href={`mailto:${historial.paciente.email}`}
                  className="font-medium text-rose-700 hover:underline">
                  ✉ {historial.paciente.email}
                </a>
              </div>
            </div>

            {historial.cancelaciones.length === 0 ? (
              <p className="text-sm text-slate-500">Sin cancelaciones registradas.</p>
            ) : (
              <div className="-mx-5 overflow-x-auto">
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Turno cancelado</th>
                      <th>Cancelo el</th>
                      <th>Antelacion</th>
                      <th>Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historial.cancelaciones.map((c) => {
                      const horasAnt = Number(c.horas_antelacion);
                      // Menos de un dia de aviso: es lo que deja el hueco sin cubrir.
                      const sobreLaHora = horasAnt < 24;
                      return (
                        <tr key={c.id}>
                          <td className="whitespace-nowrap">
                            <p className="font-medium text-slate-900">{fechaCorta(c.fecha)}</p>
                            <p className="text-xs text-slate-500">
                              {hora(c.hora_inicio)} - {c.consultorio}
                            </p>
                          </td>
                          <td className="whitespace-nowrap text-xs text-slate-600">
                            {c.cancelado_at ? fechaCorta(c.cancelado_at) : '-'}
                          </td>
                          <td className="whitespace-nowrap">
                            <span className={sobreLaHora ? 'badge-rojo' : 'badge-gris'}>
                              {horasAnt >= 0 ? `${horasAnt} h antes` : 'despues del turno'}
                            </span>
                          </td>
                          <td className="text-xs text-slate-600">{c.motivo_cancelacion || '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-end">
              <button type="button" className="btn-secundario" onClick={() => setHistorial(null)}>
                Cerrar
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* --------------------------- Cancelacion -------------------------- */}
      <Modal abierto={Boolean(aCancelar)} onCerrar={() => setACancelar(null)} titulo="Cancelar turno">
        {aCancelar && (
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <p className="font-medium text-slate-900">
                {aCancelar.paciente_apellido}, {aCancelar.paciente_nombre}
              </p>
              <p className="text-slate-600">
                {fechaLarga(aCancelar.fecha)} a las {hora(aCancelar.hora_inicio)} - {aCancelar.consultorio}
              </p>
            </div>

            <div>
              <label className="label">Motivo (se informa al paciente)</label>
              <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3}
                className="input" placeholder="Ej: imprevisto en el consultorio" maxLength={255} />
            </div>

            {Number(aCancelar.monto_pagado) > 0 && (
              <Aviso tipo="alerta">
                El paciente abono {moneda(aCancelar.monto_pagado)}. El reintegro se gestiona
                desde tu panel de MercadoPago.
              </Aviso>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secundario" onClick={() => setACancelar(null)}>
                Volver
              </button>
              <button type="button" className="btn-peligro" disabled={procesando} onClick={cancelar}>
                {procesando ? 'Cancelando...' : 'Cancelar turno'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
