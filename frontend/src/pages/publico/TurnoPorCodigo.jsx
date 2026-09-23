/**
 * pages/publico/TurnoPorCodigo.jsx
 * Acceso del paciente a su turno, sin cuenta ni contrasena.
 *
 * ==========================================================================
 * Como llega aca
 * ==========================================================================
 * Al reservar por el enlace del profesional, la confirmacion devuelve un
 * codigo de 12 caracteres y la direccion /turno/<codigo>. El paciente la
 * guarda (se le muestra para copiar) y con eso entra a ver su turno y, si lo
 * necesita, cancelarlo.
 *
 * El codigo ES la credencial: no se pide nada mas. Por eso se genera al azar
 * con alfabeto sin caracteres confundibles (nada de O/0 ni I/1), es unico en
 * la tabla y el endpoint publico esta limitado por cantidad de intentos.
 *
 * ==========================================================================
 * Cancelar libera el horario
 * ==========================================================================
 * El turno queda en estado 'cancelado' y el horario se ofrece de nuevo al
 * instante: la disponibilidad se recalcula en cada consulta, no hay nada que
 * reponer a mano. En modo "orden de llegada", ademas, ese horario vuelve a
 * ser el primero de la fila.
 *
 * Solo se puede cancelar ANTES de la hora de inicio. Empezado el turno, el
 * boton desaparece y se indica llamar al consultorio.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { turnoPublicoApi } from '../../api/servicios';
import { Aviso, Cargando, Campo, Modal } from '../../components/UI';
import { fechaLarga, hora } from '../../utils/formato';
import { nombreConTratamiento } from '../../utils/tratamiento';

/** Texto y color de cada estado, para no repetir condicionales en el render. */
const ESTADOS = {
  pendiente:  { etiqueta: 'Reservado',  clase: 'bg-amber-50 text-amber-800 ring-amber-200' },
  confirmado: { etiqueta: 'Confirmado', clase: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  completado: { etiqueta: 'Atendido',   clase: 'bg-slate-100 text-slate-700 ring-slate-200' },
  cancelado:  { etiqueta: 'Cancelado',  clase: 'bg-rose-50 text-rose-800 ring-rose-200' },
};

export default function TurnoPorCodigo() {
  const { codigo } = useParams();

  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);

  const [confirmando, setConfirmando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [cancelando, setCancelando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setDatos(await turnoPublicoApi.ver(codigo));
      setError(null);
    } catch (err) {
      setError(err);
      setDatos(null);
    } finally {
      setCargando(false);
    }
  }, [codigo]);

  useEffect(() => { cargar(); }, [cargar]);

  const cancelar = async () => {
    setCancelando(true);
    try {
      const { mensaje } = await turnoPublicoApi.cancelar(codigo, motivo.trim() || null);
      setAviso(mensaje);
      setConfirmando(false);
      setMotivo('');
      // Se recarga para que el estado en pantalla sea el que quedo guardado.
      await cargar();
    } catch (err) {
      setError(err);
      setConfirmando(false);
    } finally {
      setCancelando(false);
    }
  };

  if (cargando) return <Cargando texto="Buscando tu turno..." className="py-20" />;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-4">
          <span className="text-2xl">🩺</span>
          <span className="text-lg font-bold text-slate-900">AgendaMed</span>
        </div>
      </header>

      <main className="mx-auto max-w-xl space-y-5 px-4 py-8">
        {error && (
          <Aviso tipo="error" detalles={error.detalles} onCerrar={() => setError(null)}>
            {error.message}
          </Aviso>
        )}
        {aviso && <Aviso tipo="exito" onCerrar={() => setAviso(null)}>{aviso}</Aviso>}

        {!datos ? (
          <div className="card text-center">
            <p className="text-4xl">🔍</p>
            <h1 className="mt-3 text-lg font-bold text-slate-900">No encontramos ese turno</h1>
            <p className="mt-1 text-sm text-slate-600">
              Revisa que el enlace este completo. Si lo copiaste a mano, fijate que el
              codigo tenga los 12 caracteres.
            </p>
            <Link to="/" className="btn-secundario mt-4 inline-block">Ir al inicio</Link>
          </div>
        ) : (
          <>
            <div className="card space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Tu turno</p>
                  <h1 className="text-xl font-bold text-slate-900">
                    {fechaLarga(datos.turno.fecha)}
                  </h1>
                  <p className="text-2xl font-bold text-marca-700">
                    {hora(datos.turno.horaInicio)}
                  </p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${
                  (ESTADOS[datos.turno.estado] || ESTADOS.pendiente).clase
                }`}>
                  {(ESTADOS[datos.turno.estado] || {}).etiqueta || datos.turno.estado}
                </span>
              </div>

              <dl className="space-y-2 border-t border-slate-100 pt-4 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Profesional</dt>
                  <dd className="text-right font-medium text-slate-900">
                    {nombreConTratamiento(datos.profesional)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Especialidad</dt>
                  <dd className="text-right text-slate-700">{datos.profesional.especialidad}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Consultorio</dt>
                  <dd className="text-right text-slate-700">
                    {datos.turno.consultorio}
                    {datos.turno.direccion && (
                      <span className="block text-xs text-slate-500">{datos.turno.direccion}</span>
                    )}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">A nombre de</dt>
                  <dd className="text-right text-slate-700">
                    {datos.paciente.apellido}, {datos.paciente.nombre}
                  </dd>
                </div>
              </dl>
            </div>

            {/* ------------------------ Cancelacion ------------------------ */}
            {datos.turno.estado === 'cancelado' ? (
              <Aviso tipo="info">
                Este turno esta cancelado
                {datos.turno.canceladoPor === 'medico' && ' por el consultorio'}
                {datos.turno.motivoCancelacion ? `: ${datos.turno.motivoCancelacion}` : '.'}
                {' '}El horario quedo libre para otros pacientes.
              </Aviso>
            ) : datos.puedeCancelar ? (
              <div className="card space-y-3">
                <h2 className="text-sm font-semibold text-slate-900">No vas a poder ir?</h2>
                <p className="text-sm text-slate-600">
                  Cancelalo y el horario queda libre para otro paciente. Faltan{' '}
                  <b>{datos.horasRestantes} h</b> para tu turno.
                </p>
                <button type="button" className="btn-peligro"
                  onClick={() => setConfirmando(true)}>
                  Cancelar mi turno
                </button>
              </div>
            ) : (
              <Aviso tipo="alerta">
                El turno ya comenzo, asi que no se puede cancelar desde aca.
                Comunicate con el consultorio.
              </Aviso>
            )}

            <p className="text-center text-xs text-slate-500">
              Guarda este enlace: es la unica forma de volver a ver o cancelar tu turno.
            </p>
          </>
        )}
      </main>

      {/* --------------------- Confirmar la cancelacion -------------------- */}
      <Modal abierto={confirmando} onCerrar={() => setConfirmando(false)}
        titulo="Cancelar el turno">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {datos && (
              <>
                Vas a cancelar el turno del <b>{fechaLarga(datos.turno.fecha)}</b> a las{' '}
                <b>{hora(datos.turno.horaInicio)}</b>. No se puede deshacer: si despues
                lo necesitas, vas a tener que reservar de nuevo y el horario puede estar
                tomado.
              </>
            )}
          </p>

          <Campo label="Motivo" ayuda="Opcional. Le sirve al consultorio para organizarse.">
            <input type="text" className="input" maxLength={255} value={motivo}
              placeholder="Me surgio un imprevisto"
              onChange={(e) => setMotivo(e.target.value)} />
          </Campo>

          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secundario" onClick={() => setConfirmando(false)}>
              Volver
            </button>
            <button type="button" className="btn-peligro" onClick={cancelar} disabled={cancelando}>
              {cancelando ? 'Cancelando...' : 'Si, cancelar'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
