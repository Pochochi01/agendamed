/**
 * routes/turno.routes.js   ->  /api/turnos
 * Reserva (paciente), agenda (medico) y cancelacion (segun rol).
 */
const { Router } = require('express');
const ctrl = require('../controllers/turno.controller');
const v = require('../validators');
const validate = require('../middlewares/validate.middleware');
const { autenticar, permitir, resolverTenant, exigirTenantActivo } = require('../middlewares/auth.middleware');
const asyncHandler = require('../utils/asyncHandler');

const router = Router();

router.use(autenticar);

/* ------------------------------ PACIENTE ------------------------------- */
router.post('/', permitir('paciente'), v.reservarTurno, validate, asyncHandler(ctrl.reservar));
router.get('/mis-turnos', permitir('paciente'), asyncHandler(ctrl.misTurnos));

/* ------------------------------- MEDICO -------------------------------- */
router.get(
  '/agenda',
  permitir('medico'), resolverTenant,
  v.rangoFechas, validate,
  asyncHandler(ctrl.agendaDelMedico)
);
router.get('/mis-pacientes', permitir('medico'), resolverTenant, asyncHandler(ctrl.misPacientes));
// Registro de cancelaciones de un paciente con este profesional.
router.get(
  '/pacientes/:pacienteId/cancelaciones',
  permitir('medico'), resolverTenant,
  asyncHandler(ctrl.cancelacionesDePaciente)
);
router.patch(
  '/:id/estado',
  permitir('medico'), resolverTenant, exigirTenantActivo,
  v.idParam, validate,
  asyncHandler(ctrl.cambiarEstado)
);

/* ------------------------------ COMPARTIDO ----------------------------- */
router.get('/:id', v.idParam, validate, asyncHandler(ctrl.detalle));
router.patch('/:id/cancelar', v.cancelarTurno, validate, asyncHandler(ctrl.cancelar));

module.exports = router;
