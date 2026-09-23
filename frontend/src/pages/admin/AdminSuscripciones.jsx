/**
 * pages/admin/AdminSuscripciones.jsx
 * Control del canon mensual: generar el periodo, registrar pagos manuales y
 * suspender morosos en bloque.
 */
import { useCallback, useEffect, useState } from 'react';
import { suscripcionesApi } from '../../api/servicios';
import { Aviso, Cargando, SinDatos } from '../../components/UI';
import { fechaCorta, moneda, estiloEstadoPago } from '../../utils/formato';
import { nombreConTratamiento } from '../../utils/tratamiento';

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export default function AdminSuscripciones() {
  const [suscripciones, setSuscripciones] = useState([]);
  const [filtro, setFiltro] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [procesando, setProcesando] = useState(false);

  const cargar = useCallback(async (estado) => {
    setCargando(true);
    try {
      setSuscripciones(await suscripcionesApi.listar(estado ? { estado } : {}));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(filtro); }, [cargar, filtro]);

  /** Envuelve una accion del admin: bloquea el boton, avisa y recarga. */
  const ejecutar = async (accion) => {
    setProcesando(true);
    setError(null);
    try {
      const { mensaje } = await accion();
      setAviso(mensaje);
      await cargar(filtro);
    } catch (err) {
      setError(err);
    } finally {
      setProcesando(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Suscripciones</h1>
          <p className="text-sm text-slate-600">Canon mensual de los profesionales.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={procesando} className="btn-secundario"
            onClick={() => ejecutar(() => suscripcionesApi.generarPeriodo({}))}>
            Generar periodo actual
          </button>
          <button type="button" disabled={procesando} className="btn-peligro"
            onClick={() => ejecutar(suscripcionesApi.suspenderMorosos)}>
            Suspender morosos
          </button>
        </div>
      </header>

      {aviso && <Aviso tipo="exito" onCerrar={() => setAviso(null)}>{aviso}</Aviso>}
      {error && <Aviso tipo="error" onCerrar={() => setError(null)}>{error.message}</Aviso>}

      <div className="card space-y-4">
        <div className="flex gap-2">
          {[
            { valor: '', texto: 'Todas' },
            { valor: 'pendiente', texto: 'Pendientes' },
            { valor: 'pagada', texto: 'Pagadas' },
            { valor: 'vencida', texto: 'Vencidas' },
          ].map((op) => (
            <button key={op.valor} type="button" onClick={() => setFiltro(op.valor)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                filtro === op.valor ? 'bg-marca-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}>
              {op.texto}
            </button>
          ))}
        </div>

        {cargando ? (
          <Cargando />
        ) : suscripciones.length === 0 ? (
          <SinDatos icono="🧾" titulo="Sin suscripciones"
            descripcion="Genera el periodo del mes para que aparezcan los profesionales." />
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Profesional</th>
                  <th>Periodo</th>
                  <th>Monto</th>
                  <th>Estado</th>
                  <th>Pago</th>
                  <th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {suscripciones.map((s) => {
                  const estilo = estiloEstadoPago(s.estado);
                  return (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td>
                        <p className="font-medium text-slate-900">
                          {nombreConTratamiento(s)}
                        </p>
                        <p className="text-xs text-slate-500">{s.medico_email}</p>
                      </td>
                      <td>{MESES[s.mes]} {s.anio}</td>
                      <td>{moneda(s.monto)}</td>
                      <td><span className={estilo.clase}>{estilo.texto}</span></td>
                      <td className="text-xs text-slate-500">
                        {s.fecha_pago ? fechaCorta(s.fecha_pago) : '-'}
                        {s.mp_payment_id && <div className="text-slate-400">#{s.mp_payment_id}</div>}
                      </td>
                      <td className="text-right">
                        {s.estado !== 'pagada' ? (
                          <button type="button" disabled={procesando} className="btn-exito btn-sm"
                            onClick={() => ejecutar(() => suscripcionesApi.cambiarEstado(s.id, 'pagada'))}>
                            Marcar pagada
                          </button>
                        ) : (
                          <button type="button" disabled={procesando} className="btn-secundario btn-sm"
                            onClick={() => ejecutar(() => suscripcionesApi.cambiarEstado(s.id, 'pendiente'))}>
                            Revertir
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-500">
        Marcar una suscripcion como pagada rehabilita automaticamente al profesional suspendido.
      </p>
    </div>
  );
}
