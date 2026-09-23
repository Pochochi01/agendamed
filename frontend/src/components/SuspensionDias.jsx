/**
 * components/SuspensionDias.jsx
 * Suspension de un dia suelto o de un rango de dias completo.
 *
 * ==========================================================================
 * Que hace una suspension
 * ==========================================================================
 * Dos cosas a la vez, y las dos importan:
 *   1. bloquea esos dias para que nadie pueda reservar un turno nuevo;
 *   2. cancela los turnos que ya estaban tomados en ese periodo.
 *
 * Por eso siempre se pide confirmacion antes de mandarla: el paciente que
 * tenia turno se queda sin el, y hay que avisarle aparte.
 *
 * ==========================================================================
 * Motivo
 * ==========================================================================
 * El motivo es obligatorio y sale de una lista cerrada (vacaciones, congreso,
 * curso, motivos personales, otros). La lista la manda el backend en
 * `motivos`, asi que agregar una opcion alla la hace aparecer aca sin tocar
 * este archivo. Ademas se puede dejar una aclaracion libre.
 *
 * Levantar una suspension libera los dias, pero NO devuelve los turnos que se
 * cancelaron: esos pacientes ya fueron avisados y tienen que pedir de nuevo.
 */
import { useCallback, useEffect, useState } from 'react';
import { agendaApi } from '../api/servicios';
import { Aviso, Campo, Modal, SinDatos } from './UI';
import { fechaCorta, fechaLarga, hoyIso } from '../utils/formato';

/**
 * Respaldo por si la API no mandara la lista. El backend es la fuente de
 * verdad (backend/src/models/ausencia.model.js -> MOTIVOS).
 */
const MOTIVOS_POR_DEFECTO = {
  vacaciones: 'Vacaciones',
  congreso: 'Congreso',
  curso: 'Curso',
  personal: 'Motivos personales',
  otro: 'Otros',
};

const FORM_INICIAL = { desde: '', hasta: '', tipoMotivo: 'vacaciones', motivo: '', consultorioIds: [] };

export default function SuspensionDias({ consultorios = [] }) {
  const [periodos, setPeriodos] = useState([]);
  const [motivos, setMotivos] = useState(MOTIVOS_POR_DEFECTO);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);

  const [form, setForm] = useState(FORM_INICIAL);
  const [confirmando, setConfirmando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [aLevantar, setALevantar] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      // Desde hoy: sobre las suspensiones pasadas ya no hay nada que hacer.
      const datos = await agendaApi.ausencias({ desde: hoyIso() });
      setPeriodos(datos.periodos || []);
      if (datos.motivos) setMotivos(datos.motivos);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  /** Un solo dia = "hasta" vacio. El backend lo toma como desde = hasta. */
  const esRango = Boolean(form.hasta && form.hasta !== form.desde);

  const abrirConfirmacion = (e) => {
    e.preventDefault();
    setError(null);

    if (!form.desde) {
      setError({ message: 'Elegi desde que dia se suspende la atencion.' });
      return;
    }
    if (form.hasta && form.hasta < form.desde) {
      setError({ message: 'La fecha de fin no puede ser anterior a la de inicio.' });
      return;
    }
    setConfirmando(true);
  };

  const suspender = async () => {
    setGuardando(true);
    try {
      const { mensaje } = await agendaApi.suspender({
        desde: form.desde,
        hasta: form.hasta || form.desde,
        tipoMotivo: form.tipoMotivo,
        motivo: form.motivo.trim() || null,
        // Sin seleccion, el backend suspende todos los consultorios activos.
        consultorioIds: form.consultorioIds.length ? form.consultorioIds : undefined,
      });
      setAviso(mensaje);
      setForm(FORM_INICIAL);
      setConfirmando(false);
      await cargar();
    } catch (err) {
      setError(err);
      setConfirmando(false);
    } finally {
      setGuardando(false);
    }
  };

  const levantar = async () => {
    setGuardando(true);
    try {
      const { mensaje } = await agendaApi.levantarSuspension(aLevantar.periodo);
      setAviso(mensaje);
      setALevantar(null);
      await cargar();
    } catch (err) {
      setError(err);
      setALevantar(null);
    } finally {
      setGuardando(false);
    }
  };

  /** Marca o desmarca un consultorio en la seleccion. */
  const alternarConsultorio = (id) => {
    setForm((prev) => ({
      ...prev,
      consultorioIds: prev.consultorioIds.includes(id)
        ? prev.consultorioIds.filter((x) => x !== id)
        : [...prev.consultorioIds, id],
    }));
  };

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Suspension de dias</h2>
        <p className="text-sm text-slate-600">
          Bloquea un dia suelto o un periodo entero: vacaciones, un congreso, un curso.
          Esos dias dejan de ofrecer turnos.
        </p>
      </div>

      {error && (
        <Aviso tipo="error" detalles={error.detalles} onCerrar={() => setError(null)}>
          {error.message}
        </Aviso>
      )}
      {aviso && <Aviso tipo="exito" onCerrar={() => setAviso(null)}>{aviso}</Aviso>}

      {/* ------------------------- Nueva suspension ----------------------- */}
      <form onSubmit={abrirConfirmacion} className="space-y-4 rounded-lg border border-slate-200 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo label="Desde" requerido>
            <input type="date" className="input" value={form.desde} required min={hoyIso()}
              onChange={(e) => setForm({ ...form, desde: e.target.value })} />
          </Campo>
          <Campo label="Hasta" ayuda="Dejalo vacio para suspender un solo dia.">
            <input type="date" className="input" value={form.hasta} min={form.desde || hoyIso()}
              onChange={(e) => setForm({ ...form, hasta: e.target.value })} />
          </Campo>
        </div>

        <Campo label="Motivo" requerido>
          <select className="input" value={form.tipoMotivo}
            onChange={(e) => setForm({ ...form, tipoMotivo: e.target.value })}>
            {Object.entries(motivos).map(([valor, etiqueta]) => (
              <option key={valor} value={valor}>{etiqueta}</option>
            ))}
          </select>
        </Campo>

        <Campo label="Aclaracion" ayuda="Opcional. Queda en el registro interno.">
          <input type="text" className="input" maxLength={255} value={form.motivo}
            placeholder="Congreso de cardiologia en Rosario"
            onChange={(e) => setForm({ ...form, motivo: e.target.value })} />
        </Campo>

        {/* Con un solo consultorio no hay nada que elegir: se suspende ese. */}
        {consultorios.length > 1 && (
          <Campo label="Consultorios" ayuda="Sin marcar ninguno se suspenden todos.">
            <div className="flex flex-wrap gap-2">
              {consultorios.map((c) => (
                <label key={c.id}
                  className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${
                    form.consultorioIds.includes(c.id)
                      ? 'border-marca-500 bg-marca-50 text-marca-800'
                      : 'border-slate-200 text-slate-600'
                  }`}>
                  <input type="checkbox" className="sr-only"
                    checked={form.consultorioIds.includes(c.id)}
                    onChange={() => alternarConsultorio(c.id)} />
                  {c.nombre}
                </label>
              ))}
            </div>
          </Campo>
        )}

        <div className="flex justify-end">
          <button type="submit" className="btn-primario" disabled={guardando}>
            Suspender {esRango ? 'el periodo' : 'el dia'}
          </button>
        </div>
      </form>

      {/* ------------------------ Suspensiones activas -------------------- */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Suspensiones vigentes</h3>

        {cargando ? (
          <p className="py-4 text-center text-xs text-slate-400">Cargando...</p>
        ) : periodos.length === 0 ? (
          <SinDatos icono="📅" titulo="No tenes dias suspendidos"
            descripcion="Cuando suspendas vacaciones o un congreso, van a aparecer aca." />
        ) : (
          <ul className="space-y-2">
            {periodos.map((p) => (
              <li key={p.periodo}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {p.dias > 1
                      ? `${fechaCorta(p.desde)} al ${fechaCorta(p.hasta)} (${p.dias} dias)`
                      : fechaLarga(p.desde)}
                  </p>
                  <p className="text-xs font-medium text-amber-800">
                    {motivos[p.tipo_motivo] || 'Suspension'}
                    {p.motivo ? ` - ${p.motivo}` : ''}
                  </p>
                  <p className="truncate text-xs text-slate-500">{p.nombres_consultorios}</p>
                  {Number(p.turnos_cancelados) > 0 && (
                    <p className="text-xs text-rose-700">
                      Se cancelaron {p.turnos_cancelados} turno(s).
                    </p>
                  )}
                </div>
                <button type="button" className="btn-secundario btn-sm"
                  onClick={() => setALevantar(p)} disabled={guardando}>
                  Levantar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* --------------------- Confirmar la suspension -------------------- */}
      <Modal abierto={confirmando} onCerrar={() => setConfirmando(false)}
        titulo={esRango ? 'Suspender el periodo' : 'Suspender el dia'}>
        <div className="space-y-4">
          <Aviso tipo="alerta">
            Se van a <b>cancelar los turnos ya reservados</b> en{' '}
            {esRango
              ? `el periodo ${fechaCorta(form.desde)} al ${fechaCorta(form.hasta)}`
              : fechaLarga(form.desde)}
            , y esos dias dejan de ofrecer turnos nuevos. Avisales vos a los pacientes:
            el sistema no manda el mensaje.
          </Aviso>

          <p className="text-sm text-slate-600">
            Motivo: <b>{motivos[form.tipoMotivo]}</b>
            {form.motivo.trim() ? ` (${form.motivo.trim()})` : ''}.
          </p>

          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secundario" onClick={() => setConfirmando(false)}>
              Volver
            </button>
            <button type="button" className="btn-peligro" onClick={suspender} disabled={guardando}>
              {guardando ? 'Suspendiendo...' : 'Si, suspender'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ---------------------- Confirmar el levantado -------------------- */}
      <Modal abierto={Boolean(aLevantar)} onCerrar={() => setALevantar(null)}
        titulo="Levantar la suspension">
        {aLevantar && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Esos dias vuelven a ofrecer turnos desde este momento.
            </p>
            <Aviso tipo="info">
              Los turnos que se cancelaron al suspender <b>no se restauran</b>: esos
              pacientes tienen que volver a reservar.
            </Aviso>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secundario" onClick={() => setALevantar(null)}>
                Cancelar
              </button>
              <button type="button" className="btn-primario" onClick={levantar} disabled={guardando}>
                {guardando ? 'Levantando...' : 'Levantar'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}
