/**
 * utils/ApiError.js
 * Error operacional con codigo HTTP. Todo lo que los controladores lanzan
 * deberia ser un ApiError; cualquier otra cosa se considera bug y el
 * middleware de errores la reporta como 500 sin filtrar detalles al cliente.
 */
class ApiError extends Error {
  /**
   * @param {number} status  codigo HTTP
   * @param {string} mensaje mensaje apto para mostrar al usuario final
   * @param {Array}  [detalles] errores de validacion campo por campo
   */
  constructor(status, mensaje, detalles = undefined) {
    super(mensaje);
    this.name = 'ApiError';
    this.status = status;
    this.detalles = detalles;
    this.operacional = true;
    Error.captureStackTrace(this, ApiError);
  }

  static badRequest(msg = 'Solicitud invalida', detalles) { return new ApiError(400, msg, detalles); }
  static unauthorized(msg = 'No autenticado')             { return new ApiError(401, msg); }
  static forbidden(msg = 'No autorizado')                 { return new ApiError(403, msg); }
  static notFound(msg = 'Recurso no encontrado')          { return new ApiError(404, msg); }
  static conflict(msg = 'Conflicto con el estado actual') { return new ApiError(409, msg); }
  static unprocessable(msg = 'No se puede procesar')      { return new ApiError(422, msg); }
}

module.exports = ApiError;
