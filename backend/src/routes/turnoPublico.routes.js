/**
 * routes/turnoPublico.routes.js   ->  /api/turno
 *
 * Acceso del PACIENTE a su turno mediante el codigo de cancelacion, sin
 * sesion.
 *
 * Existe porque quien reserva por el enlace es una cuenta invitada: no tiene
 * email ni contrasena, asi que no puede entrar al panel. El codigo que recibe
 * al reservar es su unico acceso al turno, y sin el "el paciente puede
 * cancelar" no seria cierto para la mayoria de las reservas.
 *
 * Al ser publico lleva rate limit propio: el codigo tiene ~60 bits de entropia
 * y es inadivinable, pero limitar los intentos corta cualquier sondeo.
 */
const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { body, param } = require('express-validator');
const ctrl = require('../controllers/reservaPublica.controller');
const validate = require('../middlewares/validate.middleware');
const asyncHandler = require('../utils/asyncHandler');

const router = Router();

const limite = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, mensaje: 'Demasiados intentos. Espera unos minutos.' },
});

/** El codigo son 12 caracteres del alfabeto sin vocales ni ambiguos. */
const codigoValido = param('codigo')
  .trim()
  .matches(/^[23456789BCDFGHJKMNPQRSTVWXYZ]{12}$/i)
  .withMessage('El codigo no tiene el formato correcto');

router.get('/:codigo', limite, codigoValido, validate, asyncHandler(ctrl.verTurnoPorCodigo));

router.post(
  '/:codigo/cancelar',
  limite,
  codigoValido,
  body('motivo').optional({ values: 'falsy' }).trim().isLength({ max: 255 }),
  validate,
  asyncHandler(ctrl.cancelarTurnoPorCodigo)
);

module.exports = router;
