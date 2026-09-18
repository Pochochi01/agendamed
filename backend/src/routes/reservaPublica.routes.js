/**
 * routes/reservaPublica.routes.js   ->  /api/reservar
 *
 * Router PUBLICO: no lleva autenticar(). Es el que consume la pagina
 * /reservar/:hash a la que el paciente entra desde el enlace de WhatsApp.
 *
 * Al ser publico y hacer escrituras, tiene su propio rate limit mas estricto
 * que el general de la API: sin sesion no hay a quien atribuir el abuso, asi
 * que se limita por IP.
 */
const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const ctrl = require('../controllers/reservaPublica.controller');
const v = require('../validators');
const validate = require('../middlewares/validate.middleware');
const asyncHandler = require('../utils/asyncHandler');

const router = Router();

/** Consultas: generosas, la pagina navega el calendario. */
const limiteConsulta = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, mensaje: 'Demasiadas consultas. Espera un momento.' },
});

/** Reservas: 5 por IP cada 10 minutos. Frena el agendamiento masivo. */
const limiteReserva = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    mensaje: 'Se alcanzo el limite de reservas. Si necesitas otro turno, comunicate con el consultorio.',
  },
});

router.get('/:hash', limiteConsulta, asyncHandler(ctrl.disponibilidadPorHash));
router.post('/:hash', limiteReserva, v.reservaPublica, validate, asyncHandler(ctrl.reservarPorHash));

module.exports = router;
