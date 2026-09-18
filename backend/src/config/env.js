/**
 * config/env.js
 * Carga y valida las variables de entorno una sola vez al arrancar.
 * Si falta algo critico, el proceso muere temprano (fail fast) en vez de
 * fallar a mitad de una request.
 */
require('dotenv').config();

const requeridas = ['DB_HOST', 'DB_USER', 'DB_NAME', 'JWT_SECRET'];
const faltantes = requeridas.filter((k) => !process.env[k]);

if (faltantes.length) {
  // eslint-disable-next-line no-console
  console.error(`[env] Faltan variables obligatorias: ${faltantes.join(', ')}`);
  console.error('[env] Copia backend/.env.example a backend/.env y completalo.');
  process.exit(1);
}

module.exports = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',

  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },

  /**
   * Clave con la que se cifran las credenciales de MercadoPago de cada medico
   * (utils/cripto.js). Si no se define, se reutiliza JWT_SECRET; en ese caso
   * cambiar JWT_SECRET invalida los tokens guardados y los profesionales
   * tendran que volver a cargarlos. Para produccion conviene una propia.
   */
  credSecret: process.env.CRED_SECRET || process.env.JWT_SECRET,

  mercadopago: {
    accessToken: process.env.MP_ACCESS_TOKEN || '',
    publicKey: process.env.MP_PUBLIC_KEY || '',
    webhookUrl: process.env.MP_WEBHOOK_URL || '',
    // Permite levantar el proyecto sin credenciales reales (modo simulado)
    habilitado: Boolean(process.env.MP_ACCESS_TOKEN),
  },

  negocio: {
    suscripcionMonto: Number(process.env.SUSCRIPCION_MONTO || 15000),
    /**
     * Antelacion "recomendada" para cancelar. Ya NO bloquea: el paciente puede
     * cancelar cualquier turno vigente. Se usa solo para avisar que la
     * cancelacion es sobre la hora y para destacarla en el registro.
     */
    cancelacionHorasRecomendadas: Number(process.env.CANCELACION_HORAS_RECOMENDADAS || 24),
    /**
     * A partir de cuantas cancelaciones previas se marca al paciente en la
     * agenda del medico. El valor es "mas de N": con 2, se marca al tercer
     * turno tras dos cancelaciones.
     */
    cancelacionesAlerta: Number(process.env.CANCELACIONES_ALERTA || 2),
  },
};
