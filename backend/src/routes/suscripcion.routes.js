/**
 * routes/suscripcion.routes.js   ->  /api/suscripciones
 * Control de la suscripcion mensual de los medicos.
 */
const { Router } = require('express');
const ctrl = require('../controllers/suscripcion.controller');
const v = require('../validators');
const validate = require('../middlewares/validate.middleware');
const { autenticar, permitir, resolverTenant } = require('../middlewares/auth.middleware');
const asyncHandler = require('../utils/asyncHandler');

const router = Router();

/* ------------------------- PUBLICO (MercadoPago) ----------------------- */
router.post('/webhook', asyncHandler(ctrl.webhook));

/* ------------------------------ PRIVADO -------------------------------- */
router.use(autenticar);

/* --- Medico (tenant): ve y paga lo suyo. No exige tenant activo, porque
       justamente el pago es lo que lo rehabilita. --- */
router.get('/mis-suscripciones', permitir('medico'), resolverTenant, asyncHandler(ctrl.misSuscripciones));
router.post('/:id/pagar', permitir('medico'), resolverTenant, v.idParam, validate, asyncHandler(ctrl.pagar));
router.post(
  '/:id/confirmar-simulado',
  permitir('medico'), resolverTenant, v.idParam, validate,
  asyncHandler(ctrl.confirmarSimulado)
);

/* --- Administrador general --- */
router.get('/', permitir('admin'), asyncHandler(ctrl.listar));
router.post('/generar-periodo', permitir('admin'), v.generarPeriodo, validate, asyncHandler(ctrl.generarPeriodo));
router.post('/suspender-morosos', permitir('admin'), asyncHandler(ctrl.suspenderMorosos));
router.patch('/:id/estado', permitir('admin'), v.idParam, validate, asyncHandler(ctrl.cambiarEstado));

module.exports = router;
