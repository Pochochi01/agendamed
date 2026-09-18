/**
 * routes/horario.routes.js   ->  /api/horarios
 * Plantilla semanal de atencion del medico autenticado.
 */
const { Router } = require('express');
const ctrl = require('../controllers/horario.controller');
const v = require('../validators');
const validate = require('../middlewares/validate.middleware');
const { autenticar, permitir, resolverTenant, exigirTenantActivo } = require('../middlewares/auth.middleware');
const asyncHandler = require('../utils/asyncHandler');

const router = Router();

router.use(autenticar, permitir('medico'), resolverTenant);

router.get('/', asyncHandler(ctrl.listar));
router.get('/:id', v.idParam, validate, asyncHandler(ctrl.detalle));

router.post('/', exigirTenantActivo, v.horario, validate, asyncHandler(ctrl.crear));
router.put('/:id', exigirTenantActivo, v.idParam, v.horario, validate, asyncHandler(ctrl.actualizar));
router.delete('/:id', exigirTenantActivo, v.idParam, validate, asyncHandler(ctrl.eliminar));

module.exports = router;
