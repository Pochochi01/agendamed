/**
 * pages/auth/Login.jsx
 * Inicio de sesion. Tras autenticar redirige al panel que corresponde al rol
 * (o a la ruta desde la que el usuario fue interceptado por RutaProtegida).
 */
import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { inicioSegunRol } from '../../components/RutaProtegida';
import { Aviso, Campo } from '../../components/UI';

export default function Login() {
  const { login, autenticado, rol } = useAuth();
  const navegar = useNavigate();
  const ubicacion = useLocation();
  const [params] = useSearchParams();

  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  if (autenticado) return <Navigate to={inicioSegunRol(rol)} replace />;

  const alCambiar = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const enviar = async (e) => {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      const usuario = await login(form);
      navegar(ubicacion.state?.desde || inicioSegunRol(usuario.rol), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-marca-50 via-slate-50 to-slate-100 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link to="/" className="inline-flex items-center gap-2">
            <span className="text-4xl">🩺</span>
            <span className="text-2xl font-bold text-slate-900">AgendaMed</span>
          </Link>
          <p className="mt-2 text-sm text-slate-600">Ingresa a tu cuenta</p>
        </div>

        <div className="card space-y-4">
          {params.get('expirada') && (
            <Aviso tipo="alerta">Tu sesion expiro. Volve a ingresar.</Aviso>
          )}
          {error && (
            <Aviso tipo="error" detalles={error.detalles} onCerrar={() => setError(null)}>
              {error.message}
            </Aviso>
          )}

          <form onSubmit={enviar} className="space-y-4" noValidate>
            <Campo label="Email" requerido>
              <input type="email" name="email" value={form.email} onChange={alCambiar}
                className="input" placeholder="tu@email.com" autoComplete="email" required />
            </Campo>

            <Campo label="Contrasena" requerido>
              <input type="password" name="password" value={form.password} onChange={alCambiar}
                className="input" placeholder="********" autoComplete="current-password" required />
            </Campo>

            <button type="submit" disabled={enviando} className="btn-primario w-full">
              {enviando ? 'Ingresando...' : 'Ingresar'}
            </button>
          </form>

          <p className="text-center text-sm text-slate-600">
            No tenes cuenta?{' '}
            <Link to="/registro" className="font-medium text-marca-600 hover:text-marca-700">
              Registrate
            </Link>
          </p>
        </div>

        {/* Ayuda para probar el sistema con los datos del seed. */}
        <details className="mt-6 rounded-lg bg-white/70 p-4 text-xs text-slate-600 ring-1 ring-slate-200">
          <summary className="cursor-pointer font-medium text-slate-700">Cuentas de prueba</summary>
          <ul className="mt-2 space-y-1">
            <li><b>Admin:</b> admin@agendamed.com</li>
            <li><b>Medica:</b> dra.romero@agendamed.com</li>
            <li><b>Paciente:</b> paciente1@mail.com</li>
            <li className="pt-1 text-slate-500">Contrasena para todas: <b>Agenda2026</b></li>
          </ul>
        </details>
      </div>
    </div>
  );
}
