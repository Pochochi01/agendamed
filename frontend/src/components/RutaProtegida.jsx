/**
 * components/RutaProtegida.jsx
 * Guarda de rutas por autenticacion y por rol.
 *
 * Es una barrera de UX, no de seguridad: la autorizacion real la hace el
 * backend en cada endpoint.
 */
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Cargando } from './UI';

/** Ruta de inicio segun el rol del usuario. */
export function inicioSegunRol(rol) {
  if (rol === 'admin') return '/admin';
  if (rol === 'medico') return '/medico';
  if (rol === 'paciente') return '/paciente';
  return '/';
}

export default function RutaProtegida({ roles }) {
  const { autenticado, rol, cargando } = useAuth();
  const ubicacion = useLocation();

  // Mientras se revalida el token no se decide nada (evita un flash al login).
  if (cargando) return <Cargando texto="Verificando sesion..." />;

  if (!autenticado) {
    return <Navigate to="/login" state={{ desde: ubicacion.pathname }} replace />;
  }

  if (roles && !roles.includes(rol)) {
    return <Navigate to={inicioSegunRol(rol)} replace />;
  }

  return <Outlet />;
}
