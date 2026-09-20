/**
 * routes/transcripcion.routes.js   ->  /api/transcripcion
 *
 * UNICA ruta de toda la API que acepta multipart/form-data. El resto sigue
 * recibiendo solo JSON.
 *
 * El audio se recibe en memoria, se transcribe y se descarta: no se guarda en
 * disco ni en la base. Lo que se persiste es el texto, y por la ruta de
 * siempre (POST /pacientes/:id/historia), despues de que el medico lo revise.
 */
const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const ctrl = require('../controllers/transcripcion.controller');
const { recibirAudio } = require('../middlewares/audio.middleware');
const { autenticar, permitir, resolverTenant, exigirTenantActivo } = require('../middlewares/auth.middleware');
const asyncHandler = require('../utils/asyncHandler');

const router = Router();

router.use(autenticar, permitir('medico'), resolverTenant);

router.get('/estado', asyncHandler(ctrl.estado));

/**
 * Transcribir es caro: consume CPU del servidor (proveedor local) o dinero
 * por llamada (proveedor externo). Lleva su propio limite, mas estricto que
 * el general de la API.
 */
const limiteTranscripcion = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  // Se limita por MEDICO y no por IP: en un consultorio varios comparten la
  // misma IP de salida y no deberian quitarse cupo entre ellos.
  keyGenerator: (req) => `medico:${req.medico?.id || req.ip}`,
  message: {
    ok: false,
    mensaje: 'Demasiados dictados seguidos. Espera unos minutos.',
  },
});

router.post(
  '/',
  exigirTenantActivo,
  limiteTranscripcion,
  recibirAudio,                  // multer en memoria
  asyncHandler(ctrl.transcribir)
);

module.exports = router;
