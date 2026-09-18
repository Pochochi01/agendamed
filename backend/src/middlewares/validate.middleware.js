/**
 * middlewares/validate.middleware.js
 * Corta la request si express-validator acumulo errores y los devuelve
 * normalizados como { campo, mensaje }.
 */
const { validationResult } = require('express-validator');
const ApiError = require('../utils/ApiError');

module.exports = function validar(req, _res, next) {
  const resultado = validationResult(req);
  if (resultado.isEmpty()) return next();

  const detalles = resultado.array().map((e) => ({
    campo: e.path || e.param,
    mensaje: e.msg,
  }));

  return next(ApiError.badRequest('Hay errores de validacion en los datos enviados', detalles));
};
