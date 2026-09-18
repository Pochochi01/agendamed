/**
 * routes/paciente.routes.js   ->  /api/pacientes
 *
 * Ficha del paciente, obra social e historia clinica. Todo el router es del
 * medico: el controlador verifica ademas que el paciente tenga turnos con el
 * (pacienteAtendidoPor), que es la barrera de acceso a los datos clinicos.
 */
const { Router } = require('express');
const ctrl = require('../controllers/historia.controller');
const v = require('../validators');
const validate = require('../middlewares/validate.middleware');
const {
  autenticar, permitir, resolverTenant, exigirTenantActivo,
} = require('../middlewares/auth.middleware');
const asyncHandler = require('../utils/asyncHandler');

const router = Router();

router.use(autenticar, permitir('medico'), resolverTenant);

/* ------------------------------ Ficha --------------------------------- */
router.get('/:id', v.idParam, validate, asyncHandler(ctrl.fichaPaciente));
router.patch(
  '/:id',
  exigirTenantActivo, v.datosPaciente, validate,
  asyncHandler(ctrl.actualizarDatosPaciente)
);

/* --------------------------- Obra social ------------------------------ */
router.patch(
  '/:id/obra-social',
  exigirTenantActivo, v.obraSocial, validate,
  asyncHandler(ctrl.actualizarObraSocial)
);

/* ------------------------- Historia clinica ---------------------------- */
// Solo texto: no hay endpoint que reciba audio, a proposito.
router.get('/:id/historia', v.idParam, validate, asyncHandler(ctrl.listarEvoluciones));
router.post(
  '/:id/historia',
  exigirTenantActivo, v.evolucion, validate,
  asyncHandler(ctrl.crearEvolucion)
);
router.put(
  '/:pacienteId/historia/:id',
  exigirTenantActivo, v.evolucion, validate,
  asyncHandler(ctrl.actualizarEvolucion)
);
router.delete(
  '/:pacienteId/historia/:id',
  exigirTenantActivo,
  asyncHandler(ctrl.eliminarEvolucion)
);

module.exports = router;
