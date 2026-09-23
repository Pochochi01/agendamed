/**
 * pages/paciente/BuscarMedicos.jsx
 * Vista publica de profesionales: busqueda por nombre y filtro por
 * especialidad. Desde aca se entra al calendario de disponibilidad.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { medicosApi, catalogoApi } from '../../api/servicios';
import { Aviso, Cargando, SinDatos } from '../../components/UI';
import { moneda } from '../../utils/formato';
import { nombreConTratamiento } from '../../utils/tratamiento';

export default function BuscarMedicos() {
  const [medicos, setMedicos] = useState([]);
  const [especialidades, setEspecialidades] = useState([]);
  const [filtros, setFiltros] = useState({ q: '', especialidadId: '' });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    catalogoApi.especialidades().then(setEspecialidades).catch(() => setEspecialidades([]));
  }, []);

  // Debounce: una sola busqueda cuando el usuario deja de tipear.
  useEffect(() => {
    const id = setTimeout(async () => {
      setCargando(true);
      try {
        const params = {};
        if (filtros.q) params.q = filtros.q;
        if (filtros.especialidadId) params.especialidadId = filtros.especialidadId;
        setMedicos(await medicosApi.buscar(params));
        setError(null);
      } catch (err) {
        setError(err);
      } finally {
        setCargando(false);
      }
    }, 300);
    return () => clearTimeout(id);
  }, [filtros]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Buscar profesional</h1>
        <p className="text-sm text-slate-600">Elegi un especialista y reserva tu turno online.</p>
      </header>

      <div className="card">
        <div className="grid gap-3 sm:grid-cols-2">
          <input value={filtros.q} onChange={(e) => setFiltros({ ...filtros, q: e.target.value })}
            className="input" placeholder="Buscar por nombre o especialidad..." />
          <select value={filtros.especialidadId} className="input"
            onChange={(e) => setFiltros({ ...filtros, especialidadId: e.target.value })}>
            <option value="">Todas las especialidades</option>
            {especialidades.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </div>
      </div>

      {error && <Aviso tipo="error" onCerrar={() => setError(null)}>{error.message}</Aviso>}

      {cargando ? (
        <Cargando texto="Buscando profesionales..." />
      ) : medicos.length === 0 ? (
        <SinDatos icono="🔍" titulo="Sin resultados"
          descripcion="Proba con otra especialidad o revisa el texto de busqueda." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {medicos.map((m) => (
            <article key={m.id} className="card flex flex-col">
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-marca-100 text-lg font-semibold text-marca-700">
                  {m.nombre[0]}{m.apellido[0]}
                </div>
                <div className="min-w-0">
                  <h3 className="truncate font-semibold text-slate-900">
                    {nombreConTratamiento(m)}
                  </h3>
                  <p className="text-sm text-marca-600">{m.especialidad}</p>
                  <p className="text-xs text-slate-500">Mat. {m.matricula}</p>
                </div>
              </div>

              <dl className="mt-4 space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Consulta</dt>
                  <dd className="font-medium text-slate-900">{moneda(m.precio_consulta)}</dd>
                </div>
                {/* Solo tiene sentido hablar de sena si cobra online. */}
                <div className="flex justify-between">
                  <dt className="text-slate-500">Pago</dt>
                  <dd className="text-right text-slate-700">
                    {m.mercadopago_configurado
                      ? `Online - sena ${m.porcentaje_sena}%`
                      : 'En el consultorio'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Duracion</dt>
                  <dd className="text-slate-700">{m.duracion_turno_min} min</dd>
                </div>
              </dl>

              <Link to={`/paciente/reservar/${m.id}`} className="btn-primario mt-4 w-full">
                Ver disponibilidad
              </Link>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
