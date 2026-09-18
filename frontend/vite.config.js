import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * El proxy evita problemas de CORS en desarrollo: el frontend llama a
 * /api/... en su propio origen y Vite lo reenvia al backend (puerto 4000).
 */
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        /**
         * El calendario (react-big-calendar + date-fns) pesa mas que todo el
         * resto de la app y solo lo usa el panel del medico. Se separa en su
         * propio chunk para que el paciente que entra por el enlace publico
         * no lo descargue.
         */
        manualChunks: {
          calendario: ['react-big-calendar', 'date-fns'],
          vendor: ['react', 'react-dom', 'react-router-dom', 'axios'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
