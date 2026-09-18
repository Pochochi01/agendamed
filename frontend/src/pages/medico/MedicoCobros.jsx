/**
 * pages/medico/MedicoCobros.jsx
 * Conexion de la cuenta de MercadoPago DEL PROFESIONAL.
 *
 * El dinero de las consultas va a su cuenta, no a la de la plataforma. Por eso
 * cada medico carga aca su propio Access Token, que el backend verifica contra
 * MercadoPago y guarda cifrado.
 *
 * Mientras no haya credenciales, el profesional no ofrece pago online: sus
 * turnos se confirman directamente al reservarse y se abonan en el consultorio.
 */
import { useCallback, useEffect, useState } from 'react';
import { medicosApi } from '../../api/servicios';
import { Aviso, Cargando, Campo, Modal } from '../../components/UI';

export default function MedicoCobros() {
  const [estado, setEstado] = useState({ configurado: false, esPrueba: null, publicKey: null });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);

  const [form, setForm] = useState({ accessToken: '', publicKey: '' });
  const [guardando, setGuardando] = useState(false);
  const [cuenta, setCuenta] = useState(null);
  const [confirmarBaja, setConfirmarBaja] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setEstado(await medicosApi.estadoMercadoPago());
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const conectar = async (e) => {
    e.preventDefault();
    setError(null);
    setGuardando(true);
    try {
      const respuesta = await medicosApi.conectarMercadoPago({
        accessToken: form.accessToken.trim(),
        publicKey: form.publicKey.trim() || null,
      });
      setCuenta(respuesta.cuenta);
      setAviso(respuesta.mensaje);
      setForm({ accessToken: '', publicKey: '' }); // no se conserva el secreto
      await cargar();
    } catch (err) {
      setError(err);
    } finally {
      setGuardando(false);
    }
  };

  const desconectar = async () => {
    setGuardando(true);
    try {
      const { mensaje } = await medicosApi.desconectarMercadoPago();
      setAviso(mensaje);
      setCuenta(null);
      setConfirmarBaja(false);
      await cargar();
    } catch (err) {
      setError(err);
    } finally {
      setGuardando(false);
    }
  };

  if (cargando) return <Cargando texto="Cargando configuracion de cobros..." />;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Cobros online</h1>
        <p className="text-sm text-slate-600">
          Conecta tu cuenta de MercadoPago para cobrar la sena o el total de tus consultas.
        </p>
      </header>

      {aviso && <Aviso tipo="exito" onCerrar={() => setAviso(null)}>{aviso}</Aviso>}
      {error && (
        <Aviso tipo="error" detalles={error.detalles} onCerrar={() => setError(null)}>
          {error.message}
        </Aviso>
      )}

      {/* ------------------------- Estado actual -------------------------- */}
      <div className={`card border-l-4 ${estado.configurado ? 'border-l-emerald-400' : 'border-l-slate-300'}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className={estado.configurado ? 'badge-verde' : 'badge-gris'}>
              {estado.configurado ? 'Cobro online activo' : 'Sin cobro online'}
            </span>
            <h2 className="mt-2 text-lg font-semibold text-slate-900">
              {estado.configurado
                ? 'Tus pacientes pueden pagar al reservar'
                : 'Tus turnos se confirman sin pago'}
            </h2>
            <p className="mt-1 max-w-xl text-sm text-slate-600">
              {estado.configurado
                ? 'Al reservar, el paciente elige pagar la sena o el total. El dinero se acredita directamente en tu cuenta de MercadoPago.'
                : 'Al reservar, el paciente solo confirma el turno y abona en el consultorio. No se le pide ningun pago online.'}
            </p>
          </div>

          {estado.configurado && (
            <button type="button" className="btn-peligro btn-sm" onClick={() => setConfirmarBaja(true)}>
              Desconectar
            </button>
          )}
        </div>

        {estado.configurado && estado.esPrueba && (
          <div className="mt-4">
            <Aviso tipo="alerta">
              Estas usando credenciales de <b>PRUEBA</b> (empiezan con TEST-). Los pagos no son
              reales. Cargá las de produccion cuando quieras empezar a cobrar de verdad.
            </Aviso>
          </div>
        )}

        {cuenta && (
          <dl className="mt-4 space-y-1 rounded-lg bg-slate-50 p-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Cuenta</dt>
              <dd className="font-medium text-slate-900">{cuenta.nickname || cuenta.id}</dd>
            </div>
            {cuenta.email && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Email</dt>
                <dd className="text-slate-700">{cuenta.email}</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      {/* --------------------------- Formulario --------------------------- */}
      <div className="card">
        <h2 className="text-base font-semibold text-slate-900">
          {estado.configurado ? 'Reemplazar credenciales' : 'Conectar mi cuenta'}
        </h2>

        <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-700">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Donde consigo estos datos
          </p>
          <ol className="mt-2 list-inside list-decimal space-y-1">
            <li>Entra a <b>mercadopago.com.ar/developers</b> con tu cuenta.</li>
            <li>Andá a <b>Tus integraciones</b> y creá una aplicacion (o abri una existente).</li>
            <li>En <b>Credenciales</b>, copia el <b>Access Token</b>.</li>
          </ol>
          <p className="mt-2 text-xs text-slate-500">
            Para probar sin dinero real, usá las credenciales de prueba (empiezan con TEST-).
          </p>
        </div>

        <form onSubmit={conectar} className="mt-4 space-y-4">
          <Campo label="Access Token" requerido
            ayuda="Se guarda cifrado y no vuelve a mostrarse. Nunca lo compartas por otro medio.">
            <input type="password" className="input" autoComplete="off"
              value={form.accessToken}
              onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
              placeholder="APP_USR-0000000000000000-000000-..." required />
          </Campo>

          <Campo label="Public Key" ayuda="Opcional. Solo hace falta para el checkout embebido.">
            <input type="text" className="input" autoComplete="off"
              value={form.publicKey}
              onChange={(e) => setForm({ ...form, publicKey: e.target.value })}
              placeholder="APP_USR-00000000-0000-0000-0000-000000000000" />
          </Campo>

          <button type="submit" className="btn-primario" disabled={guardando || !form.accessToken.trim()}>
            {guardando ? 'Verificando con MercadoPago...' : 'Conectar cuenta'}
          </button>

          <p className="text-xs text-slate-500">
            Antes de guardar, verificamos el token contra MercadoPago para que no quede
            una credencial con un error de tipeo.
          </p>
        </form>
      </div>

      {/* --------------------- Confirmacion de desconexion ---------------- */}
      <Modal abierto={confirmarBaja} onCerrar={() => setConfirmarBaja(false)} titulo="Desconectar MercadoPago">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Si desconectas tu cuenta, los pacientes dejaran de poder pagar online. Los turnos
            nuevos se confirmaran directamente al reservarse y se abonaran en el consultorio.
          </p>
          <Aviso tipo="alerta">
            Los pagos ya acreditados no se ven afectados y siguen figurando en tu historial.
          </Aviso>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secundario" onClick={() => setConfirmarBaja(false)}>
              Cancelar
            </button>
            <button type="button" className="btn-peligro" disabled={guardando} onClick={desconectar}>
              {guardando ? 'Desconectando...' : 'Desconectar'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
