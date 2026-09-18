/**
 * routes/agenda.routes.js   ->  /api/agenda
 * Agenda diaria del medico y cancelacion de jornadas.
 */
const { Router } = require('express');
const ctrl = require('../controllers/agenda.controller');
const v = require('../validators');
const validate = require('../middlewares/validate.middleware');
const {
  autenticar, permitir, resolverTenant, exigirTenantActivo,
} = require('../middlewares/auth.middleware');
const asyncHandler = require('../utils/asyncHandler');

const router = Router();

router.use(autenticar, permitir('medico'), resolverTenant);

router.get('/dia', v.agendaDia, validate, asyncHandler(ctrl.agendaDelDia));
router.get('/ausencias', v.rangoFechas, validate, asyncHandler(ctrl.listarAusencias));

router.post(
  '/cancelar-dia',
  exigirTenantActivo, v.cancelarDia, validate,
  asyncHandler(ctrl.cancelarDia)
);
router.delete(
  '/cancelar-dia',
  exigirTenantActivo, v.cancelarDia, validate,
  asyncHandler(ctrl.reactivarDia)
);

module.exports = router;
