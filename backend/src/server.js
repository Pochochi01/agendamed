/**
 * server.js
 * Punto de entrada: valida la conexion a MySQL y levanta el servidor HTTP.
 */
const app = require('./app');
const { port, nodeEnv } = require('./config/env');
const { testConnection, pool } = require('./config/db');
const mp = require('./config/mercadopago');

(async () => {
  try {
    await testConnection();
    // eslint-disable-next-line no-console
    console.log('[db] Conexion a MySQL establecida');
  } catch (error) {
    console.error('[db] No se pudo conectar a MySQL:', error.message);
    console.error('[db] Revisa las credenciales del .env y que el servicio este levantado.');
    process.exit(1);
  }

  if (!mp.habilitado) {
    console.warn('[mercadopago] Sin MP_ACCESS_TOKEN: los pagos corren en modo SIMULADO');
  }

  const servidor = app.listen(port, () => {
    console.log(`[api] AgendaMed escuchando en http://localhost:${port}/api (${nodeEnv})`);
  });

  /** Cierre ordenado: deja de aceptar conexiones y libera el pool. */
  const apagar = async (senal) => {
    console.log(`\n[api] ${senal} recibido, cerrando...`);
    servidor.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => apagar('SIGTERM'));
  process.on('SIGINT', () => apagar('SIGINT'));
})();
