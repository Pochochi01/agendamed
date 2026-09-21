/**
 * pages/medico/MedicoEnlace.jsx
 * Enlace de agendamiento directo para compartir con los pacientes.
 *
 * El enlace es UNICO y generico: el mismo para todos los pacientes.
 *
 * No se arma un enlace por persona con su telefono. El paciente carga su
 * WhatsApp en el formulario de reserva y ese numero queda en el turno, que es
 * donde el profesional lo necesita para comunicarse despues.
 */
import { useCallback, useEffect, useState } from 'react';
import { medicosApi } from '../../api/servicios';
import { Aviso, Cargando, Modal } from '../../components/UI';


export default function MedicoEnlace() {
  const [enlace, setEnlace] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [procesando, setProcesando] = useState(false);
  const [confirmarRegenerar, setConfirmarRegenerar] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setEnlace(await medicosApi.miEnlace());
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const copiar = async (texto, etiqueta) => {
    try {
      await navigator.clipboard.writeText(texto);
      setAviso(`${etiqueta} copiado al portapapeles.`);
    } catch {
      setAviso('No se pudo copiar. Selecciona el texto y copialo a mano.');
    }
  };

  const regenerar = async () => {
    setProcesando(true);
    try {
      const { mensaje } = await medicosApi.regenerarEnlace();
      setAviso(mensaje);
      setConfirmarRegenerar(false);
      await cargar();
    } catch (err) {
      setError(err);
    } finally {
      setProcesando(false);
    }
  };

  const alternarActivo = async () => {
    setProcesando(true);
    try {
      const { mensaje } = await medicosApi.cambiarEstadoEnlace(!enlace.activo);
      setAviso(mensaje);
      await cargar();
    } catch (err) {
      setError(err);
    } finally {
      setProcesando(false);
    }
  };

  if (cargando) return <Cargando texto="Cargando tu enlace..." />;
  if (!enlace) {
    return <Aviso tipo="error">{error?.message || 'No se pudo cargar el enlace.'}</Aviso>;
  }

  // Un unico enlace para todos: el paciente carga su WhatsApp al reservar.
  const mensajeSugerido = `Hola! Podes reservar tu turno conmigo desde este enlace: ${enlace.url}`;
  const mensajeWhatsapp = encodeURIComponent(mensajeSugerido);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Mi enlace de turnos</h1>
        <p className="text-sm text-slate-600">
          Compartilo con tus pacientes: entran y reservan directo sobre tu agenda.
        </p>
      </header>

      {aviso && <Aviso tipo="exito" onCerrar={() => setAviso(null)}>{aviso}</Aviso>}
      {error && <Aviso tipo="error" onCerrar={() => setError(null)}>{error.message}</Aviso>}

      {!enlace.activo && (
        <Aviso tipo="alerta">
          El enlace esta desactivado: quien lo abra vera un aviso de que no esta disponible.
        </Aviso>
      )}

      {/*
        El backend deduce el dominio de la request. Si igual quedo apuntando a
        localhost, el enlace no sirve fuera de esta maquina: conviene avisarlo
        antes de que lo comparta, no despues.
      */}
      {enlace.compartible === false && (
        <Aviso tipo="error">
          Este enlace apunta a <b>{enlace.base}</b>, que solo funciona en esta computadora.
          Para compartirlo hay que acceder al sistema por su dominio publico, o definir
          <b> PUBLIC_URL</b> en el <code>.env</code> del servidor.
        </Aviso>
      )}

      {/* --------------------------- Enlace base -------------------------- */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Enlace general</h2>
          <span className={enlace.activo ? 'badge-verde' : 'badge-gris'}>
            {enlace.activo ? 'Activo' : 'Desactivado'}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <input type="text" readOnly value={enlace.url}
            className="input flex-1 font-mono text-xs sm:text-sm"
            onFocus={(e) => e.target.select()} />
          <button type="button" className="btn-secundario"
            onClick={() => copiar(enlace.url, 'Enlace')}>
            Copiar
          </button>
        </div>

        <p className="text-xs text-slate-500">
          El identificador se arma con tu <b>matricula, apellido y nombre</b>, para que el
          paciente reconozca de quien es el enlace al recibirlo.
        </p>

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secundario btn-sm" disabled={procesando}
            onClick={alternarActivo}>
            {enlace.activo ? 'Desactivar enlace' : 'Activar enlace'}
          </button>
          <button type="button" className="btn-peligro btn-sm" disabled={procesando}
            onClick={() => setConfirmarRegenerar(true)}>
            Regenerar
          </button>
        </div>
      </div>

      {/* ------------------------- Como funciona -------------------------- */}
      <div className="card space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">Como funciona</h2>

        <ol className="space-y-2 text-sm text-slate-700">
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-marca-100 text-xs font-bold text-marca-700">1</span>
            <span>Compartís <b>este mismo enlace</b> con todos tus pacientes: por WhatsApp,
              en tu perfil de redes o donde quieras.</span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-marca-100 text-xs font-bold text-marca-700">2</span>
            <span>Al entrar, lo primero que se le pide es <b>su número de WhatsApp</b>.
              Después elige día y horario y carga nombre, apellido y DNI.</span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-marca-100 text-xs font-bold text-marca-700">3</span>
            <span>El turno aparece en tu agenda con ese número, y desde ahí podés
              <b> abrirle el chat</b> para confirmar, avisar una demora o reprogramar.</span>
          </li>
        </ol>

        <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          No hace falta que armes un enlace por paciente ni que consigas su número de antemano:
          lo carga cada uno al reservar.
        </p>
      </div>

      {/* ---------------------- Compartir por WhatsApp -------------------- */}
      <div className="card space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">Compartir</h2>
        <div className="flex flex-wrap gap-2">
          <a href={`https://wa.me/?text=${mensajeWhatsapp}`}
            target="_blank" rel="noreferrer" className="btn-exito">
            Enviar por WhatsApp
          </a>
          <button type="button" className="btn-secundario"
            onClick={() => copiar(mensajeSugerido, 'Mensaje')}>
            Copiar mensaje sugerido
          </button>
        </div>
        <p className="rounded-lg bg-slate-50 p-3 text-xs italic text-slate-600">
          &ldquo;{mensajeSugerido}&rdquo;
        </p>
      </div>

      {/* ---------------------- Confirmar regeneracion -------------------- */}
      <Modal abierto={confirmarRegenerar} onCerrar={() => setConfirmarRegenerar(false)}
        titulo="Regenerar el enlace">
        <div className="space-y-4">
          <Aviso tipo="alerta">
            El enlace actual va a dejar de funcionar. Si lo compartiste por WhatsApp o esta
            publicado en algun lado, tendras que volver a enviar el nuevo.
          </Aviso>
          <p className="text-sm text-slate-600">
            Como el enlace se arma con tu matricula y tu nombre, el nuevo sera el mismo con un
            numero al final (por ejemplo <code className="font-mono text-xs">...-2</code>).
            Los turnos ya reservados no se ven afectados.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secundario" onClick={() => setConfirmarRegenerar(false)}>
              Cancelar
            </button>
            <button type="button" className="btn-peligro" disabled={procesando} onClick={regenerar}>
              {procesando ? 'Regenerando...' : 'Regenerar'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
