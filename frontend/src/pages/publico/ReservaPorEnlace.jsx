/**
 * pages/publico/ReservaPorEnlace.jsx
 * Pagina PUBLICA del enlace de agendamiento directo: /reservar/:hash
 *
 * No requiere sesion. Al entrar consulta y renderiza directamente los turnos
 * libres de ese profesional, y el paciente reserva cargando nombre y DNI.
 *
 * --------------------------------------------------------------------------
 * El numero de WhatsApp lo carga el paciente
 * --------------------------------------------------------------------------
 * El enlace del medico es generico: el mismo para todos, sin el numero de
 * nadie. Es el paciente quien escribe su WhatsApp en este formulario, y ese
 * numero queda guardado en el turno para que el consultorio pueda
 * comunicarse despues.
 *
 * Antes venia como parametro del enlace (?wa=...), lo que obligaba a armar un
 * enlace por paciente. Se acepta todavia ese parametro para PRECARGAR el
 * campo si alguien abre un enlace viejo, pero el campo es editable: el
 * paciente puede corregirlo.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { reservaPublicaApi } from '../../api/servicios';
import { Aviso, Cargando, Campo, Modal, SinDatos } from '../../components/UI';
import { DIAS_CORTOS, diaSemanaDeFecha, fechaLarga, hora, moneda } from '../../utils/formato';

export default function ReservaPorEnlace() {
  const { hash } = useParams();
  const [params] = useSearchParams();

  /**
   * Si el enlace trae ?wa= (formato antiguo) se usa para PRECARGAR el campo.
   * No es obligatorio ni de solo lectura: el paciente lo completa o lo
   * corrige en el formulario.
   */
  const whatsappPrecargado = useMemo(() => params.get('wa') || '', [params]);

  const [datos, setDatos] = useState(null);
  const [diaElegido, setDiaElegido] = useState(null);
  const [consultorioElegido, setConsultorioElegido] = useState(null);
  const [slotElegido, setSlotElegido] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [reserva, setReserva] = useState(null);   // resultado exitoso

  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: {
      nombre: '', apellido: '', dni: '', motivoConsulta: '',
      whatsapp: whatsappPrecargado,
    },
  });

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const respuesta = await reservaPublicaApi.disponibilidad(hash);
      setDatos(respuesta);
      setDiaElegido((previo) => (
        previo && respuesta.calendario.some((d) => d.fecha === previo)
          ? previo
          : respuesta.calendario[0]?.fecha || null
      ));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setCargando(false);
    }
  }, [hash]);

  useEffect(() => { cargar(); }, [cargar]);

  /* ------------------------- Derivados por dia -------------------------- */

  const slotsDelDia = useMemo(
    () => datos?.calendario.find((d) => d.fecha === diaElegido)?.slots || [],
    [datos, diaElegido]
  );

  /** Consultorios con turnos libres ese dia. */
  const consultoriosDelDia = useMemo(() => {
    const mapa = new Map();
    slotsDelDia.forEach((s) => {
      if (!mapa.has(s.consultorioId)) {
        mapa.set(s.consultorioId, {
          id: s.consultorioId, nombre: s.consultorio, localidad: s.localidad, libres: 0,
        });
      }
      mapa.get(s.consultorioId).libres += 1;
    });
    return [...mapa.values()];
  }, [slotsDelDia]);

  const unicoConsultorio = consultoriosDelDia.length === 1;

  // Al cambiar de dia se resetea; con un solo consultorio se autoselecciona.
  useEffect(() => {
    setSlotElegido(null);
    setConsultorioElegido(unicoConsultorio ? consultoriosDelDia[0].id : null);
  }, [diaElegido, unicoConsultorio, consultoriosDelDia]);

  const slotsVisibles = consultorioElegido
    ? slotsDelDia.filter((s) => s.consultorioId === consultorioElegido)
    : [];

  /* ------------------------------ Reserva ------------------------------- */

  const reservar = async (valores) => {
    setEnviando(true);
    setError(null);
    try {
      const respuesta = await reservaPublicaApi.reservar(hash, {
        nombre: valores.nombre,
        apellido: valores.apellido,
        dni: valores.dni,
        // El numero lo escribio el paciente: queda guardado en el turno para
        // que el consultorio pueda contactarlo.
        whatsapp: valores.whatsapp,
        fecha: slotElegido.fecha,
        horaInicio: slotElegido.horaInicio,
        consultorioId: slotElegido.consultorioId,
        motivoConsulta: valores.motivoConsulta || null,
      });
      setReserva(respuesta);
      setSlotElegido(null);
    } catch (err) {
      setError(err);
      if (err.status === 409) { setSlotElegido(null); cargar(); }
    } finally {
      setEnviando(false);
    }
  };

  /* ------------------------------- Render ------------------------------- */

  if (cargando) return <Cargando texto="Buscando turnos disponibles..." />;

  if (!datos) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="card max-w-md text-center">
          <span className="text-4xl">🔗</span>
          <h1 className="mt-3 text-lg font-semibold text-slate-900">Enlace no disponible</h1>
          <p className="mt-1 text-sm text-slate-600">
            {error?.message || 'El enlace no es valido o fue dado de baja.'}
          </p>
          <Link to="/" className="btn-secundario mt-4">Ir al inicio</Link>
        </div>
      </div>
    );
  }

  const m = datos.medico;

  return (
    <div className="min-h-screen bg-slate-50 pb-12">
      {/* --------------------------- Cabecera ---------------------------- */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-4">
          <span className="text-2xl">🩺</span>
          <span className="text-lg font-bold text-slate-900">AgendaMed</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        <div className="card">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-marca-100 text-xl font-semibold text-marca-700">
                {m.nombre[0]}{m.apellido[0]}
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">
                  Dr/a. {m.apellido}, {m.nombre}
                </h1>
                <p className="text-marca-600">{m.especialidad}</p>
                <p className="text-xs text-slate-500">Mat. {m.matricula}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-slate-500">Consulta</p>
              <p className="text-xl font-bold text-slate-900">{moneda(m.precioConsulta)}</p>
              <p className="text-xs text-slate-500">
                {m.mercadopagoConfigurado ? `Sena ${m.porcentajeSena}%` : 'Se abona en el consultorio'}
              </p>
            </div>
          </div>
        </div>

        {error && (
          <Aviso tipo="error" detalles={error.detalles} onCerrar={() => setError(null)}>
            {error.message}
          </Aviso>
        )}

        {/* ------------------------ Reserva hecha ------------------------ */}
        {reserva ? (
          <div className="card space-y-4 border-l-4 border-l-emerald-400">
            <div>
              <span className={reserva.requierePago ? 'badge-amarillo' : 'badge-verde'}>
                {reserva.requierePago ? 'Pendiente de pago' : 'Turno confirmado'}
              </span>
              <h2 className="mt-2 text-lg font-semibold text-slate-900">{reserva.mensaje}</h2>
            </div>

            <dl className="space-y-2 rounded-lg bg-slate-50 p-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Paciente</dt>
                <dd className="font-medium text-slate-900">
                  {reserva.paciente.apellido}, {reserva.paciente.nombre}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">DNI</dt>
                <dd className="text-slate-700">{reserva.paciente.dni}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">WhatsApp</dt>
                <dd className="font-mono text-slate-700">{reserva.paciente.whatsapp}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2">
                <dt className="text-slate-500">Fecha</dt>
                <dd className="font-medium capitalize text-slate-900">
                  {fechaLarga(reserva.turno.fecha)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Hora</dt>
                <dd className="font-medium text-slate-900">{hora(reserva.turno.horaInicio)} hs</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Consultorio</dt>
                <dd className="text-right font-medium text-slate-900">
                  {reserva.turno.consultorio}
                  <span className="block text-xs font-normal text-slate-500">
                    {reserva.turno.direccion}
                  </span>
                </dd>
              </div>
            </dl>

            {reserva.requierePago && (
              <Aviso tipo="alerta">
                Para confirmar el turno hay que abonar. El consultorio te va a enviar el link de
                pago al WhatsApp con el que reservaste.
              </Aviso>
            )}

            <p className="text-center text-xs text-slate-500">
              Guarda este comprobante o saca una captura de pantalla.
            </p>
          </div>
        ) : datos.calendario.length === 0 ? (
          <SinDatos icono="📅" titulo="Sin turnos disponibles"
            descripcion="El profesional no tiene horarios libres en los proximos 30 dias. Comunicate con el consultorio." />
        ) : (
          <>
            {/* ------------------------- Paso 1: dia -------------------- */}
            <div className="card">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">1. Elegi el dia</h2>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {datos.calendario.map(({ fecha, slots }) => {
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
            </div>

            {/* --------------------- Paso 2: consultorio ---------------- */}
            {diaElegido && consultoriosDelDia.length > 0 && (
              <div className="card">
                <h2 className="mb-3 text-sm font-semibold text-slate-900">2. Consultorio</h2>
                {unicoConsultorio ? (
                  <div className="rounded-lg border border-marca-200 bg-marca-50 p-3">
                    <p className="font-semibold text-slate-900">{consultoriosDelDia[0].nombre}</p>
                    <p className="text-sm text-slate-600">{consultoriosDelDia[0].localidad}</p>
                  </div>
                ) : (
                  <select className="input" value={consultorioElegido ?? ''}
                    onChange={(e) => {
                      setConsultorioElegido(e.target.value ? Number(e.target.value) : null);
                      setSlotElegido(null);
                    }}>
                    <option value="">Seleccionar consultorio...</option>
                    {consultoriosDelDia.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre} - {c.localidad} ({c.libres} libres)
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* ----------------------- Paso 3: horario ------------------ */}
            {consultorioElegido && (
              <div className="card">
                <h2 className="mb-1 text-sm font-semibold text-slate-900">3. Elegi el horario</h2>
                <p className="mb-3 text-xs capitalize text-slate-500">{fechaLarga(diaElegido)}</p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {slotsVisibles.map((slot) => (
                    <button key={slot.horaInicio} type="button"
                      onClick={() => setSlotElegido(slot)}
                      className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-medium text-slate-700 transition hover:border-marca-500 hover:bg-marca-50 hover:text-marca-700 disabled:cursor-not-allowed disabled:opacity-40">
                      {hora(slot.horaInicio)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* ------------------- Formulario de confirmacion ------------------ */}
      <Modal abierto={Boolean(slotElegido)} onCerrar={() => setSlotElegido(null)}
        titulo="Confirmar tu turno">
        {slotElegido && (
          <form onSubmit={handleSubmit(reservar)} className="space-y-4">
            <dl className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Fecha</dt>
                <dd className="font-medium capitalize text-slate-900">{fechaLarga(slotElegido.fecha)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Hora</dt>
                <dd className="font-medium text-slate-900">{hora(slotElegido.horaInicio)} hs</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Consultorio</dt>
                <dd className="text-right text-slate-900">{slotElegido.consultorio}</dd>
              </div>
            </dl>

            <div className="grid gap-4 sm:grid-cols-2">
              <Campo label="Nombre" requerido error={errors.nombre?.message}>
                <input className="input"
                  {...register('nombre', { required: 'Ingresa tu nombre' })} />
              </Campo>
              <Campo label="Apellido" requerido error={errors.apellido?.message}>
                <input className="input"
                  {...register('apellido', { required: 'Ingresa tu apellido' })} />
              </Campo>
            </div>

            <Campo label="DNI" requerido error={errors.dni?.message}
              ayuda="Sin puntos. Con tu DNI el consultorio identifica tu ficha.">
              <input className="input" inputMode="numeric"
                {...register('dni', {
                  required: 'Ingresa tu DNI',
                  pattern: { value: /^[\d.\s-]{6,20}$/, message: 'DNI invalido' },
                })} />
            </Campo>

            {/* El paciente carga su WhatsApp: es el contacto del turno. */}
            <Campo label="WhatsApp" requerido error={errors.whatsapp?.message}
              ayuda="Con codigo de area, sin el 0 ni el 15. Ej: 3511234567">
              <input type="tel" inputMode="tel" className="input font-mono"
                placeholder="3511234567"
                {...register('whatsapp', {
                  required: 'Ingresa tu numero de WhatsApp',
                  validate: (valor) => {
                    const digitos = String(valor || '').replace(/\D/g, '');
                    if (digitos.length < 8) return 'El numero parece incompleto';
                    if (digitos.length > 15) return 'El numero es demasiado largo';
                    return true;
                  },
                })} />
            </Campo>

            <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              El consultorio usa este numero para comunicarse con vos: confirmar el turno,
              avisarte una demora o reprogramar. Revisa que este bien escrito.
            </p>

            <Campo label="Motivo de la consulta" error={errors.motivoConsulta?.message}>
              <textarea rows={2} className="input" maxLength={255}
                placeholder="Opcional. Ej: control de rutina"
                {...register('motivoConsulta')} />
            </Campo>

            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secundario" onClick={() => setSlotElegido(null)}>
                Volver
              </button>
              <button type="submit" className="btn-primario"
                disabled={enviando}>
                {enviando ? 'Reservando...' : 'Confirmar turno'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
