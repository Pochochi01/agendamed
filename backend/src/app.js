/**
 * app.js
 * Instancia de Express: middlewares transversales, rutas y manejo de errores.
 * Se exporta sin escuchar el puerto para poder testearla por separado.
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { frontendUrl, nodeEnv } = require('./config/env');
const rutas = require('./routes');
const { noEncontrado, manejadorErrores } = require('./middlewares/error.middleware');

const app = express();

// Detras de un proxy/reverse-proxy (nginx, Railway) para que el rate limit
// lea la IP real del cliente.
app.set('trust proxy', 1);

// Cabeceras de seguridad (CSP, X-Frame-Options, HSTS, etc.).
app.use(helmet());

// CORS: en desarrollo se permite cualquier origen local; en produccion solo
// el dominio del frontend configurado.
app.use(cors({
  origin: nodeEnv === 'production' ? frontendUrl : true,
  credentials: true,
}));

// Limite de tamano: no hace falta mas para un JSON de este dominio.
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

app.use(morgan(nodeEnv === 'production' ? 'combined' : 'dev'));

// Freno general de abuso sobre toda la API.
app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, mensaje: 'Demasiadas solicitudes. Reintenta en un momento.' },
}));

app.use('/api', rutas);

// 404 y manejador central de errores (siempre al final).
app.use(noEncontrado);
app.use(manejadorErrores);

module.exports = app;
