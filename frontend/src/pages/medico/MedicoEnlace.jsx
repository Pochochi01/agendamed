/**
 * pages/medico/MedicoEnlace.jsx
 * Enlace de agendamiento directo para compartir con los pacientes.
 *
 * El enlace admite el parametro ?wa=<numero>, que asocia la reserva a ese
 * WhatsApp. Como el navegador no puede leer el telefono del paciente, el
 * numero tiene que viajar en la URL: esta pantalla arma el enlace listo para
 * enviar y ofrece abrir el chat de WhatsApp directamente.
 */
import { useCallback, useEffect, useState } from 'react';
import { medicosApi } from '../../api/servicios';
import { Aviso, Cargando, Campo, Modal } from '../../components/UI';

/** Deja solo digitos: es lo que espera wa.me y el backend. */
const soloDigitos = (v) => String(v || '').replace(/\D/g, '');

export default function MedicoEnlace() {
  const [enlace, setEnlace] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [procesando, setProcesando] = useState(false);
  const [confirmarRegenerar, setConfirmarRegenerar] = useState(false);

  // Numero del paciente al que se le va a enviar el enlace.
  const [numero, setNumero] = useState('');

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

  const digitos = soloDigitos(numero);
  const enlaceParaPaciente = digitos ? `${enlace.url}?wa=${digitos}` : enlace.url;
  const mensajeWhatsapp = encodeURIComponent(
    `Hola! Podes reservar tu turno desde este enlace: ${enlaceParaPaciente}`
  );

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

      {/* --------------------- Enlace para un paciente -------------------- */}
      <div className="card space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Enlace para un paciente</h2>
          <p className="text-sm text-slate-600">
            Al agregar el numero, el turno queda asociado a ese WhatsApp automaticamente.
          </p>
        </div>

        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-700">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Por que hay que poner el numero
          </p>
          <p className="mt-1">
            El navegador del paciente no puede leer su propio telefono: ninguna pagina web accede
            a ese dato. Por eso el numero tiene que ir en el enlace. Cuando el paciente entra, lo
            ve cargado y bloqueado, sin poder cambiarlo.
          </p>
        </div>

        <Campo label="WhatsApp del paciente" ayuda="Con codigo de pais y area. Ej: 5493511234567">
          <input type="text" className="input font-mono" inputMode="numeric"
            value={numero} onChange={(e) => setNumero(e.target.value)}
            placeholder="5493511234567" />
        </Campo>

        {digitos.length >= 8 && (
          <>
            <div className="flex flex-wrap gap-2">
              <input type="text" readOnly value={enlaceParaPaciente}
                className="input flex-1 font-mono text-xs"
                onFocus={(e) => e.target.select()} />
              <button type="button" className="btn-secundario"
                onClick={() => copiar(enlaceParaPaciente, 'Enlace personalizado')}>
                Copiar
              </button>
            </div>

            <a href={`https://wa.me/${digitos}?text=${mensajeWhatsapp}`}
              target="_blank" rel="noreferrer" className="btn-exito">
              Enviar por WhatsApp
            </a>
          </>
        )}

        {numero && digitos.length < 8 && (
          <p className="text-xs text-amber-600">
            El numero parece incompleto: incluí codigo de pais y area.
          </p>
        )}
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
