/**
 * routes/pago.routes.js   ->  /api/pagos
 *
 * El webhook es PUBLICO (lo invoca MercadoPago, no un usuario logueado) y por
 * eso se declara antes del router.use(autenticar).
 */
const { Router } = require('express');
const ctrl = require('../controllers/pago.controller');
const v = require('../validators');
const validate = require('../middlewares/validate.middleware');
const { autenticar, permitir, resolverTenant } = require('../middlewares/auth.middleware');
const asyncHandler = require('../utils/asyncHandler');

const router = Router();

/* ------------------------- PUBLICO (MercadoPago) ----------------------- */
router.post('/webhook', asyncHandler(ctrl.webhook));
router.get('/webhook', asyncHandler(ctrl.webhook)); // MP a veces notifica por GET

/* ------------------------------ PRIVADO -------------------------------- */
router.use(autenticar);

router.post('/preferencia', permitir('paciente'), v.crearPreferencia, validate, asyncHandler(ctrl.crearPreferencia));
router.get('/mis-pagos', permitir('paciente'), asyncHandler(ctrl.misPagos));

router.get('/recibidos', permitir('medico'), resolverTenant, asyncHandler(ctrl.pagosRecibidos));

router.get('/turno/:turnoId', asyncHandler(ctrl.pagosDeTurno));

module.exports = router;
