/**
 * pages/publico/ReservaPorEnlace.jsx
 * Pagina PUBLICA del enlace de agendamiento directo: /reservar/:hash
 *
 * No requiere sesion. Al entrar consulta y renderiza directamente los turnos
 * libres de ese profesional, y el paciente reserva cargando nombre y DNI.
 *
 * --------------------------------------------------------------------------
 * El numero de WhatsApp: lo pone el paciente, como PARAMETRO
 * --------------------------------------------------------------------------
 * El enlace que comparte el medico es generico y no lleva el numero de nadie.
 *
 * Al entrar, lo PRIMERO que se le pide al paciente es su WhatsApp (paso 0).
 * Al continuar, ese numero pasa a la URL como parametro `?wa=`, y de ahi en
 * mas el flujo lo trata como dato fijo: cuando completa nombre, apellido y
 * DNI para reservar, el campo aparece ya cargado y SIN posibilidad de
 * editarlo.
 *
 * Por que separarlo en un paso previo y no ponerlo junto al resto:
 *   - el enlace del medico sigue siendo uno solo para todos;
 *   - el numero queda en la URL, asi sobrevive a recargas y a volver atras;
 *   - al momento de cargar los datos del turno ya es inmodificable, que es lo
 *     que se pidio, sin que por eso el paciente quede atrapado: puede
 *     corregirlo desde "Cambiar numero", que lo devuelve al paso 0.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { reservaPublicaApi } from '../../api/servicios';
import { Aviso, Cargando, Campo, Modal, SinDatos } from '../../components/UI';
import { DIAS_CORTOS, diaSemanaDeFecha, fechaLarga, hora } from '../../utils/formato';
// 'moneda' ya no se usa: la pantalla del paciente no muestra importes de consulta.
import { nombreConTratamiento } from '../../utils/tratamiento';

/** Deja el telefono en digitos, que es como se guarda y como lo usa wa.me. */
const soloDigitos = (v) => String(v || '').replace(/\D/g, '');

export default function ReservaPorEnlace() {
  const { hash } = useParams();
  const [params, setParams] = useSearchParams();

  /**
   * El numero vive en la URL. Es la fuente de verdad del resto del flujo:
   * si no esta, se muestra el paso 0; si esta, va bloqueado al formulario.
   */
  const whatsapp = useMemo(() => {
    const crudo = soloDigitos(params.get('wa'));
    return crudo.length >= 8 && crudo.length <= 15 ? crudo : '';
  }, [params]);

  // Campo del paso 0, antes de pasar el numero a la URL.
  const [waIngresado, setWaIngresado] = useState('');
  const [errorWa, setErrorWa] = useState(null);

  const [datos, setDatos] = useState(null);
  const [diaElegido, setDiaElegido] = useState(null);
  const [consultorioElegido, setConsultorioElegido] = useState(null);
  const [slotElegido, setSlotElegido] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [reserva, setReserva] = useState(null);   // resultado exitoso
  const [avisoCopia, setAvisoCopia] = useState(null);

  // El WhatsApp NO es un campo del formulario: viene del parametro de la URL.
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: { nombre: '', apellido: '', dni: '', motivoConsulta: '' },
  });

  /** Paso 0: pasa el numero validado a la URL como parametro. */
  const confirmarWhatsapp = (evento) => {
    evento.preventDefault();
    const digitos = soloDigitos(waIngresado);

    if (digitos.length < 8) {
      setErrorWa('El numero parece incompleto. Incluí el codigo de area, sin el 0 ni el 15.');
      return;
    }
    if (digitos.length > 15) {
      setErrorWa('El numero es demasiado largo. Revisalo.');
      return;
    }

    setErrorWa(null);
    // replace: no deja el paso 0 en el historial del navegador.
    setParams({ wa: digitos }, { replace: true });
  };

  /** Vuelve al paso 0 para corregir el numero. */
  const cambiarWhatsapp = () => {
    setWaIngresado(whatsapp);
    setSlotElegido(null);
    setParams({}, { replace: true });
  };

  /**
   * Copia el enlace de acceso al turno. Si el navegador no deja (sin HTTPS,
   * o permiso denegado) se avisa para que lo copie a mano: el texto esta a la
   * vista en un input, no se pierde nada.
   */
  const copiarAcceso = async (texto) => {
    try {
      await navigator.clipboard.writeText(texto);
      setAvisoCopia('Enlace copiado. Guardalo donde no lo pierdas.');
    } catch {
      setAvisoCopia('No se pudo copiar solo. Selecciona el enlace y copialo a mano.');
    }
  };

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

  const diaActual = useMemo(
    () => datos?.calendario.find((d) => d.fecha === diaElegido) || null,
    [datos, diaElegido]
  );

  const slotsDelDia = diaActual?.slots || [];

  /*
   * Con "orden de llegada" el profesional ofrece un turno por vez. Pero
   * faltando menos de 6 horas para la jornada se liberan todos los libres,
   * para cubrir los huecos de quienes cancelaron. Cuando eso pasa conviene
   * decirlo: el paciente que hace un rato vio un solo horario y ahora ve seis
   * necesita entender que cambio, y que esos huecos se toman rapido.
   */
  const jornadaLiberada = Boolean(diaActual?.jornadaLiberada);

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
        // Se envia como `wa` porque eso es: el parametro que el paciente
        // confirmo al entrar, no un campo editable del formulario.
        wa: whatsapp,
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
                {/* Nombre y especialidad. La matricula no se muestra: al
                    paciente no le dice nada y el backend ya no la manda. */}
                <h1 className="text-xl font-bold text-slate-900">
                  {nombreConTratamiento(m, { natural: true })}
                </h1>
                <p className="text-marca-600">{m.especialidad}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-500">
                {m.mercadopagoConfigurado
                  ? `Se reserva con una sena del ${m.porcentajeSena}%`
                  : 'Se abona en el consultorio'}
              </p>
            </div>
          </div>
        </div>

        {error && (
          <Aviso tipo="error" detalles={error.detalles} onCerrar={() => setError(null)}>
            {error.message}
          </Aviso>
        )}

        {/* ================= PASO 0: WhatsApp del paciente ================ */}
        {!whatsapp && !reserva ? (
          <div className="card space-y-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Antes de empezar, dejanos tu WhatsApp
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Es la forma que tiene el consultorio de comunicarse con vos: confirmar el
                turno, avisarte una demora o reprogramar.
              </p>
            </div>

            <form onSubmit={confirmarWhatsapp} className="space-y-3">
              <Campo label="Tu numero de WhatsApp" requerido error={errorWa}
                ayuda="Con codigo de area, sin el 0 ni el 15. Ej: 3511234567">
                <input type="tel" inputMode="tel" autoFocus
                  className="input font-mono text-lg"
                  placeholder="3511234567"
                  value={waIngresado}
                  onChange={(e) => { setWaIngresado(e.target.value); setErrorWa(null); }} />
              </Campo>

              <button type="submit" className="btn-primario w-full">
                Continuar
              </button>

              <p className="text-center text-xs text-slate-500">
                Despues vas a elegir dia y horario, y completar tus datos.
              </p>
            </form>
          </div>
        ) : null}

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

            {/* ------------------- Acceso al turno ----------------------
                El codigo de cancelacion es la credencial del paciente: con
                ese enlace vuelve a ver su turno y lo cancela sin tener
                cuenta. Se muestra apenas se reserva porque es el unico
                momento en que se le entrega. */}
            {reserva.cancelacion && (
              <div className="rounded-lg border border-marca-200 bg-marca-50 p-4">
                <p className="text-sm font-semibold text-marca-900">
                  Guarda este enlace para ver o cancelar tu turno
                </p>
                <p className="mt-1 text-xs text-marca-800">
                  No hace falta usuario ni contrasena: el enlace es tu acceso.
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  <input type="text" readOnly value={reserva.cancelacion.url}
                    className="input flex-1 bg-white font-mono text-xs"
                    onFocus={(e) => e.target.select()} />
                  <button type="button" className="btn-secundario btn-sm"
                    onClick={() => copiarAcceso(reserva.cancelacion.url)}>
                    Copiar
                  </button>
                </div>

                <p className="mt-2 text-xs text-marca-800">
                  Codigo: <b className="font-mono tracking-wider">{reserva.cancelacion.codigo}</b>
                </p>

                {avisoCopia && (
                  <p className="mt-2 text-xs font-medium text-marca-700" role="status">
                    {avisoCopia}
                  </p>
                )}

                <Link to={`/turno/${reserva.cancelacion.codigo}`}
                  className="mt-3 inline-block text-xs font-medium text-marca-700 underline">
                  Abrir ahora
                </Link>
              </div>
            )}

            <p className="text-center text-xs text-slate-500">
              Guarda este comprobante o saca una captura de pantalla.
            </p>
          </div>
        ) : !whatsapp ? (
          // Sin numero todavia: el paso 0 de arriba es lo unico visible.
          null
        ) : datos.calendario.length === 0 ? (
          <SinDatos icono="📅" titulo="Sin turnos disponibles"
            descripcion="El profesional no tiene horarios libres en los proximos 30 dias. Comunicate con el consultorio." />
        ) : (
          <>
            {/* Numero confirmado: queda a la vista, y este es el unico lugar
                donde se puede corregir. En el formulario de reserva ya no. */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-emerald-50 px-4 py-3 ring-1 ring-inset ring-emerald-200">
              <p className="text-sm text-emerald-900">
                Te contactamos al <b className="font-mono">{whatsapp}</b>
              </p>
              <button type="button" onClick={cambiarWhatsapp}
                className="text-xs font-medium text-emerald-800 underline hover:text-emerald-900">
                Cambiar numero
              </button>
            </div>

            {jornadaLiberada && (
              <Aviso tipo="info">
                Se liberaron los turnos que quedaron libres para este dia, incluidos los
                que alguien cancelo. Elegi el que te sirva: suelen tomarse rapido.
              </Aviso>
            )}

            {/* ------------------------- Paso 1: dia -------------------- */}
            <div className="card">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">1. Elegi el dia</h2>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {datos.calendario.map(({ fecha, slots, jornadaLiberada: liberada }) => {
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
                      {liberada && (
                        <p className="text-[10px] font-medium text-amber-600">hoy se liberaron</p>
                      )}
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

            {/*
              WhatsApp: viene del parametro de la URL, cargado en el paso 0.
              Aca es de SOLO LECTURA (readOnly + disabled): mientras completa
              nombre, apellido y DNI no puede modificarlo. Si se equivoco, lo
              corrige desde "Cambiar numero", fuera de este formulario.
            */}
            <div>
              <label className="label">WhatsApp</label>
              <input type="text" readOnly disabled value={whatsapp}
                className="input cursor-not-allowed bg-slate-100 font-mono text-slate-600" />
              <p className="mt-1 text-xs text-slate-500">
                Es el numero con el que ingresaste. Queda asociado al turno y no se puede
                modificar desde aca: si esta mal, volve atras y usa &ldquo;Cambiar numero&rdquo;.
              </p>
            </div>

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
