/**
 * pages/auth/Registro.jsx
 * Alta de cuenta con dos variantes en un mismo formulario: paciente y medico
 * (tenant). Los campos especificos se muestran segun el rol elegido.
 */
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { inicioSegunRol } from '../../components/RutaProtegida';
import { catalogoApi } from '../../api/servicios';
import { Aviso, Campo } from '../../components/UI';
import { GENEROS } from '../../utils/tratamiento';

const FORM_INICIAL = {
  rol: 'paciente',
  nombre: '', apellido: '', email: '', telefono: '', password: '', password2: '',
  dni: '', fechaNacimiento: '',
  especialidadId: '', matricula: '', genero: '',
  precioConsulta: '', duracionTurnoMin: 30, porcentajeSena: 30,
};

export default function Registro() {
  const { registro, autenticado, rol } = useAuth();
  const navegar = useNavigate();

  const [form, setForm] = useState(FORM_INICIAL);
  const [especialidades, setEspecialidades] = useState([]);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    catalogoApi.especialidades().then(setEspecialidades).catch(() => setEspecialidades([]));
  }, []);

  if (autenticado) return <Navigate to={inicioSegunRol(rol)} replace />;

  const alCambiar = (e) => setForm({ ...form, [e.target.name]: e.target.value });
  const esMedico = form.rol === 'medico';

  const enviar = async (e) => {
    e.preventDefault();
    setError(null);

    if (form.password !== form.password2) {
      setError(new Error('Las contrasenas no coinciden'));
      return;
    }

    // Se arma el payload exacto que espera el backend segun el rol.
    const datos = {
      rol: form.rol,
      nombre: form.nombre,
      apellido: form.apellido,
      email: form.email,
      telefono: form.telefono || null,
      password: form.password,
      // El DNI lo cargan los dos roles: identifica al paciente y le arma el
      // enlace publico al medico (DNI + apellido + matricula).
      dni: form.dni.trim(),
      ...(esMedico
        ? {
            especialidadId: Number(form.especialidadId),
            matricula: form.matricula,
            genero: form.genero || null,
            precioConsulta: Number(form.precioConsulta || 0),
            duracionTurnoMin: Number(form.duracionTurnoMin),
            porcentajeSena: Number(form.porcentajeSena),
          }
        : {
            dni: form.dni,
            fechaNacimiento: form.fechaNacimiento || null,
          }),
    };

    setEnviando(true);
    try {
      const usuario = await registro(datos);
      navegar(inicioSegunRol(usuario.rol), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-marca-50 via-slate-50 to-slate-100 px-4 py-12">
      <div className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <Link to="/" className="inline-flex items-center gap-2">
            <span className="text-4xl">🩺</span>
            <span className="text-2xl font-bold text-slate-900">AgendaMed</span>
          </Link>
          <p className="mt-2 text-sm text-slate-600">Crea tu cuenta</p>
        </div>

        <div className="card space-y-5">
          {/* Selector de rol */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { valor: 'paciente', titulo: 'Soy paciente', detalle: 'Reservar turnos' },
              { valor: 'medico', titulo: 'Soy profesional', detalle: 'Gestionar mi agenda' },
            ].map((opcion) => (
              <button key={opcion.valor} type="button"
                onClick={() => setForm({ ...form, rol: opcion.valor })}
                className={`rounded-lg border-2 p-3 text-left transition ${
                  form.rol === opcion.valor
                    ? 'border-marca-600 bg-marca-50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}>
                <p className="text-sm font-semibold text-slate-900">{opcion.titulo}</p>
                <p className="text-xs text-slate-500">{opcion.detalle}</p>
              </button>
            ))}
          </div>

          {error && (
            <Aviso tipo="error" detalles={error.detalles} onCerrar={() => setError(null)}>
              {error.message}
            </Aviso>
          )}

          <form onSubmit={enviar} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo label="Nombre" requerido>
                <input name="nombre" value={form.nombre} onChange={alCambiar} className="input" required />
              </Campo>
              <Campo label="Apellido" requerido>
                <input name="apellido" value={form.apellido} onChange={alCambiar} className="input" required />
              </Campo>
              <Campo label="Email" requerido>
                <input type="email" name="email" value={form.email} onChange={alCambiar}
                  className="input" autoComplete="email" required />
              </Campo>
              <Campo label="Telefono">
                <input name="telefono" value={form.telefono} onChange={alCambiar} className="input" />
              </Campo>
              <Campo label="DNI" requerido
                ayuda={esMedico
                  ? 'Con tu DNI, apellido y matricula se arma tu enlace de turnos.'
                  : 'Es como te identifica el sistema al reservar.'}>
                <input name="dni" value={form.dni} onChange={alCambiar} inputMode="numeric"
                  className="input" placeholder="30123456" required />
              </Campo>
              {!esMedico && (
                <Campo label="Fecha de nacimiento">
                  <input type="date" name="fechaNacimiento" value={form.fechaNacimiento}
                    onChange={alCambiar} className="input" />
                </Campo>
              )}
            </div>

            {/* ------------------------- Campos de medico -------------------- */}
            {esMedico && (
              <div className="space-y-4 rounded-lg bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Datos profesionales
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo label="Especialidad" requerido>
                    <select name="especialidadId" value={form.especialidadId} onChange={alCambiar}
                      className="input" required>
                      <option value="">Seleccionar...</option>
                      {especialidades.map((e) => (
                        <option key={e.id} value={e.id}>{e.nombre}</option>
                      ))}
                    </select>
                  </Campo>
                  <Campo label="Matricula" requerido>
                    <input name="matricula" value={form.matricula} onChange={alCambiar}
                      className="input" placeholder="MP-12345" required />
                  </Campo>
                  <Campo label="Genero" ayuda="Define si el sistema te nombra Dr. o Dra.">
                    <select name="genero" value={form.genero} onChange={alCambiar} className="input">
                      <option value="">Prefiero no indicarlo</option>
                      {GENEROS.map((g) => (
                        <option key={g.valor} value={g.valor}>{g.etiqueta} ({g.titulo})</option>
                      ))}
                    </select>
                  </Campo>
                  <Campo label="Precio de la consulta" ayuda="Podes cambiarlo despues">
                    <input type="number" min="0" step="100" name="precioConsulta"
                      value={form.precioConsulta} onChange={alCambiar} className="input" placeholder="18000" />
                  </Campo>
                  <Campo label="Duracion del turno (min)">
                    <select name="duracionTurnoMin" value={form.duracionTurnoMin}
                      onChange={alCambiar} className="input">
                      {[15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutos</option>)}
                    </select>
                  </Campo>
                  <Campo label="Sena (%)" ayuda="Porcentaje que el paciente abona al reservar">
                    <input type="number" min="0" max="100" name="porcentajeSena"
                      value={form.porcentajeSena} onChange={alCambiar} className="input" />
                  </Campo>
                </div>
                <p className="text-xs text-slate-500">
                  El uso profesional requiere una suscripcion mensual que se abona desde tu panel.
                </p>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Campo label="Contrasena" requerido ayuda="Minimo 8 caracteres, con letras y numeros">
                <input type="password" name="password" value={form.password} onChange={alCambiar}
                  className="input" autoComplete="new-password" required />
              </Campo>
              <Campo label="Repetir contrasena" requerido>
                <input type="password" name="password2" value={form.password2} onChange={alCambiar}
                  className="input" autoComplete="new-password" required />
              </Campo>
            </div>

            <button type="submit" disabled={enviando} className="btn-primario w-full">
              {enviando ? 'Creando cuenta...' : 'Crear cuenta'}
            </button>
          </form>

          <p className="text-center text-sm text-slate-600">
            Ya tenes cuenta?{' '}
            <Link to="/login" className="font-medium text-marca-600 hover:text-marca-700">Ingresa</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
