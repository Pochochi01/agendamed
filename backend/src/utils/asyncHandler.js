/**
 * utils/asyncHandler.js
 * Envuelve un controlador async para que cualquier rechazo termine en
 * next(err) y lo tome el middleware de errores. Evita repetir try/catch.
 *
 * @example router.get('/', asyncHandler(controller.listar));
 */
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
