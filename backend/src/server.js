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

  /*
   * Chequeo de esquema: avisa si falta aplicar alguna migracion.
   * Evita que un despliegue con la base desactualizada falle mucho despues,
   * en medio de una operacion, con un error de MySQL dificil de interpretar
   * (fue el caso de ER_DATA_TOO_LONG en medicos.hash_publico).
   */
  await require('./config/verificarEsquema').verificarEImprimir();

  if (!mp.habilitado) {
    console.warn('[mercadopago] Sin MP_ACCESS_TOKEN: los pagos corren en modo SIMULADO');
  }

  /*
   * Aviso sobre la clave con la que se cifran las credenciales de MercadoPago
   * de cada profesional.
   *
   * Sin CRED_SECRET propia se usa JWT_SECRET (ver config/env.js). Eso anda,
   * pero acopla dos cosas que se rotan por motivos distintos: JWT_SECRET se
   * cambia para invalidar sesiones, y hacerlo dejaria los tokens guardados
   * imposibles de descifrar. Es un problema tipico al pasar a un servidor
   * nuevo, donde se genera un JWT_SECRET distinto y se restaura un dump con
   * las credenciales cifradas con el viejo: los pagos dejan de funcionar y el
   * error aparece recien cuando un paciente intenta abonar.
   *
   * Solo se avisa si efectivamente hay credenciales guardadas que perder.
   */
  if (!process.env.CRED_SECRET) {
    try {
      const { queryOne } = require('./config/db');
      const fila = await queryOne(
        'SELECT COUNT(*) AS n FROM medicos WHERE mp_access_token IS NOT NULL'
      );
      if (fila && Number(fila.n) > 0) {
        console.warn(
          `[seguridad] ${fila.n} profesional(es) tienen credenciales de MercadoPago guardadas, `
          + 'cifradas con JWT_SECRET porque no hay CRED_SECRET definida.'
        );
        console.warn(
          '[seguridad] Defini CRED_SECRET en el .env (y mantenela igual entre entornos): '
          + 'si cambia JWT_SECRET, esas credenciales dejan de poder descifrarse.'
        );
      }
    } catch {
      // Si la consulta falla no se frena el arranque: es solo un aviso.
    }
  }

  const servidor = app.listen(port, () => {
    console.log(`[api] AgendaMed escuchando en http://localhost:${port}/api (${nodeEnv})`);
  });

  /*
   * El servidor HTTP emite 'error' y, sin este manejador, Node lo convierte en
   * una excepcion no capturada: veinte lineas de stack trace de net.js que no
   * dicen que hacer. El caso habitual es EADDRINUSE, que casi nunca es un bug
   * sino otra instancia todavia corriendo (un nodemon anterior, una terminal
   * olvidada). Se traduce a un mensaje con el comando exacto para resolverlo.
   */
  servidor.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`\n[api] El puerto ${port} ya esta en uso.`);
      console.error('[api] Hay otra instancia de AgendaMed corriendo. Opciones:');
      console.error('[api]   1) Cerrala, o liberá el puerto:');
      console.error(`[api]      Windows: netstat -ano | findstr :${port}   y luego  taskkill /F /PID <pid>`);
      console.error(`[api]      Linux/Mac: lsof -ti:${port} | xargs kill -9`);
      console.error('[api]   2) O levantá esta en otro puerto:  PORT=4001 npm run dev\n');
    } else if (error.code === 'EACCES') {
      console.error(`\n[api] Sin permisos para usar el puerto ${port}.`);
      console.error('[api] Por debajo del 1024 hace falta root. Usa uno mas alto (PORT=4000).\n');
    } else {
      console.error('[api] No se pudo levantar el servidor:', error.message);
    }
    process.exit(1);
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
