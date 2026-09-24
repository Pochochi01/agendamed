/**
 * routes/medico.routes.js   ->  /api/medicos
 *
 * Tres bloques, de mas abierto a mas restringido:
 *   /mi/*      -> el propio medico (tenant)
 *   /admin/*   -> administrador general
 *   /          -> publico (busqueda y disponibilidad para el paciente)
 *
 * Las rutas literales se declaran ANTES que /:id para que "mi" y "admin" no
 * sean capturados como un id.
 */
const { Router } = require('express');
const ctrl = require('../controllers/medico.controller');
// El enlace publico vive en su propio controlador, junto a la reserva que lo consume.
const enlaceCtrl = require('../controllers/reservaPublica.controller');
const v = require('../validators');
const validate = require('../middlewares/validate.middleware');
const {
  autenticar, permitir, resolverTenant, exigirTenantActivo,
} = require('../middlewares/auth.middleware');
const asyncHandler = require('../utils/asyncHandler');

const router = Router();

/* ------------------------------ TENANT --------------------------------- */
router.get('/mi/perfil', autenticar, permitir('medico'), resolverTenant, asyncHandler(ctrl.miPerfil));
router.put(
  '/mi/perfil',
  autenticar, permitir('medico'), resolverTenant,
  v.configuracionMedico, validate,
  asyncHandler(ctrl.actualizarMiPerfil)
);
router.get('/mi/estadisticas', autenticar, permitir('medico'), resolverTenant, asyncHandler(ctrl.misEstadisticas));

// Duracion del slot: se edita desde la pantalla de horarios, porque es el
// parametro con el que se arma la agenda.
router.patch(
  '/mi/duracion-turno',
  autenticar, permitir('medico'), resolverTenant, exigirTenantActivo,
  v.duracionTurno, validate,
  asyncHandler(ctrl.actualizarDuracionTurno)
);

// Modo de agenda: seleccion libre u orden de llegada.
router.patch(
  '/mi/modo-agenda',
  autenticar, permitir('medico'), resolverTenant, exigirTenantActivo,
  v.modoAgenda, validate,
  asyncHandler(ctrl.actualizarModoAgenda)
);

// Enlace de agendamiento directo que el medico comparte con sus pacientes.
router.get('/mi/enlace', autenticar, permitir('medico'), resolverTenant, asyncHandler(enlaceCtrl.miEnlace));
router.post(
  '/mi/enlace/regenerar',
  autenticar, permitir('medico'), resolverTenant, exigirTenantActivo,
  asyncHandler(enlaceCtrl.regenerarEnlace)
);
router.patch(
  '/mi/enlace',
  autenticar, permitir('medico'), resolverTenant, exigirTenantActivo,
  asyncHandler(enlaceCtrl.cambiarEstadoEnlace)
);

// Credenciales de MercadoPago propias del profesional (cobro de turnos).
router.get('/mi/mercadopago', autenticar, permitir('medico'), resolverTenant, asyncHandler(ctrl.estadoMercadoPago));
router.put(
  '/mi/mercadopago',
  autenticar, permitir('medico'), resolverTenant, exigirTenantActivo,
  v.credencialesMp, validate,
  asyncHandler(ctrl.configurarMercadoPago)
);
router.delete(
  '/mi/mercadopago',
  autenticar, permitir('medico'), resolverTenant, exigirTenantActivo,
  asyncHandler(ctrl.desconectarMercadoPago)
);

/* ------------------------------- ADMIN --------------------------------- */
// CRUD completo del Administrador General.
router.get('/admin/todos', autenticar, permitir('admin'), asyncHandler(ctrl.listarParaAdmin));

router.post('/', autenticar, permitir('admin'), v.crearMedicoAdmin, validate, asyncHandler(ctrl.crear));
router.put(
  '/:id',
  autenticar, permitir('admin'),
  v.actualizarMedicoAdmin, validate,
  asyncHandler(ctrl.actualizar)
);

// Baja logica (reversible): saca al medico de la busqueda y le corta el acceso.
router.patch(
  '/:id/estado',
  autenticar, permitir('admin'),
  v.estadoMedico, validate,
  asyncHandler(ctrl.cambiarEstado)
);

// Eliminacion definitiva (irreversible). El GET informa el alcance antes.
router.get(
  '/:id/impacto-eliminacion',
  autenticar, permitir('admin'),
  v.idParam, validate,
  asyncHandler(ctrl.impactoEliminacion)
);
router.delete(
  '/:id',
  autenticar, permitir('admin'),
  v.eliminarMedico, validate,
  asyncHandler(ctrl.eliminar)
);

/* ------------------------------ PUBLICO -------------------------------- */
router.get('/', asyncHandler(ctrl.listarPublico));
router.get('/:id', v.idParam, validate, asyncHandler(ctrl.detallePublico));
router.get('/:id/disponibilidad', v.idParam, validate, asyncHandler(ctrl.disponibilidad));
router.get('/:id/disponibilidad/:fecha', v.idParam, validate, asyncHandler(ctrl.disponibilidadDelDia));

module.exports = router;
