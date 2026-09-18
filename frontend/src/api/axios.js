/**
 * api/axios.js
 * Instancia unica de Axios para toda la app.
 *
 * - Interceptor de request: adjunta el JWT guardado en localStorage.
 * - Interceptor de response: normaliza el error del backend en un Error con
 *   `.mensaje` y `.detalles`, y cierra la sesion ante un 401.
 */
import axios from 'axios';

export const TOKEN_KEY = 'agendamed_token';
export const USUARIO_KEY = 'agendamed_usuario';

const api = axios.create({
  // En desarrollo Vite proxea /api al backend (ver vite.config.js).
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Sesion caida o token invalido: se limpia y se manda al login.
    if (error.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USUARIO_KEY);
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login?expirada=1';
      }
    }

    const data = error.response?.data;
    const normalizado = new Error(
      data?.mensaje || error.message || 'No se pudo conectar con el servidor'
    );
    normalizado.status = error.response?.status;
    normalizado.detalles = data?.detalles || [];
    return Promise.reject(normalizado);
  }
);

export default api;
