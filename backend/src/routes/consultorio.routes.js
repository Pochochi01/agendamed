/**
 * routes/consultorio.routes.js   ->  /api/consultorios
 * Todo el router es privado del medico: se autentica, se resuelve el tenant
 * y las escrituras exigen ademas que el tenant no este suspendido.
 */
const { Router } = require('express');
const ctrl = require('../controllers/consultorio.controller');
const v = require('../validators');
const validate = require('../middlewares/validate.middleware');
const { autenticar, permitir, resolverTenant, exigirTenantActivo } = require('../middlewares/auth.middleware');
const asyncHandler = require('../utils/asyncHandler');

const router = Router();

router.use(autenticar, permitir('medico'), resolverTenant);

router.get('/', asyncHandler(ctrl.listar));
router.get('/:id', v.idParam, validate, asyncHandler(ctrl.detalle));

router.post('/', exigirTenantActivo, v.consultorio, validate, asyncHandler(ctrl.crear));
router.put('/:id', exigirTenantActivo, v.idParam, v.consultorio, validate, asyncHandler(ctrl.actualizar));
router.delete('/:id', exigirTenantActivo, v.idParam, validate, asyncHandler(ctrl.eliminar));

module.exports = router;
