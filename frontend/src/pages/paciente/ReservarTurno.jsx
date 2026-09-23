/**
 * pages/paciente/ReservarTurno.jsx
 * Flujo de reserva en tres pasos: Dia -> Consultorio -> Horario.
 *
 *   Paso 1  El paciente elige el dia. Solo se listan los dias con turnos
 *           libres segun los horarios que configuro el medico.
 *   Paso 2  Se resuelven los consultorios en los que el medico atiende ese
 *           dia. Si hay uno solo, se muestra directamente y el paso no pide
 *           ninguna decision; si hay varios, se ofrece un desplegable.
 *   Paso 3  Se listan los horarios libres FILTRADOS por el consultorio del
 *           paso 2, como botones seleccionables.
 *
 * Luego de confirmar, el turno queda 'pendiente' y se ofrece pagar la sena o
 * el total con MercadoPago.
 *
 * Notas de consistencia:
 *  - La disponibilidad ya viene sin superposiciones: el backend impide que un
 *    medico tenga bloques solapados aunque sean de consultorios distintos, de
 *    modo que un mismo horario nunca pertenece a dos consultorios a la vez.
 *  - Los horarios pasados se descartan dos veces: en el backend al calcular
 *    los slots, y aca contra la hora actual, por si la pantalla quedo abierta.
 *  - La reserva manda el consultorioId elegido y el backend verifica que sea
 *    el del slot, para que nunca se reserve en otro consultorio.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { medicosApi, turnosApi, pagosApi } from '../../api/servicios';
import { Aviso, Cargando, Modal, SinDatos } from '../../components/UI';
import {
  DIAS_CORTOS, diaSemanaDeFecha, fechaLarga, hora, horasHasta, hoyIso, moneda,
} from '../../utils/formato';
import { nombreConTratamiento } from '../../utils/tratamiento';

/** Cabecera de un paso, con su numero y estado. */
function Paso({ numero, titulo, descripcion, completo, activo, children }) {
  const estadoCirculo = completo
    ? 'bg-emerald-600 text-white'
    : activo
      ? 'bg-marca-600 text-white'
      : 'bg-slate-200 text-slate-500';

  return (
    <section className={`card ${!activo && !completo ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-3">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${estadoCirculo}`}>
          {completo ? '✓' : numero}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-slate-900">{titulo}</h2>
          {descripcion && <p className="text-sm text-slate-600">{descripcion}</p>}
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </section>
  );
}

export default function ReservarTurno() {
  const { medicoId } = useParams();

  const [medico, setMedico] = useState(null);
  const [calendario, setCalendario] = useState([]);

  // Seleccion de cada paso
  const [diaElegido, setDiaElegido] = useState(null);
  const [consultorioElegido, setConsultorioElegido] = useState(null); // id numerico
  const [slotElegido, setSlotElegido] = useState(null);
  const [motivo, setMotivo] = useState('');

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [procesando, setProcesando] = useState(false);

  // Turno ya creado. `datosPago` es null cuando el profesional no cobra
  // online: en ese caso el turno queda confirmado y no hay nada que abonar.
  const [turnoCreado, setTurnoCreado] = useState(null);
  const [datosPago, setDatosPago] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const datos = await medicosApi.disponibilidad(medicoId, { desde: hoyIso(), dias: 30 });
      setMedico(datos.medico);

      const conSlots = datos.calendario.filter((d) => d.slots.length > 0);
      setCalendario(conSlots);
      setDiaElegido((previo) => (
        // Se conserva el dia elegido si sigue teniendo turnos tras recargar.
        previo && conSlots.some((d) => d.fecha === previo) ? previo : conSlots[0]?.fecha || null
      ));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setCargando(false);
    }
  }, [medicoId]);

  useEffect(() => { cargar(); }, [cargar]);

  /* ------------------------ Derivados de la seleccion ------------------- */

  /** Slots del dia elegido, ya sin los horarios que pasaron. */
  const slotsDelDia = useMemo(() => {
    const delDia = calendario.find((d) => d.fecha === diaElegido)?.slots || [];
    // Segundo filtro de horarios pasados: el backend los descarta al calcular,
    // pero la pantalla pudo quedar abierta un rato largo.
    return delDia.filter((s) => horasHasta(s.fecha, s.horaInicio) > 0);
  }, [calendario, diaElegido]);

  /**
   * Consultorios en los que el medico atiende ese dia y tienen turnos libres.
   * Se derivan de los propios slots, asi no se ofrece un consultorio que ya
   * tiene toda su franja ocupada.
   */
  const consultoriosDelDia = useMemo(() => {
    const mapa = new Map();
    slotsDelDia.forEach((s) => {
      const actual = mapa.get(s.consultorioId);
      if (actual) {
        actual.libres += 1;
        if (s.horaInicio < actual.desde) actual.desde = s.horaInicio;
        if (s.horaFin > actual.hasta) actual.hasta = s.horaFin;
      } else {
        mapa.set(s.consultorioId, {
          id: s.consultorioId,
          nombre: s.consultorio,
          localidad: s.localidad,
          libres: 1,
          desde: s.horaInicio,
          hasta: s.horaFin,
        });
      }
    });
    return [...mapa.values()].sort((a, b) => a.desde.localeCompare(b.desde));
  }, [slotsDelDia]);

  const unicoConsultorio = consultoriosDelDia.length === 1;

  /**
   * Al cambiar de dia se resetea la seleccion.
   * Si ese dia el medico atiende en un solo consultorio, se selecciona solo:
   * el paso 2 queda informativo y el paciente pasa directo al horario.
   */
  useEffect(() => {
    setSlotElegido(null);
    setConsultorioElegido(unicoConsultorio ? consultoriosDelDia[0].id : null);
  }, [diaElegido, unicoConsultorio, consultoriosDelDia]);

  /** Paso 3: solo los horarios del consultorio seleccionado. */
  const slotsDelConsultorio = useMemo(() => (
    consultorioElegido
      ? slotsDelDia.filter((s) => s.consultorioId === consultorioElegido)
      : []
  ), [slotsDelDia, consultorioElegido]);

  const consultorioActual = consultoriosDelDia.find((c) => c.id === consultorioElegido) || null;

  /* ------------------------------- Acciones ----------------------------- */

  const confirmarReserva = async () => {
    setProcesando(true);
    setError(null);
    try {
      const respuesta = await turnosApi.reservar({
        medicoId: Number(medicoId),
        fecha: slotElegido.fecha,
        horaInicio: slotElegido.horaInicio,
        // Se envia el consultorio elegido: el backend rechaza la reserva si el
        // horario pertenece a otro.
        consultorioId: slotElegido.consultorioId,
        motivoConsulta: motivo || null,
      });
      setTurnoCreado(respuesta.turno);
      // requierePago === false -> el profesional no tiene MercadoPago
      // configurado y el turno ya nacio confirmado.
      setDatosPago(respuesta.requierePago === false ? null : respuesta.pago);
      setSlotElegido(null);
    } catch (err) {
      setError(err);
      // 409: alguien tomo el turno o el medico cambio la agenda -> se refresca
      // para que el slot desaparezca de inmediato.
      if (err.status === 409) { setSlotElegido(null); cargar(); }
    } finally {
      setProcesando(false);
    }
  };

  const pagar = async (tipo) => {
    setProcesando(true);
    setError(null);
    try {
      const { checkout } = await pagosApi.crearPreferencia(turnoCreado.id, tipo);
      // Checkout Pro con las credenciales del profesional: se sale del SPA.
      window.location.href = checkout.initPoint;
    } catch (err) {
      setError(err);
    } finally {
      setProcesando(false);
    }
  };

  /* -------------------------------- Render ------------------------------ */

  if (cargando) return <Cargando texto="Consultando disponibilidad..." />;

  if (!medico) {
    return (
      <Aviso tipo="error">
        {error?.message || 'No se pudo cargar el profesional.'}{' '}
        <Link to="/paciente" className="underline">Volver a la busqueda</Link>
      </Aviso>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <Link to="/paciente" className="text-sm font-medium text-marca-600 hover:underline">
          &larr; Volver a la busqueda
        </Link>
      </div>

      {/* --------------------------- Cabecera ----------------------------- */}
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-marca-100 text-xl font-semibold text-marca-700">
              {medico.nombre[0]}{medico.apellido[0]}
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">
                {nombreConTratamiento(medico)}
              </h1>
              <p className="text-marca-600">{medico.especialidad}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-slate-500">Consulta</p>
            <p className="text-xl font-bold text-slate-900">{moneda(medico.precioConsulta)}</p>
            <p className="text-xs text-slate-500">
              Sena {medico.porcentajeSena}% - {medico.duracionTurnoMin} min
            </p>
          </div>
        </div>
      </div>

      {error && (
        <Aviso tipo="error" detalles={error.detalles} onCerrar={() => setError(null)}>
          {error.message}
        </Aviso>
      )}

      {/* ------------------- Turno creado: pendiente de pago -------------- */}
      {turnoCreado ? (
        <div className={`card space-y-4 border-l-4 ${datosPago ? 'border-l-amber-400' : 'border-l-emerald-400'}`}>
          <div>
            <span className={datosPago ? 'badge-amarillo' : 'badge-verde'}>
              {datosPago ? 'Pendiente de pago' : 'Turno confirmado'}
            </span>
            <h2 className="mt-2 text-lg font-semibold text-slate-900">
              {datosPago ? 'Tu turno esta reservado' : 'Listo, tu turno quedo confirmado'}
            </h2>
            <p className="text-sm capitalize text-slate-600">{fechaLarga(turnoCreado.fecha)}</p>
            <p className="text-sm text-slate-600">
              {hora(turnoCreado.hora_inicio)} hs - {turnoCreado.consultorio}
            </p>
            <p className="text-xs text-slate-500">{turnoCreado.consultorio_direccion}</p>
          </div>

          {datosPago ? (
            /* El profesional cobra online: se ofrece sena o total. */
            <>
              <Aviso tipo="alerta">
                El turno se confirma cuando se acredita el pago. Podes abonar la sena o el total.
              </Aviso>

              <div className="grid gap-3 sm:grid-cols-2">
                <button type="button" className="btn-secundario" disabled={procesando}
                  onClick={() => pagar('sena')}>
                  Pagar sena {moneda(datosPago.montoSena)}
                </button>
                <button type="button" className="btn-primario" disabled={procesando}
                  onClick={() => pagar('total')}>
                  Pagar total {moneda(datosPago.montoTotal)}
                </button>
              </div>

              <Link to="/paciente/turnos" className="block text-center text-sm text-slate-500 hover:underline">
                Pagar mas tarde desde "Mis turnos"
              </Link>
            </>
          ) : (
            /* Sin cobro online: no hay nada que pagar, solo el aviso y la salida. */
            <>
              <Aviso tipo="info">
                Este profesional no cobra online. La consulta se abona en el consultorio
                el dia del turno.
              </Aviso>

              <div className="grid gap-3 sm:grid-cols-2">
                <Link to="/paciente/turnos" className="btn-primario">Ver mis turnos</Link>
                <Link to="/paciente" className="btn-secundario">Reservar otro turno</Link>
              </div>
            </>
          )}
        </div>
      ) : calendario.length === 0 ? (
        <SinDatos icono="📅" titulo="Sin turnos disponibles"
          descripcion="Este profesional no tiene horarios libres en los proximos 30 dias." />
      ) : (
        <>
          {/* =================== PASO 1: DIA =========================== */}
          <Paso numero={1} titulo="Elegi el dia"
            descripcion="Dias con turnos disponibles en los proximos 30 dias."
            activo completo={Boolean(diaElegido)}>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {calendario.map(({ fecha, slots }) => {
                const activo = fecha === diaElegido;
                return (
                  <button key={fecha} type="button" onClick={() => setDiaElegido(fecha)}
                    className={`w-20 shrink-0 rounded-lg border-2 p-2 text-center transition ${
                      activo ? 'border-marca-600 bg-marca-50' : 'border-slate-200 hover:border-slate-300'
                    }`}>
                    <p className="text-xs font-medium uppercase text-slate-500">
                      {DIAS_CORTOS[diaSemanaDeFecha(fecha)]}
                    </p>
                    <p className="text-lg font-bold text-slate-900">{fecha.slice(8, 10)}</p>
                    <p className="text-[11px] text-emerald-600">{slots.length} libres</p>
                  </button>
                );
              })}
            </div>
            {diaElegido && (
              <p className="mt-2 text-sm capitalize text-slate-600">
                Seleccionado: <b>{fechaLarga(diaElegido)}</b>
              </p>
            )}
          </Paso>

          {/* =============== PASO 2: CONSULTORIO ======================= */}
          {diaElegido && (
            <Paso numero={2} titulo="Consultorio"
              descripcion={unicoConsultorio
                ? 'Ese dia el profesional atiende en un solo consultorio.'
                : 'Ese dia el profesional atiende en mas de un consultorio. Elegi uno.'}
              activo completo={Boolean(consultorioElegido)}>

              {consultoriosDelDia.length === 0 ? (
                <Aviso tipo="alerta">
                  No quedan horarios libres en este dia. Elegi otro en el paso 1.
                </Aviso>
              ) : unicoConsultorio ? (
                /* Un solo consultorio: se muestra directo, sin opcion a elegir */
                <div className="rounded-lg border border-marca-200 bg-marca-50 p-3">
                  <p className="font-semibold text-slate-900">{consultoriosDelDia[0].nombre}</p>
                  <p className="text-sm text-slate-600">{consultoriosDelDia[0].localidad}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Atiende de {hora(consultoriosDelDia[0].desde)} a {hora(consultoriosDelDia[0].hasta)} hs
                    - {consultoriosDelDia[0].libres} turno(s) libre(s)
                  </p>
                </div>
              ) : (
                /* Varios consultorios: desplegable */
                <div className="space-y-3">
                  <div>
                    <label htmlFor="consultorio" className="label">
                      Consultorio ({consultoriosDelDia.length} disponibles)
                    </label>
                    <select id="consultorio" className="input sm:max-w-md"
                      value={consultorioElegido ?? ''}
                      onChange={(e) => {
                        setConsultorioElegido(e.target.value ? Number(e.target.value) : null);
                        setSlotElegido(null);
                      }}>
                      <option value="">Seleccionar consultorio...</option>
                      {consultoriosDelDia.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nombre} - {c.localidad} ({hora(c.desde)} a {hora(c.hasta)} hs, {c.libres} libres)
                        </option>
                      ))}
                    </select>
                  </div>

                  {consultorioActual && (
                    <div className="rounded-lg border border-marca-200 bg-marca-50 p-3">
                      <p className="font-semibold text-slate-900">{consultorioActual.nombre}</p>
                      <p className="text-sm text-slate-600">{consultorioActual.localidad}</p>
                    </div>
                  )}
                </div>
              )}
            </Paso>
          )}

          {/* ================= PASO 3: HORARIO ========================= */}
          {diaElegido && consultorioElegido && (
            <Paso numero={3} titulo="Elegi el horario"
              descripcion={`Turnos libres en ${consultorioActual?.nombre}.`}
              activo completo={false}>

              {slotsDelConsultorio.length === 0 ? (
                <Aviso tipo="alerta">
                  No quedan horarios libres en este consultorio. Proba con otro dia
                  {!unicoConsultorio && ' o con otro consultorio'}.
                </Aviso>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
                    {slotsDelConsultorio.map((slot) => (
                      <button key={`${slot.fecha}-${slot.horaInicio}`} type="button"
                        onClick={() => setSlotElegido(slot)}
                        className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-medium text-slate-700 transition hover:border-marca-500 hover:bg-marca-50 hover:text-marca-700">
                        {hora(slot.horaInicio)}
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    {slotsDelConsultorio.length} turno(s) de {medico.duracionTurnoMin} minutos.
                    Los horarios que ya pasaron no se muestran.
                  </p>
                </>
              )}
            </Paso>
          )}
        </>
      )}

      {/* --------------------- Confirmacion de reserva -------------------- */}
      <Modal abierto={Boolean(slotElegido)} onCerrar={() => setSlotElegido(null)} titulo="Confirmar turno">
        {slotElegido && (
          <div className="space-y-4">
            <dl className="space-y-2 rounded-lg bg-slate-50 p-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Profesional</dt>
                <dd className="font-medium text-slate-900">{nombreConTratamiento(medico, { soloApellido: true })}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Fecha</dt>
                <dd className="font-medium capitalize text-slate-900">{fechaLarga(slotElegido.fecha)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Hora</dt>
                <dd className="font-medium text-slate-900">
                  {hora(slotElegido.horaInicio)} - {hora(slotElegido.horaFin)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Consultorio</dt>
                <dd className="text-right font-medium text-slate-900">
                  {slotElegido.consultorio}
                  <span className="block text-xs font-normal text-slate-500">{slotElegido.localidad}</span>
                </dd>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2">
                <dt className="text-slate-500">Valor</dt>
                <dd className="font-semibold text-slate-900">{moneda(medico.precioConsulta)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Forma de pago</dt>
                <dd className="text-right text-sm font-medium text-slate-900">
                  {medico.mercadopagoConfigurado ? 'Online (sena o total)' : 'En el consultorio'}
                </dd>
              </div>
            </dl>

            {/* Sin cobro online no hay paso de pago: el turno queda confirmado. */}
            {!medico.mercadopagoConfigurado && (
              <Aviso tipo="info">
                Este profesional no cobra online: al confirmar, tu turno queda reservado
                y lo abonas en el consultorio.
              </Aviso>
            )}

            <div>
              <label className="label">Motivo de la consulta (opcional)</label>
              <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2}
                className="input" maxLength={255} placeholder="Ej: control de rutina" />
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secundario" onClick={() => setSlotElegido(null)}>
                Volver
              </button>
              <button type="button" className="btn-primario" disabled={procesando}
                onClick={confirmarReserva}>
                {procesando
                  ? 'Confirmando...'
                  : medico.mercadopagoConfigurado ? 'Reservar turno' : 'Confirmar reserva'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
