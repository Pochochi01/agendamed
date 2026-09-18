/**
 * pages/admin/AdminMedicos.jsx
 * CRUD de profesionales del Administrador General.
 *
 * Hay DOS formas de dar de baja, deliberadamente separadas:
 *
 *   Suspender (reversible)  -> el medico sale de la busqueda publica y pierde
 *                              el acceso, pero se conserva todo. Es lo que
 *                              corresponde ante una mora o una baja temporal.
 *   Eliminar (definitivo)   -> borra el profesional, su usuario, consultorios,
 *                              horarios, turnos, pagos y suscripciones. No
 *                              tiene vuelta atras: antes de confirmar se
 *                              muestra el alcance y se exige repetir el email.
 */
import { useCallback, useEffect, useState } from 'react';
import { medicosApi, catalogoApi } from '../../api/servicios';
import { Aviso, Cargando, Campo, Metrica, Modal, SinDatos } from '../../components/UI';
import { fechaCorta, moneda, estiloEstadoPago } from '../../utils/formato';

const FORM_INICIAL = {
  nombre: '', apellido: '', email: '', telefono: '', password: '',
  especialidadId: '', matricula: '',
  duracionTurnoMin: 30, precioConsulta: '', porcentajeSena: 30,
};

export default function AdminMedicos() {
  const [datos, setDatos] = useState({ medicos: [], estadisticas: null });
  const [especialidades, setEspecialidades] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [procesando, setProcesando] = useState(false);

  // Alta / edicion
  const [formAbierto, setFormAbierto] = useState(false);
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState(FORM_INICIAL);

  // Suspension / habilitacion
  const [confirmarEstado, setConfirmarEstado] = useState(null);

  // Eliminacion definitiva
  const [aEliminar, setAEliminar] = useState(null);   // { medico, impacto, confirmacionRequerida }
  const [textoConfirmacion, setTextoConfirmacion] = useState('');

  const cargar = useCallback(async (q = '') => {
    setCargando(true);
    try {
      setDatos(await medicosApi.listarAdmin(q ? { q } : {}));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    catalogoApi.especialidades().then(setEspecialidades).catch(() => setEspecialidades([]));
  }, []);

  // Busqueda con debounce para no disparar una request por tecla.
  useEffect(() => {
    const id = setTimeout(() => cargar(busqueda), 350);
    return () => clearTimeout(id);
  }, [busqueda, cargar]);

  const alCambiar = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  /* ----------------------------- Alta / edicion ------------------------- */

  const abrirAlta = () => {
    setEditando(null);
    setForm(FORM_INICIAL);
    setError(null);
    setFormAbierto(true);
  };

  const abrirEdicion = (m) => {
    setEditando(m);
    setForm({
      nombre: m.nombre, apellido: m.apellido, email: m.email, telefono: m.telefono || '',
      password: '', // vacio = no se toca la contrasena
      especialidadId: m.especialidad_id, matricula: m.matricula,
      duracionTurnoMin: m.duracion_turno_min,
      precioConsulta: m.precio_consulta,
      porcentajeSena: m.porcentaje_sena,
    });
    setError(null);
    setFormAbierto(true);
  };

  const guardar = async (e) => {
    e.preventDefault();
    setError(null);
    setProcesando(true);

    const payload = {
      nombre: form.nombre,
      apellido: form.apellido,
      email: form.email,
      telefono: form.telefono || null,
      especialidadId: Number(form.especialidadId),
      matricula: form.matricula,
      duracionTurnoMin: Number(form.duracionTurnoMin),
      precioConsulta: Number(form.precioConsulta || 0),
      porcentajeSena: Number(form.porcentajeSena),
      // En la edicion solo se manda si el admin quiere resetearla.
      ...(form.password ? { password: form.password } : {}),
    };

    try {
      const { mensaje } = editando
        ? await medicosApi.actualizar(editando.id, payload)
        : await medicosApi.crear(payload);
      setAviso(mensaje);
      setFormAbierto(false);
      await cargar(busqueda);
    } catch (err) {
      setError(err);
    } finally {
      setProcesando(false);
    }
  };

  /* --------------------------- Cambio de estado ------------------------- */

  const aplicarCambioEstado = async () => {
    setProcesando(true);
    try {
      const { mensaje } = await medicosApi.cambiarEstado(
        confirmarEstado.medico.id, confirmarEstado.nuevoEstado
      );
      setAviso(mensaje);
      setConfirmarEstado(null);
      await cargar(busqueda);
    } catch (err) {
      setError(err);
    } finally {
      setProcesando(false);
    }
  };

  /* ------------------------ Eliminacion definitiva ---------------------- */

  /** Consulta el alcance antes de mostrar la confirmacion. */
  const abrirEliminacion = async (m) => {
    setError(null);
    setTextoConfirmacion('');
    setAEliminar({ cargando: true, medico: m });
    try {
      const datosImpacto = await medicosApi.impactoEliminacion(m.id);
      setAEliminar({ ...datosImpacto, medico: m });
    } catch (err) {
      setError(err);
      setAEliminar(null);
    }
  };

  const eliminarDefinitivo = async () => {
    setProcesando(true);
    try {
      const respuesta = await medicosApi.eliminar(aEliminar.medico.id, textoConfirmacion.trim());
      const b = respuesta.borradas;
      setAviso(
        `${respuesta.mensaje}. Se borraron ${b.turnos} turno(s), ${b.pagos} pago(s), ` +
        `${b.consultorios} consultorio(s), ${b.horarios} horario(s) y ${b.suscripciones} suscripcion(es).`
      );
      setAEliminar(null);
      setTextoConfirmacion('');
      await cargar(busqueda);
    } catch (err) {
      setError(err);
    } finally {
      setProcesando(false);
    }
  };

  const { medicos, estadisticas } = datos;
  // El boton de borrado se habilita solo cuando el email coincide.
  const confirmacionValida = aEliminar && !aEliminar.cargando
    && textoConfirmacion.trim().toLowerCase() === String(aEliminar.confirmacionRequerida).toLowerCase();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Medicos</h1>
          <p className="text-sm text-slate-600">
            Alta, edicion, suspension y eliminacion de profesionales.
          </p>
        </div>
        <button type="button" className="btn-primario" onClick={abrirAlta}>
          + Nuevo medico
        </button>
      </header>

      {estadisticas && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metrica titulo="Medicos" valor={estadisticas.total_medicos} icono="👨‍⚕️" />
          <Metrica titulo="Activos" valor={estadisticas.medicos_activos} icono="✅" color="verde" />
          <Metrica titulo="Suspendidos" valor={estadisticas.medicos_suspendidos} icono="⛔" color="rojo" />
          <Metrica titulo="Pacientes" valor={estadisticas.total_pacientes} icono="🧑" />
        </div>
      )}

      {aviso && <Aviso tipo="exito" onCerrar={() => setAviso(null)}>{aviso}</Aviso>}
      {error && !formAbierto && !aEliminar && (
        <Aviso tipo="error" detalles={error.detalles} onCerrar={() => setError(null)}>
          {error.message}
        </Aviso>
      )}

      <div className="card space-y-4">
        <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
          className="input sm:max-w-xs" placeholder="Buscar por nombre o especialidad..." />

        {cargando ? (
          <Cargando />
        ) : medicos.length === 0 ? (
          <SinDatos icono="🔍" titulo="Sin resultados"
            descripcion={busqueda
              ? 'No hay medicos que coincidan con la busqueda.'
              : 'Todavia no hay profesionales cargados.'}
            accion={!busqueda && (
              <button type="button" className="btn-primario" onClick={abrirAlta}>
                Cargar el primero
              </button>
            )} />
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Profesional</th>
                  <th>Especialidad</th>
                  <th>Matricula</th>
                  <th>Consulta</th>
                  <th>Suscripcion</th>
                  <th>Estado</th>
                  <th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {medicos.map((m) => {
                  const sus = m.suscripcion;
                  const estiloSus = sus ? estiloEstadoPago(sus.estado) : null;
                  const activo = m.estado === 'activo';

                  return (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td>
                        <p className="font-medium text-slate-900">
                          Dr/a. {m.apellido}, {m.nombre}
                        </p>
                        <p className="text-xs text-slate-500">{m.email}</p>
                        {m.telefono && <p className="text-xs text-slate-400">{m.telefono}</p>}
                      </td>
                      <td>{m.especialidad}</td>
                      <td className="text-slate-500">{m.matricula}</td>
                      <td>
                        {moneda(m.precio_consulta)}
                        <span className="block text-xs text-slate-400">
                          {m.mercadopago_configurado ? 'cobra online' : 'sin cobro online'}
                        </span>
                      </td>
                      <td>
                        {sus ? (
                          <div>
                            <span className={estiloSus.clase}>{estiloSus.texto}</span>
                            <p className="mt-0.5 text-xs text-slate-500">
                              {String(sus.mes).padStart(2, '0')}/{sus.anio}
                              {sus.fecha_pago ? ` - ${fechaCorta(sus.fecha_pago)}` : ''}
                            </p>
                          </div>
                        ) : (
                          <span className="badge-gris">Sin periodo</span>
                        )}
                      </td>
                      <td>
                        <span className={activo ? 'badge-verde' : 'badge-rojo'}>
                          {activo ? 'Habilitado' : 'Suspendido'}
                        </span>
                      </td>
                      <td>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <button type="button" className="btn-secundario btn-sm"
                            onClick={() => abrirEdicion(m)}>
                            Editar
                          </button>
                          <button type="button"
                            className={activo ? 'btn-secundario btn-sm' : 'btn-exito btn-sm'}
                            onClick={() => setConfirmarEstado({
                              medico: m, nuevoEstado: activo ? 'suspendido' : 'activo',
                            })}>
                            {activo ? 'Suspender' : 'Habilitar'}
                          </button>
                          <button type="button" className="btn-peligro btn-sm"
                            onClick={() => abrirEliminacion(m)}>
                            Eliminar
                          </button>
                        </div>
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
        <b>Suspender</b> es reversible y conserva todos los datos. <b>Eliminar</b> es definitivo
        y borra tambien turnos, pagos e historial del profesional.
      </p>

      {/* ======================= Alta / edicion ========================== */}
      <Modal abierto={formAbierto} onCerrar={() => setFormAbierto(false)} ancho="max-w-2xl"
        titulo={editando ? `Editar Dr/a. ${editando.apellido}` : 'Nuevo medico'}>
        <form onSubmit={guardar} className="space-y-4">
          {error && (
            <Aviso tipo="error" detalles={error.detalles} onCerrar={() => setError(null)}>
              {error.message}
            </Aviso>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo label="Nombre" requerido>
              <input name="nombre" value={form.nombre} onChange={alCambiar} className="input" required />
            </Campo>
            <Campo label="Apellido" requerido>
              <input name="apellido" value={form.apellido} onChange={alCambiar} className="input" required />
            </Campo>
            <Campo label="Email" requerido ayuda="Es el usuario con el que inicia sesion.">
              <input type="email" name="email" value={form.email} onChange={alCambiar}
                className="input" required />
            </Campo>
            <Campo label="Telefono">
              <input name="telefono" value={form.telefono} onChange={alCambiar} className="input" />
            </Campo>
          </div>

          <div className="space-y-4 rounded-lg bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Datos profesionales
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo label="Especialidad" requerido>
                <select name="especialidadId" value={form.especialidadId} onChange={alCambiar}
                  className="input" required>
                  <option value="">Seleccionar...</option>
                  {especialidades.map((es) => (
                    <option key={es.id} value={es.id}>{es.nombre}</option>
                  ))}
                </select>
              </Campo>
              <Campo label="Matricula" requerido>
                <input name="matricula" value={form.matricula} onChange={alCambiar}
                  className="input" placeholder="MP-12345" required />
              </Campo>
              <Campo label="Precio de la consulta">
                <input type="number" min="0" step="100" name="precioConsulta"
                  value={form.precioConsulta} onChange={alCambiar} className="input" placeholder="18000" />
              </Campo>
              <Campo label="Duracion del turno (min)">
                <select name="duracionTurnoMin" value={form.duracionTurnoMin}
                  onChange={alCambiar} className="input">
                  {[15, 20, 30, 45, 60].map((min) => (
                    <option key={min} value={min}>{min} minutos</option>
                  ))}
                </select>
              </Campo>
              <Campo label="Sena (%)">
                <input type="number" min="0" max="100" name="porcentajeSena"
                  value={form.porcentajeSena} onChange={alCambiar} className="input" />
              </Campo>
            </div>
            <p className="text-xs text-slate-500">
              El profesional conecta su propia cuenta de MercadoPago desde su panel.
            </p>
          </div>

          <Campo label={editando ? 'Nueva contrasena' : 'Contrasena'} requerido={!editando}
            ayuda={editando
              ? 'Dejala vacia para no modificarla. Si la completas, se resetea.'
              : 'Minimo 8 caracteres, con letras y numeros.'}>
            <input type="password" name="password" value={form.password} onChange={alCambiar}
              className="input" autoComplete="new-password" required={!editando} />
          </Campo>

          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secundario" onClick={() => setFormAbierto(false)}>
              Cancelar
            </button>
            <button type="submit" className="btn-primario" disabled={procesando}>
              {procesando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Crear medico'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ==================== Suspender / habilitar ====================== */}
      <Modal abierto={Boolean(confirmarEstado)} onCerrar={() => setConfirmarEstado(null)}
        titulo={confirmarEstado?.nuevoEstado === 'activo' ? 'Habilitar medico' : 'Suspender medico'}>
        {confirmarEstado && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              {confirmarEstado.nuevoEstado === 'activo' ? (
                <>
                  <b>Dr/a. {confirmarEstado.medico.apellido}</b> volvera a aparecer en la busqueda
                  publica y podra recibir turnos y operar su agenda.
                </>
              ) : (
                <>
                  <b>Dr/a. {confirmarEstado.medico.apellido}</b> dejara de aparecer en la busqueda
                  publica, no podra iniciar sesion ni recibir turnos nuevos. Los turnos ya
                  reservados se mantienen y deben gestionarse aparte.
                </>
              )}
            </p>
            <Aviso tipo="info">Es reversible: no se pierde ningun dato.</Aviso>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secundario" onClick={() => setConfirmarEstado(null)}>
                Cancelar
              </button>
              <button type="button" disabled={procesando} onClick={aplicarCambioEstado}
                className={confirmarEstado.nuevoEstado === 'activo' ? 'btn-exito' : 'btn-peligro'}>
                {procesando ? 'Aplicando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ==================== Eliminacion definitiva ===================== */}
      <Modal abierto={Boolean(aEliminar)} onCerrar={() => setAEliminar(null)} ancho="max-w-xl"
        titulo="Eliminar definitivamente">
        {aEliminar?.cargando ? (
          <Cargando texto="Calculando que datos se van a borrar..." />
        ) : aEliminar && (
          <div className="space-y-4">
            <Aviso tipo="error">
              Esta accion es <b>irreversible</b>. Si solo queres darlo de baja temporalmente,
              usa <b>Suspender</b>: conserva todos los datos y se puede revertir.
            </Aviso>

            <div>
              <p className="font-semibold text-slate-900">
                Dr/a. {aEliminar.medico.apellido}, {aEliminar.medico.nombre}
              </p>
              <p className="text-sm text-slate-500">
                {aEliminar.medico.email} - {aEliminar.medico.especialidad}
              </p>
            </div>

            {/* Alcance real del borrado, calculado en el servidor. */}
            <div className="rounded-lg bg-rose-500/10 p-3 ring-1 ring-inset ring-rose-200">
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-800">
                Se va a borrar
              </p>
              <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-700">
                <li>{aEliminar.impacto.consultorios} consultorio(s)</li>
                <li>{aEliminar.impacto.horarios} horario(s)</li>
                <li>{aEliminar.impacto.turnos} turno(s)</li>
                <li>{aEliminar.impacto.pagos} pago(s)</li>
                <li>{aEliminar.impacto.suscripciones} suscripcion(es)</li>
                <li>La cuenta de acceso</li>
              </ul>

              {Number(aEliminar.impacto.turnos_futuros) > 0 && (
                <p className="mt-2 text-sm font-semibold text-rose-800">
                  Atencion: hay {aEliminar.impacto.turnos_futuros} turno(s) futuro(s) vigente(s)
                  de {aEliminar.impacto.pacientes_afectados} paciente(s). Se cancelaran sin aviso.
                </p>
              )}
              {Number(aEliminar.impacto.monto_acreditado) > 0 && (
                <p className="mt-1 text-sm font-semibold text-rose-800">
                  Se pierde el registro de {moneda(aEliminar.impacto.monto_acreditado)} en pagos
                  acreditados. Los reintegros, si corresponden, hay que gestionarlos antes.
                </p>
              )}
            </div>

            <Campo label="Para confirmar, escribi el email del profesional" requerido>
              <input type="text" className="input font-mono" autoComplete="off"
                value={textoConfirmacion}
                onChange={(e) => setTextoConfirmacion(e.target.value)}
                placeholder={aEliminar.confirmacionRequerida} />
            </Campo>

            {error && (
              <Aviso tipo="error" detalles={error.detalles} onCerrar={() => setError(null)}>
                {error.message}
              </Aviso>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secundario" onClick={() => setAEliminar(null)}>
                Cancelar
              </button>
              <button type="button" className="btn-peligro"
                disabled={procesando || !confirmacionValida}
                onClick={eliminarDefinitivo}>
                {procesando ? 'Eliminando...' : 'Eliminar definitivamente'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
