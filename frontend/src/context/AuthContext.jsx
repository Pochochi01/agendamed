/**
 * context/AuthContext.jsx
 * Estado global de sesion: usuario, token, login/registro/logout.
 *
 * El token vive en localStorage para sobrevivir al refresh; al montar, el
 * provider revalida contra /auth/perfil (si el token expiro, limpia todo).
 */
import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { authApi } from '../api/servicios';
import { TOKEN_KEY, USUARIO_KEY } from '../api/axios';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(() => {
    try {
      const guardado = localStorage.getItem(USUARIO_KEY);
      return guardado ? JSON.parse(guardado) : null;
    } catch {
      return null;
    }
  });
  const [cargando, setCargando] = useState(Boolean(localStorage.getItem(TOKEN_KEY)));

  /** Persiste (o limpia) la sesion en localStorage y en el estado. */
  const guardarSesion = useCallback((token, datosUsuario) => {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    if (datosUsuario) {
      localStorage.setItem(USUARIO_KEY, JSON.stringify(datosUsuario));
      setUsuario(datosUsuario);
    }
  }, []);

  const cerrarSesion = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USUARIO_KEY);
    setUsuario(null);
  }, []);

  // Revalidacion del token al montar la app.
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) { setCargando(false); return; }

    authApi.perfil()
      .then(({ usuario: fresco }) => guardarSesion(null, fresco))
      .catch(() => cerrarSesion())
      .finally(() => setCargando(false));
  }, [guardarSesion, cerrarSesion]);

  const login = useCallback(async (credenciales) => {
    const { token, usuario: datos } = await authApi.login(credenciales);
    guardarSesion(token, datos);
    return datos;
  }, [guardarSesion]);

  const registro = useCallback(async (datosRegistro) => {
    const { token, usuario: datos } = await authApi.registro(datosRegistro);
    guardarSesion(token, datos);
    return datos;
  }, [guardarSesion]);

  /** Refresca el usuario desde el backend (ej: tras editar el perfil). */
  const refrescar = useCallback(async () => {
    const { usuario: fresco } = await authApi.perfil();
    guardarSesion(null, fresco);
    return fresco;
  }, [guardarSesion]);

  const valor = useMemo(() => ({
    usuario,
    cargando,
    autenticado: Boolean(usuario),
    rol: usuario?.rol || null,
    login,
    registro,
    cerrarSesion,
    refrescar,
  }), [usuario, cargando, login, registro, cerrarSesion, refrescar]);

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>;
}

/** Hook de acceso al contexto. Falla claro si se usa fuera del provider. */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
