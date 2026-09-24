/**
 * routes/index.js
 * Monta todos los routers bajo /api y expone un healthcheck.
 */
const { Router } = require('express');

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ ok: true, servicio: 'AgendaMed API', hora: new Date().toISOString() });
});

router.use('/auth', require('./auth.routes'));
router.use('/catalogo', require('./catalogo.routes'));
// Router PUBLICO del enlace de agendamiento directo (/reservar/:hash).
router.use('/reservar', require('./reservaPublica.routes'));
router.use('/medicos', require('./medico.routes'));
router.use('/agenda', require('./agenda.routes'));
router.use('/pacientes', require('./paciente.routes'));
/*
 * Dictado: recibe el audio completo, devuelve texto y lo descarta.
 *
 * Se monta el MISMO router en dos rutas (no hay logica duplicada):
 *   /api/historia/transcribir  -> nombre pedido en la especificacion, deja
 *                                 claro a que modulo pertenece la funcion
 *   /api/transcripcion         -> alias; la transcripcion en si no depende de
 *                                 ningun paciente, es audio -> texto a secas
 */
router.use('/historia/transcribir', require('./transcripcion.routes'));
router.use('/transcripcion', require('./transcripcion.routes'));
// Acceso del paciente a su turno por codigo, sin sesion (publico).
router.use('/turno', require('./turnoPublico.routes'));
router.use('/consultorios', require('./consultorio.routes'));
router.use('/horarios', require('./horario.routes'));
router.use('/turnos', require('./turno.routes'));
router.use('/pagos', require('./pago.routes'));
router.use('/suscripciones', require('./suscripcion.routes'));

module.exports = router;
