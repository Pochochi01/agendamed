/**
 * pages/paciente/MisTurnos.jsx
 * Turnos del paciente: pago pendiente, cancelacion y historial.
 *
 * La cancelacion tiene una ventana minima de antelacion que define el
 * backend (CANCELACION_HORAS_MINIMAS) y llega en la respuesta del listado.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { turnosApi, pagosApi } from '../../api/servicios';
import { Aviso, Cargando, Modal, SinDatos } from '../../components/UI';
import { fechaLarga, hora, hoyIso, horasHasta, moneda, estiloEstadoTurno } from '../../utils/formato';

export default function MisTurnos() {
  const [params] = useSearchParams();
  const [turnos, setTurnos] = useState([]);
  // Antelacion solo SUGERIDA: no bloquea la cancelacion, se usa para avisar
  // al paciente que esta cancelando sobre la hora.
  const [horasRecomendadas, setHorasRecomendadas] = useState(24);
  const [totalCancelaciones, setTotalCancelaciones] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);

  const [aCancelar, setACancelar] = useState(null);
  const [motivo, setMotivo] = useState('');
  const [aPagar, setAPagar] = useState(null);
  const [procesando, setProcesando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const datos = await turnosApi.misTurnos();
      setTurnos(datos.turnos);
      setHorasRecomendadas(datos.horasRecomendadasCancelacion);
      setTotalCancelaciones(datos.totalCancelaciones || 0);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    // Vuelta desde el checkout de MercadoPago (o desde el pago simulado).
    const estado = params.get('estado') || params.get('pago');
    if (estado === 'success' || estado === 'simulado') {
      setAviso('Pago registrado. Si ya se acredito, el turno figura como confirmado.');
    } else if (estado === 'failure') {
      setError(new Error('El pago fue rechazado. Podes reintentarlo desde el turno.'));
    }
  }, [params]);

  const cancelar = async () => {
    setProcesando(true);
    try {
      const respuesta = await turnosApi.cancelar(aCancelar.id, motivo);
      setAviso(respuesta.reintegro
        ? `Turno cancelado. Abonaste ${moneda(respuesta.reintegro.montoPagado)}: el reintegro lo gestiona el profesional.`
        : 'Turno cancelado.');
      setACancelar(null);
      setMotivo('');
      await cargar();
    } catch (err) {
      setError(err);
      setACancelar(null);
    } finally {
      setProcesando(false);
    }
  };

  const pagar = async (turno, tipo) => {
    setProcesando(true);
    setError(null);
    try {
      const { checkout } = await pagosApi.crearPreferencia(turno.id, tipo);
      // Checkout Pro con las credenciales del profesional: se sale del SPA.
      window.location.href = checkout.initPoint;
    } catch (err) {
      setError(err);
    } finally {
      setProcesando(false);
    }
  };

  if (cargando) return <Cargando texto="Cargando tus turnos..." />;

  const hoy = hoyIso();
  const proximos = turnos.filter((t) => t.fecha.slice(0, 10) >= hoy && t.estado !== 'cancelado');
  const historial = turnos.filter((t) => t.fecha.slice(0, 10) < hoy || t.estado === 'cancelado');

  /** Tarjeta de un turno; `compacta` se usa en el historial. */
  const Tarjeta = ({ turno, compacta = false }) => {
    const estilo = estiloEstadoTurno(turno.estado);
    const restantes = horasHasta(turno.fecha, turno.hora_inicio);
    // Todo turno vigente que todavia no paso se puede cancelar. Sin limite de
    // antelacion: si el paciente no va a poder ir, conviene que lo libere.
    const puedeCancelar = !compacta
      && turno.estado !== 'cancelado'
      && turno.estado !== 'completado'
      && restantes > 0;
    const saldo = Number(turno.monto_total) - Number(turno.monto_pagado);
    // Si el profesional no tiene MercadoPago configurado no se ofrece pagar:
    // el turno ya esta confirmado y se abona en el consultorio.
    const cobraOnline = Boolean(turno.medico_cobra_online);
    const puedePagar = cobraOnline && saldo > 0;

    return (
      <article className={`card ${compacta ? 'opacity-75' : ''}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <span className={estilo.clase}>{estilo.texto}</span>
            <h3 className="mt-2 font-semibold capitalize text-slate-900">{fechaLarga(turno.fecha)}</h3>
            <p className="text-sm text-slate-600">
              {hora(turno.hora_inicio)} - {hora(turno.hora_fin)} hs
            </p>
            <p className="mt-1 text-sm text-slate-700">
              Dr/a. {turno.medico_apellido}, {turno.medico_nombre}
              <span className="text-slate-500"> - {turno.especialidad}</span>
            </p>
            <p className="text-xs text-slate-500">
              {turno.consultorio} - {turno.consultorio_direccion}
            </p>
            {turno.motivo_cancelacion && (
              <p className="mt-2 text-xs text-rose-600">Motivo: {turno.motivo_cancelacion}</p>
            )}
          </div>

          <div className="text-right">
            {cobraOnline ? (
              <>
                <p className="text-xs uppercase tracking-wide text-slate-500">Abonado</p>
                <p className="font-semibold text-slate-900">{moneda(turno.monto_pagado)}</p>
                <p className="text-xs text-slate-500">de {moneda(turno.monto_total)}</p>
              </>
            ) : (
              <>
                <p className="text-xs uppercase tracking-wide text-slate-500">A abonar</p>
                <p className="font-semibold text-slate-900">{moneda(turno.monto_total)}</p>
                <p className="text-xs text-slate-500">en el consultorio</p>
              </>
            )}
          </div>
        </div>

        {!compacta && turno.estado !== 'cancelado' && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            {puedePagar && (
              <button type="button" className="btn-primario btn-sm" onClick={() => setAPagar(turno)}>
                Pagar {moneda(saldo)}
              </button>
            )}
            {puedeCancelar && (
              <button type="button" className="btn-peligro btn-sm"
                onClick={() => { setACancelar(turno); setMotivo(''); }}>
                Cancelar turno
              </button>
            )}
            {puedeCancelar && restantes < horasRecomendadas && (
              <span className="text-xs text-amber-600">
                Faltan menos de {horasRecomendadas} h: avisa tambien al consultorio.
              </span>
            )}
          </div>
        )}
      </article>
    );
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Mis turnos</h1>
          <p className="text-sm text-slate-600">Proximas consultas e historial.</p>
        </div>
        <Link to="/paciente" className="btn-primario">+ Reservar turno</Link>
      </header>

      {aviso && <Aviso tipo="exito" onCerrar={() => setAviso(null)}>{aviso}</Aviso>}
      {error && <Aviso tipo="error" onCerrar={() => setError(null)}>{error.message}</Aviso>}

      {/* Registro propio de cancelaciones: el paciente ve lo mismo que el medico. */}
      {totalCancelaciones > 0 && (
        <div className="card flex items-center gap-3 border-l-4 border-l-amber-400 py-3">
          <span className="text-xl">📌</span>
          <p className="text-sm text-slate-700">
            Cancelaste <b>{totalCancelaciones}</b> turno(s) hasta ahora. Las cancelaciones quedan
            registradas y los profesionales las ven en su agenda.
          </p>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Proximos ({proximos.length})
        </h2>
        {proximos.length === 0 ? (
          <SinDatos icono="📅" titulo="No tenes turnos proximos"
            descripcion="Busca un profesional y reserva tu proxima consulta."
            accion={<Link to="/paciente" className="btn-primario">Buscar profesional</Link>} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {proximos.map((t) => <Tarjeta key={t.id} turno={t} />)}
          </div>
        )}
      </section>

      {historial.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Historial ({historial.length})
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {historial.map((t) => <Tarjeta key={t.id} turno={t} compacta />)}
          </div>
        </section>
      )}

      {/* ---------------------------- Cancelacion ------------------------- */}
      <Modal abierto={Boolean(aCancelar)} onCerrar={() => setACancelar(null)} titulo="Cancelar turno">
        {aCancelar && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Vas a cancelar el turno del <b className="capitalize">{fechaLarga(aCancelar.fecha)}</b> a
              las <b>{hora(aCancelar.hora_inicio)}</b> con Dr/a. {aCancelar.medico_apellido}.
            </p>

            {Number(aCancelar.monto_pagado) > 0 && (
              <Aviso tipo="alerta">
                Abonaste {moneda(aCancelar.monto_pagado)}. El reintegro lo gestiona el profesional
                desde MercadoPago.
              </Aviso>
            )}

            {/* Cancelar sobre la hora deja el turno sin cubrir. */}
            {horasHasta(aCancelar.fecha, aCancelar.hora_inicio) < horasRecomendadas && (
              <Aviso tipo="alerta">
                Estas cancelando con menos de {horasRecomendadas} h de antelacion: es probable
                que el profesional no llegue a ocupar ese horario. Si podes, avisale tambien
                por telefono.
              </Aviso>
            )}

            {/* Transparencia: el paciente ve el mismo registro que el medico. */}
            {Number(aCancelar.cancelaciones_paciente) > 0 && (
              <Aviso tipo="info">
                Ya cancelaste {aCancelar.cancelaciones_paciente} turno(s) con este profesional.
                Las cancelaciones quedan registradas en su agenda.
              </Aviso>
            )}

            <div>
              <label className="label">Motivo (opcional)</label>
              <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2}
                className="input" maxLength={255} />
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secundario" onClick={() => setACancelar(null)}>
                Volver
              </button>
              <button type="button" className="btn-peligro" disabled={procesando} onClick={cancelar}>
                {procesando ? 'Cancelando...' : 'Confirmar cancelacion'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ------------------------------- Pago ----------------------------- */}
      <Modal abierto={Boolean(aPagar)} onCerrar={() => setAPagar(null)} titulo="Pagar turno">
        {aPagar && (
          <div className="space-y-4">
            <dl className="space-y-1 rounded-lg bg-slate-50 p-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Total de la consulta</dt>
                <dd className="font-medium text-slate-900">{moneda(aPagar.monto_total)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Ya abonado</dt>
                <dd className="text-slate-700">{moneda(aPagar.monto_pagado)}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1">
                <dt className="font-medium text-slate-700">Saldo</dt>
                <dd className="font-semibold text-slate-900">
                  {moneda(Number(aPagar.monto_total) - Number(aPagar.monto_pagado))}
                </dd>
              </div>
            </dl>

            <p className="text-sm text-slate-600">
              Elegi como abonar. Al acreditarse el pago, el turno queda confirmado.
            </p>

            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" className="btn-secundario" disabled={procesando}
                onClick={() => pagar(aPagar, 'sena')}>
                Pagar sena
              </button>
              <button type="button" className="btn-primario" disabled={procesando}
                onClick={() => pagar(aPagar, 'total')}>
                Pagar saldo total
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
