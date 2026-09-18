/**
 * routes/auth.routes.js   ->  /api/auth
 * Registro, login y gestion de la propia cuenta.
 */
const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const ctrl = require('../controllers/auth.controller');
const v = require('../validators');
const validate = require('../middlewares/validate.middleware');
const { autenticar } = require('../middlewares/auth.middleware');
const asyncHandler = require('../utils/asyncHandler');

const router = Router();

/**
 * Freno de fuerza bruta: 10 intentos de login por IP cada 15 minutos.
 */
const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, mensaje: 'Demasiados intentos. Reintenta en unos minutos.' },
});

router.post('/registro', v.registro, validate, asyncHandler(ctrl.registro));
router.post('/login', limiteLogin, v.login, validate, asyncHandler(ctrl.login));

router.get('/perfil', autenticar, asyncHandler(ctrl.perfil));
router.put('/perfil', autenticar, v.actualizarPerfil, validate, asyncHandler(ctrl.actualizarPerfil));
router.put('/password', autenticar, v.cambiarPassword, validate, asyncHandler(ctrl.cambiarPassword));

module.exports = router;
