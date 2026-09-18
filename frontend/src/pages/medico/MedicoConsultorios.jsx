/**
 * pages/medico/MedicoConsultorios.jsx
 * CRUD de consultorios del profesional.
 *
 * La localidad se elige del catalogo o se crea al vuelo enviando
 * localidad + provincia (el backend la normaliza en su tabla).
 */
import { useCallback, useEffect, useState } from 'react';
import { consultoriosApi, catalogoApi } from '../../api/servicios';
import { Aviso, Cargando, Campo, Modal, SinDatos } from '../../components/UI';

const FORM_INICIAL = {
  nombre: '', calle: '', numero: '', pisoDepto: '', telefono: '',
  localidadId: '', localidad: '', provincia: '', activo: 1,
};

export default function MedicoConsultorios() {
  const [consultorios, setConsultorios] = useState([]);
  const [localidades, setLocalidades] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);

  const [modalAbierto, setModalAbierto] = useState(false);
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState(FORM_INICIAL);
  const [nuevaLocalidad, setNuevaLocalidad] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [lista, cat] = await Promise.all([consultoriosApi.listar(), catalogoApi.localidades()]);
      setConsultorios(lista);
      setLocalidades(cat);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const alCambiar = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const abrirNuevo = () => {
    setEditando(null);
    setForm(FORM_INICIAL);
    setNuevaLocalidad(false);
    setError(null);
    setModalAbierto(true);
  };

  const abrirEdicion = (c) => {
    setEditando(c);
    setForm({
      nombre: c.nombre, calle: c.calle, numero: c.numero,
      pisoDepto: c.piso_depto || '', telefono: c.telefono || '',
      localidadId: c.localidad_id, localidad: '', provincia: '', activo: c.activo,
    });
    setNuevaLocalidad(false);
    setError(null);
    setModalAbierto(true);
  };

  const guardar = async (e) => {
    e.preventDefault();
    setError(null);
    setGuardando(true);

    const datos = {
      nombre: form.nombre,
      calle: form.calle,
      numero: form.numero,
      pisoDepto: form.pisoDepto || null,
      telefono: form.telefono || null,
      activo: Number(form.activo),
      ...(nuevaLocalidad
        ? { localidad: form.localidad, provincia: form.provincia }
        : { localidadId: Number(form.localidadId) }),
    };

    try {
      const { mensaje } = editando
        ? await consultoriosApi.actualizar(editando.id, datos)
        : await consultoriosApi.crear(datos);
      setAviso(mensaje);
      setModalAbierto(false);
      await cargar();
    } catch (err) {
      setError(err);
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = async (c) => {
    if (!window.confirm(`Eliminar el consultorio "${c.nombre}"?`)) return;
    try {
      const { mensaje } = await consultoriosApi.eliminar(c.id);
      setAviso(mensaje);
      await cargar();
    } catch (err) {
      setError(err);
    }
  };

  if (cargando) return <Cargando texto="Cargando consultorios..." />;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Consultorios</h1>
          <p className="text-sm text-slate-600">Lugares donde atendes. Cada horario se asigna a uno.</p>
        </div>
        <button type="button" className="btn-primario" onClick={abrirNuevo}>+ Nuevo consultorio</button>
      </header>

      {aviso && <Aviso tipo="exito" onCerrar={() => setAviso(null)}>{aviso}</Aviso>}
      {error && !modalAbierto && (
        <Aviso tipo="error" detalles={error.detalles} onCerrar={() => setError(null)}>{error.message}</Aviso>
      )}

      {consultorios.length === 0 ? (
        <SinDatos icono="🏥" titulo="Sin consultorios"
          descripcion="Carga tu primer consultorio para poder definir horarios y recibir turnos."
          accion={<button type="button" className="btn-primario" onClick={abrirNuevo}>Cargar consultorio</button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {consultorios.map((c) => (
            <div key={c.id} className={`card ${c.activo ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-slate-900">{c.nombre}</h3>
                <span className={c.activo ? 'badge-verde' : 'badge-gris'}>
                  {c.activo ? 'Activo' : 'Inactivo'}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-600">{c.direccion_completa}</p>
              {c.telefono && <p className="mt-1 text-sm text-slate-500">Tel: {c.telefono}</p>}
              <div className="mt-4 flex gap-2">
                <button type="button" className="btn-secundario btn-sm" onClick={() => abrirEdicion(c)}>
                  Editar
                </button>
                <button type="button" className="btn-peligro btn-sm" onClick={() => eliminar(c)}>
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---------------------------- Formulario -------------------------- */}
      <Modal abierto={modalAbierto} onCerrar={() => setModalAbierto(false)}
        titulo={editando ? 'Editar consultorio' : 'Nuevo consultorio'}>
        <form onSubmit={guardar} className="space-y-4">
          {error && (
            <Aviso tipo="error" detalles={error.detalles} onCerrar={() => setError(null)}>
              {error.message}
            </Aviso>
          )}

          <Campo label="Nombre" requerido>
            <input name="nombre" value={form.nombre} onChange={alCambiar}
              className="input" placeholder="Centro Medico Norte" required />
          </Campo>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Campo label="Calle" requerido>
                <input name="calle" value={form.calle} onChange={alCambiar} className="input" required />
              </Campo>
            </div>
            <Campo label="Numero" requerido>
              <input name="numero" value={form.numero} onChange={alCambiar} className="input" required />
            </Campo>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Campo label="Piso / Depto">
              <input name="pisoDepto" value={form.pisoDepto} onChange={alCambiar}
                className="input" placeholder="Piso 3 Of. B" />
            </Campo>
            <Campo label="Telefono">
              <input name="telefono" value={form.telefono} onChange={alCambiar} className="input" />
            </Campo>
          </div>

          {/* Localidad: del catalogo o nueva */}
          {!nuevaLocalidad ? (
            <Campo label="Localidad" requerido>
              <select name="localidadId" value={form.localidadId} onChange={alCambiar}
                className="input" required>
                <option value="">Seleccionar...</option>
                {localidades.map((l) => (
                  <option key={l.id} value={l.id}>{l.nombre} ({l.provincia})</option>
                ))}
              </select>
              <button type="button" onClick={() => setNuevaLocalidad(true)}
                className="mt-1 text-xs font-medium text-marca-600 hover:underline">
                No esta en la lista? Agregar otra
              </button>
            </Campo>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Localidad" requerido>
                <input name="localidad" value={form.localidad} onChange={alCambiar} className="input" required />
              </Campo>
              <Campo label="Provincia" requerido>
                <input name="provincia" value={form.provincia} onChange={alCambiar} className="input" required />
                <button type="button" onClick={() => setNuevaLocalidad(false)}
                  className="mt-1 text-xs font-medium text-marca-600 hover:underline">
                  Elegir de la lista
                </button>
              </Campo>
            </div>
          )}

          {editando && (
            <Campo label="Estado">
              <select name="activo" value={form.activo} onChange={alCambiar} className="input">
                <option value={1}>Activo</option>
                <option value={0}>Inactivo (no genera turnos)</option>
              </select>
            </Campo>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secundario" onClick={() => setModalAbierto(false)}>
              Cancelar
            </button>
            <button type="submit" className="btn-primario" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
