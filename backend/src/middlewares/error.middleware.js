/**
 * middlewares/error.middleware.js
 * Manejo centralizado de errores + 404.
 *
 * Regla de seguridad: solo los ApiError (errores esperados) exponen su
 * mensaje. Cualquier otro error se loguea completo en el servidor y el
 * cliente recibe un 500 generico, sin stack traces ni detalles de MySQL.
 */
const ApiError = require('../utils/ApiError');
const { nodeEnv } = require('../config/env');

/** Ruta inexistente -> 404 uniforme. */
function noEncontrado(req, _res, next) {
  next(ApiError.notFound(`La ruta ${req.method} ${req.originalUrl} no existe`));
}

/** Traduce errores conocidos de MySQL a ApiError con mensaje util. */
function traducirErrorMysql(error) {
  switch (error.code) {
    case 'ER_DUP_ENTRY': {
      if (String(error.message).includes('uq_users_email')) {
        return ApiError.conflict('Ya existe un usuario registrado con ese email');
      }
      if (String(error.message).includes('uq_turno_')) {
        return ApiError.conflict('Ese horario acaba de ser reservado por otro paciente');
      }
      if (String(error.message).includes('uq_suscripcion_periodo')) {
        return ApiError.conflict('Ya existe una suscripcion para ese periodo');
      }
      return ApiError.conflict('El registro ya existe');
    }
    case 'ER_NO_REFERENCED_ROW_2':
      return ApiError.badRequest('Se referencia un registro que no existe');
    case 'ER_ROW_IS_REFERENCED_2':
      return ApiError.conflict('No se puede eliminar: hay registros asociados');
    case 'ER_CHECK_CONSTRAINT_VIOLATED':
      return ApiError.badRequest('Los datos no cumplen las reglas de la base de datos');
    case 'ER_DATA_TOO_LONG': {
      /*
       * Un valor no entra en su columna. Casi siempre significa que la base
       * quedo atras respecto del codigo: una migracion sin aplicar.
       *
       * Se loguea la columna exacta y el comando para arreglarlo, porque el
       * mensaje crudo de MySQL ("Data too long for column 'x' at row 1") no
       * dice que hacer. Pasa a 500 y no a 400: no es culpa de quien uso la
       * aplicacion, es un problema de configuracion del servidor.
       */
      const columna = /column '([^']+)'/.exec(error.sqlMessage || '')?.[1] || 'desconocida';
      // eslint-disable-next-line no-console
      console.error(
        `\n[db] ER_DATA_TOO_LONG en la columna "${columna}".`
        + '\n[db] Suele ser una migracion sin aplicar. Corre:  npm run db:up\n'
      );
      return new ApiError(500,
        'El servidor no pudo guardar el dato porque la base esta desactualizada. '
        + 'Avisa al administrador.');
    }
    case 'ECONNREFUSED':
    case 'PROTOCOL_CONNECTION_LOST':
      return new ApiError(503, 'La base de datos no esta disponible');
    default:
      return null;
  }
}

// eslint-disable-next-line no-unused-vars
function manejadorErrores(err, req, res, _next) {
  let error = err;

  if (!(error instanceof ApiError) && error && error.code) {
    error = traducirErrorMysql(err) || error;
  }

  if (error instanceof ApiError) {
    return res.status(error.status).json({
      ok: false,
      mensaje: error.message,
      ...(error.detalles ? { detalles: error.detalles } : {}),
    });
  }

  // Error inesperado: log completo del lado servidor, respuesta opaca afuera.
  // eslint-disable-next-line no-console
  console.error('[error]', req.method, req.originalUrl, '\n', err);

  return res.status(500).json({
    ok: false,
    mensaje: 'Error interno del servidor',
    ...(nodeEnv === 'development' ? { debug: err.message } : {}),
  });
}

module.exports = { noEncontrado, manejadorErrores };
