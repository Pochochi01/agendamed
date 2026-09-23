/**
 * components/ModalTurno.jsx
 * Modal que se abre al hacer clic en un turno OCUPADO de la agenda diaria.
 *
 * Dos pestanas:
 *   "Paciente"         -> datos personales + formulario de obra social y
 *                         numero de afiliado (react-hook-form)
 *   "Historia clinica" -> lista cronologica de evoluciones + dictado por voz
 *
 * El WhatsApp que informo el paciente al reservar se muestra con un acceso
 * directo al chat: es el canal de contacto del turno, y en una reserva por
 * enlace suele ser el unico (no deja email ni cuenta).
 */
import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { pacientesApi, catalogoApi, turnosApi } from '../api/servicios';
import { Aviso, Cargando, Campo, Modal, SinDatos } from './UI';
import { fechaCorta, fechaLarga, hora, moneda, estiloEstadoTurno } from '../utils/formato';
import DictadoVoz from './DictadoVoz';

export default function ModalTurno({ turno, abierto, onCerrar, onCambio }) {
  const [pestana, setPestana] = useState('paciente');
  const [obrasSociales, setObrasSociales] = useState([]);
  const [ficha, setFicha] = useState(null);
  const [evoluciones, setEvoluciones] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [guardando, setGuardando] = useState(false);
  // Cancelacion del turno desde el propio slot.
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);
  const [motivoCancelacion, setMotivoCancelacion] = useState('');
  const [editandoEvolucion, setEditandoEvolucion] = useState(null);
  const [textoEdicion, setTextoEdicion] = useState('');

  const pacienteId = turno?.paciente?.id;

  const {
    register, handleSubmit, reset, watch,
    formState: { errors, isDirty },
  } = useForm({ defaultValues: { obraSocialId: '', nroAfiliado: '' } });

  // Sin obra social no tiene sentido pedir numero de afiliado.
  const obraSocialElegida = watch('obraSocialId');

  const cargar = useCallback(async () => {
    if (!pacienteId) return;
    setCargando(true);
    try {
      const [datosFicha, datosHistoria, catalogo] = await Promise.all([
        pacientesApi.ficha(pacienteId),
        pacientesApi.historia(pacienteId),
        catalogoApi.obrasSociales(),
      ]);
      setFicha(datosFicha.paciente);
      setEvoluciones(datosHistoria.evoluciones);
      setObrasSociales(catalogo);
      // react-hook-form toma los valores actuales como base del formulario.
      reset({
        obraSocialId: datosFicha.paciente.obra_social_id || '',
        nroAfiliado: datosFicha.paciente.nro_afiliado || '',
      });
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setCargando(false);
    }
  }, [pacienteId, reset]);

  useEffect(() => {
    if (abierto && pacienteId) {
      setPestana('paciente');
      setAviso(null);
      cargar();
    }
  }, [abierto, pacienteId, cargar]);

  /** Guarda obra social + numero de afiliado. */
  const guardarObraSocial = async (valores) => {
    setGuardando(true);
    setError(null);
    try {
      const { mensaje, paciente } = await pacientesApi.actualizarObraSocial(pacienteId, {
        obraSocialId: valores.obraSocialId || null,
        nroAfiliado: valores.nroAfiliado || null,
      });
      setFicha(paciente);
      reset({
        obraSocialId: paciente.obra_social_id || '',
        nroAfiliado: paciente.nro_afiliado || '',
      });
      setAviso(mensaje);
      onCambio?.();
    } catch (err) {
      setError(err);
    } finally {
      setGuardando(false);
    }
  };

  /**
   * Guarda la evolucion dictada. Solo llega el texto: el audio se quedo en el
   * navegador. La respuesta trae la lista completa, asi que se renderiza al
   * instante sin una segunda consulta.
   */
  const guardarEvolucion = async (texto) => {
    setGuardando(true);
    setError(null);
    try {
      const respuesta = await pacientesApi.crearEvolucion(pacienteId, {
        texto,
        turnoId: turno.turnoId,
        origen: 'dictado',
      });
      setEvoluciones(respuesta.evoluciones);
      setAviso('Evolucion guardada en la historia clinica.');
    } catch (err) {
      setError(err);
      // Se relanza para que DictadoVoz NO limpie el cuadro: si el guardado
      // fallo, el medico no puede perder lo que acaba de dictar.
      throw err;
    } finally {
      setGuardando(false);
    }
  };

  const guardarEdicion = async () => {
    setGuardando(true);
    try {
      const respuesta = await pacientesApi.actualizarEvolucion(
        pacienteId, editandoEvolucion.id, textoEdicion
      );
      setEvoluciones(respuesta.evoluciones);
      setEditandoEvolucion(null);
      setAviso('Evolucion actualizada.');
    } catch (err) {
      setError(err);
    } finally {
      setGuardando(false);
    }
  };

  const eliminarEvolucion = async (evolucion) => {
    if (!window.confirm('Eliminar esta evolucion de la historia clinica?')) return;
    try {
      const respuesta = await pacientesApi.eliminarEvolucion(pacienteId, evolucion.id);
      setEvoluciones(respuesta.evoluciones);
      setAviso('Evolucion eliminada.');
    } catch (err) {
      setError(err);
    }
  };

  /**
   * Cancela el turno desde el slot.
   *
   * Cancelar no borra nada: el turno queda en estado 'cancelado' con quien lo
   * cancelo y por que. Lo importante es el efecto lateral: al cancelarse, el
   * horario sale del indice de ocupacion y vuelve a ofrecerse solo, sin que
   * haya que liberarlo a mano. En modo "orden de llegada" ese horario pasa a
   * ser otra vez el primero de la fila.
   */
  const cancelarTurno = async () => {
    setGuardando(true);
    try {
      const { mensaje } = await turnosApi.cancelar(turno.turnoId, motivoCancelacion.trim() || null);
      setAviso(mensaje);
      setConfirmarCancelar(false);
      setMotivoCancelacion('');
      onCambio?.();
    } catch (err) {
      setError(err);
      setConfirmarCancelar(false);
    } finally {
      setGuardando(false);
    }
  };

  const cambiarEstadoTurno = async (estado) => {
    setGuardando(true);
    try {
      await turnosApi.cambiarEstado(turno.turnoId, estado);
      setAviso(`Turno marcado como ${estado}.`);
      onCambio?.();
    } catch (err) {
      setError(err);
    } finally {
      setGuardando(false);
    }
  };

  if (!turno) return null;

  const p = turno.paciente;
  const estilo = estiloEstadoTurno(turno.estado);

  return (
    <Modal abierto={abierto} onCerrar={onCerrar} ancho="max-w-3xl"
      titulo={`Turno ${hora(turno.horaInicio)} - ${p.apellido}, ${p.nombre}`}>

      {/* --------------------------- Cabecera ---------------------------- */}
      <div className="mb-4 rounded-lg bg-slate-50 p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className={estilo.clase}>{estilo.texto}</span>
            <p className="mt-1 text-sm capitalize text-slate-700">{fechaLarga(turno.fecha)}</p>
            <p className="text-sm text-slate-600">
              {hora(turno.horaInicio)} - {hora(turno.horaFin)} hs · {turno.consultorio}
            </p>
          </div>
          <div className="text-right text-sm">
            <p className="text-slate-500">
              {moneda(turno.montoPagado)} <span className="text-xs">de {moneda(turno.montoTotal)}</span>
            </p>
            {turno.canal === 'enlace_directo' && (
              <span className="badge-azul mt-1">Reservo por enlace</span>
            )}
          </div>
        </div>

        {turno.estado !== 'cancelado' && turno.estado !== 'completado' && (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-200 pt-3">
            <button type="button" className="btn-exito btn-sm" disabled={guardando}
              onClick={() => cambiarEstadoTurno('completado')}>
              Marcar atendido
            </button>
            <button type="button" className="btn-secundario btn-sm" disabled={guardando}
              onClick={() => cambiarEstadoTurno('ausente')}>
              No asistio
            </button>
            <button type="button" className="btn-peligro btn-sm" disabled={guardando}
              onClick={() => setConfirmarCancelar(true)}>
              Cancelar turno
            </button>
          </div>
        )}

        {/* ------------------- Cancelacion desde el slot ----------------- */}
        {confirmarCancelar && (
          <div className="mt-3 space-y-3 rounded-lg border border-rose-200 bg-rose-50 p-3">
            <p className="text-sm text-rose-900">
              Se cancela el turno y <b>el horario vuelve a quedar disponible</b> al instante.
              Avisale vos al paciente: el sistema no manda el mensaje.
            </p>
            <input type="text" className="input bg-white" maxLength={255}
              value={motivoCancelacion} placeholder="Motivo (opcional)"
              onChange={(e) => setMotivoCancelacion(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-peligro btn-sm" disabled={guardando}
                onClick={cancelarTurno}>
                {guardando ? 'Cancelando...' : 'Confirmar cancelacion'}
              </button>
              <button type="button" className="btn-secundario btn-sm" disabled={guardando}
                onClick={() => setConfirmarCancelar(false)}>
                Volver
              </button>
            </div>
          </div>
        )}
      </div>

      {/* --------------------------- Pestanas ---------------------------- */}
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {[
          { id: 'paciente', texto: 'Paciente' },
          { id: 'historia', texto: `Historia clinica${evoluciones.length ? ` (${evoluciones.length})` : ''}` },
        ].map((t) => (
          <button key={t.id} type="button" onClick={() => setPestana(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
              pestana === t.id
                ? 'border-marca-600 text-marca-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}>
            {t.texto}
          </button>
        ))}
      </div>

      {aviso && <div className="mb-3"><Aviso tipo="exito" onCerrar={() => setAviso(null)}>{aviso}</Aviso></div>}
      {error && (
        <div className="mb-3">
          <Aviso tipo="error" detalles={error.detalles} onCerrar={() => setError(null)}>
            {error.message}
          </Aviso>
        </div>
      )}

      {cargando ? (
        <Cargando texto="Cargando datos del paciente..." />
      ) : pestana === 'paciente' ? (
        /* =================== PESTANA: PACIENTE ======================== */
        <div className="space-y-5">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Datos personales</h3>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div className="flex justify-between border-b border-slate-100 pb-1">
                <dt className="text-slate-500">Nombre</dt>
                <dd className="font-medium text-slate-900">{p.apellido}, {p.nombre}</dd>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-1">
                <dt className="text-slate-500">DNI</dt>
                <dd className="font-medium text-slate-900">{p.dni}</dd>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-1">
                <dt className="text-slate-500">Nacimiento</dt>
                <dd className="text-slate-700">
                  {ficha?.fecha_nacimiento ? fechaCorta(ficha.fecha_nacimiento) : '-'}
                </dd>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-1">
                <dt className="text-slate-500">Email</dt>
                <dd className="truncate text-slate-700">{p.esInvitado ? '-' : ficha?.email || '-'}</dd>
              </div>
            </dl>
          </div>

          {/* El WhatsApp de origen es un dato fijo: se muestra bloqueado. */}
          <div className="rounded-lg bg-emerald-50 p-3 ring-1 ring-inset ring-emerald-200">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
              WhatsApp de contacto
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <input type="text" readOnly disabled
                value={p.whatsapp || 'No informado'}
                className="input max-w-[220px] cursor-not-allowed bg-white/70 font-mono" />
              {p.whatsapp && (
                <a href={`https://wa.me/${p.whatsapp}`} target="_blank" rel="noreferrer"
                  className="btn-exito btn-sm">
                  Abrir chat
                </a>
              )}
            </div>
            <p className="mt-1 text-xs text-emerald-800">
              Numero que el paciente informo al reservar. Usalo para confirmar el turno,
              avisar una demora o reprogramar.
            </p>
          </div>

          {/* ---------------- Obra social (react-hook-form) ------------- */}
          <form onSubmit={handleSubmit(guardarObraSocial)} className="space-y-4 rounded-lg border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900">Cobertura</h3>

            <Campo label="Obra social" error={errors.obraSocialId?.message}>
              <select className="input" {...register('obraSocialId')}>
                <option value="">Particular (sin obra social)</option>
                {obrasSociales.map((os) => (
                  <option key={os.id} value={os.id}>
                    {os.nombre}{os.sigla ? ` (${os.sigla})` : ''}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo label="Numero de afiliado" error={errors.nroAfiliado?.message}
              ayuda={obraSocialElegida ? undefined : 'Elegi una obra social para cargar el afiliado.'}>
              <input type="text" className="input" disabled={!obraSocialElegida}
                placeholder="Ej: 62001234567/01"
                {...register('nroAfiliado', {
                  maxLength: { value: 50, message: 'Maximo 50 caracteres' },
                  validate: (valor) =>
                    (!valor || obraSocialElegida)
                      ? true
                      : 'No se puede cargar un afiliado sin obra social',
                })} />
            </Campo>

            <div className="flex items-center gap-3">
              <button type="submit" className="btn-primario" disabled={guardando || !isDirty}>
                {guardando ? 'Guardando...' : 'Guardar cobertura'}
              </button>
              {!isDirty && <span className="text-xs text-slate-500">Sin cambios para guardar.</span>}
            </div>
            <p className="text-xs text-slate-500">
              La cobertura se guarda en la ficha del paciente: queda cargada para sus proximos turnos.
            </p>
          </form>
        </div>
      ) : (
        /* ================ PESTANA: HISTORIA CLINICA =================== */
        <div className="space-y-5">
          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Nueva evolucion</h3>
            <DictadoVoz onTextoListo={guardarEvolucion} deshabilitado={guardando} />
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold text-slate-900">
              Evoluciones anteriores ({evoluciones.length})
            </h3>

            {evoluciones.length === 0 ? (
              <SinDatos icono="📝" titulo="Sin evoluciones"
                descripcion="Las evoluciones que registres van a aparecer aca, de la mas reciente a la mas antigua." />
            ) : (
              <ol className="space-y-3">
                {evoluciones.map((ev) => (
                  <li key={ev.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="text-xs text-slate-500">
                        <span className="font-semibold text-slate-700">
                          {fechaCorta(ev.created_at)}
                        </span>
                        {ev.turno_fecha && (
                          <span> · turno del {fechaCorta(ev.turno_fecha)} {hora(ev.turno_hora)}</span>
                        )}
                        {ev.origen === 'dictado' && <span className="badge-azul ml-2">dictado</span>}
                      </div>
                      <div className="flex gap-2">
                        <button type="button"
                          className="text-xs font-medium text-marca-600 hover:underline"
                          onClick={() => { setEditandoEvolucion(ev); setTextoEdicion(ev.texto); }}>
                          Editar
                        </button>
                        <button type="button"
                          className="text-xs font-medium text-rose-600 hover:underline"
                          onClick={() => eliminarEvolucion(ev)}>
                          Eliminar
                        </button>
                      </div>
                    </div>

                    {editandoEvolucion?.id === ev.id ? (
                      <div className="mt-2 space-y-2">
                        <textarea rows={5} className="input" value={textoEdicion}
                          onChange={(e) => setTextoEdicion(e.target.value)} />
                        <div className="flex gap-2">
                          <button type="button" className="btn-primario btn-sm" disabled={guardando}
                            onClick={guardarEdicion}>
                            Guardar
                          </button>
                          <button type="button" className="btn-secundario btn-sm"
                            onClick={() => setEditandoEvolucion(null)}>
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      // whitespace-pre-wrap conserva los saltos del dictado.
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                        {ev.texto}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
