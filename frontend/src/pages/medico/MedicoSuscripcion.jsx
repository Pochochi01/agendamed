/**
 * pages/medico/MedicoSuscripcion.jsx
 * Estado de la suscripcion del profesional y pago del canon via MercadoPago.
 *
 * Si el backend corre sin credenciales de MercadoPago, la preferencia vuelve
 * con `simulado: true` y se ofrece acreditar el pago localmente para poder
 * recorrer el flujo completo en desarrollo.
 */
import { useCallback, useEffect, useState } from 'react';
import { suscripcionesApi, medicosApi } from '../../api/servicios';
import { Aviso, Cargando, SinDatos } from '../../components/UI';
import { fechaCorta, moneda, estiloEstadoPago } from '../../utils/formato';

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export default function MedicoSuscripcion() {
  const [datos, setDatos] = useState({ suscripciones: [], pendiente: null });
  const [medico, setMedico] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [procesando, setProcesando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [suscripciones, perfil] = await Promise.all([
        suscripcionesApi.mias(),
        medicosApi.miPerfil(),
      ]);
      setDatos(suscripciones);
      setMedico(perfil.medico);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const pagar = async (suscripcion) => {
    setProcesando(true);
    setError(null);
    try {
      const { checkout } = await suscripcionesApi.pagar(suscripcion.id);

      if (checkout.simulado) {
        await suscripcionesApi.confirmarSimulado(suscripcion.id);
        setAviso('Pago acreditado (modo simulado: MercadoPago no esta configurado).');
        await cargar();
      } else {
        // Checkout Pro: se sale del SPA hacia MercadoPago.
        window.location.href = checkout.initPoint;
      }
    } catch (err) {
      setError(err);
    } finally {
      setProcesando(false);
    }
  };

  if (cargando) return <Cargando texto="Cargando suscripcion..." />;

  const { suscripciones, pendiente } = datos;
  const suspendido = medico?.estado === 'suspendido';

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Mi suscripcion</h1>
        <p className="text-sm text-slate-600">Canon mensual para operar tu agenda en AgendaMed.</p>
      </header>

      {aviso && <Aviso tipo="exito" onCerrar={() => setAviso(null)}>{aviso}</Aviso>}
      {error && <Aviso tipo="error" onCerrar={() => setError(null)}>{error.message}</Aviso>}

      {suspendido && (
        <Aviso tipo="error">
          Tu cuenta esta suspendida: no aparecas en la busqueda publica ni podes modificar tu
          agenda. Regularizá el periodo pendiente para reactivarla automaticamente.
        </Aviso>
      )}

      {/* --------------------------- Periodo actual ----------------------- */}
      {pendiente ? (
        <div className="card border-l-4 border-l-amber-400">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Periodo pendiente
              </p>
              <p className="text-xl font-bold text-slate-900">
                {MESES[pendiente.mes]} {pendiente.anio}
              </p>
              <p className="text-sm text-slate-600">{moneda(pendiente.monto)}</p>
            </div>
            <button type="button" className="btn-primario" disabled={procesando}
              onClick={() => pagar(pendiente)}>
              {procesando ? 'Generando pago...' : 'Pagar con MercadoPago'}
            </button>
          </div>
        </div>
      ) : (
        <div className="card border-l-4 border-l-emerald-400">
          <p className="text-sm font-medium text-emerald-700">
            Tenes la suscripcion al dia. No hay periodos pendientes.
          </p>
        </div>
      )}

      {/* ----------------------------- Historial -------------------------- */}
      <div className="card">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Historial</h2>
        {suscripciones.length === 0 ? (
          <SinDatos icono="🧾" titulo="Sin movimientos"
            descripcion="Todavia no se genero ningun periodo para tu cuenta." />
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Periodo</th>
                  <th>Monto</th>
                  <th>Estado</th>
                  <th>Fecha de pago</th>
                </tr>
              </thead>
              <tbody>
                {suscripciones.map((s) => {
                  const estilo = estiloEstadoPago(s.estado);
                  return (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="font-medium text-slate-900">{MESES[s.mes]} {s.anio}</td>
                      <td>{moneda(s.monto)}</td>
                      <td><span className={estilo.clase}>{estilo.texto}</span></td>
                      <td className="text-slate-500">{s.fecha_pago ? fechaCorta(s.fecha_pago) : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
