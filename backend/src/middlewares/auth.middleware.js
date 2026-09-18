/**
 * middlewares/auth.middleware.js
 * Autenticacion por JWT y autorizacion por rol / tenant.
 */
const jwt = require('jsonwebtoken');
const { jwt: jwtCfg } = require('../config/env');
const ApiError = require('../utils/ApiError');
const Medico = require('../models/medico.model');

/**
 * Firma el token de sesion. El payload lleva lo minimo indispensable:
 * nunca datos sensibles, porque el JWT es legible por el cliente.
 */
function firmarToken(usuario) {
  return jwt.sign(
    { sub: usuario.id, rol: usuario.rol, email: usuario.email },
    jwtCfg.secret,
    { expiresIn: jwtCfg.expiresIn }
  );
}

/**
 * Exige un Bearer token valido. Deja en req.usuario { id, rol, email }.
 */
function autenticar(req, _res, next) {
  const header = req.headers.authorization || '';
  const [esquema, token] = header.split(' ');

  if (esquema !== 'Bearer' || !token) {
    return next(ApiError.unauthorized('Falta el token de autenticacion'));
  }

  try {
    const payload = jwt.verify(token, jwtCfg.secret);
    req.usuario = { id: payload.sub, rol: payload.rol, email: payload.email };
    return next();
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'La sesion expiro' : 'Token invalido';
    return next(ApiError.unauthorized(msg));
  }
}

/**
 * Autenticacion opcional: si viene token lo resuelve, si no sigue igual.
 * Util en endpoints publicos que muestran algo extra al usuario logueado.
 */
function autenticarOpcional(req, _res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return next();
  try {
    const payload = jwt.verify(header.slice(7), jwtCfg.secret);
    req.usuario = { id: payload.sub, rol: payload.rol, email: payload.email };
  } catch {
    /* token invalido -> se trata como anonimo */
  }
  return next();
}

/**
 * Restringe el acceso a uno o varios roles.
 * @example router.get('/', autenticar, permitir('admin'), handler)
 */
function permitir(...roles) {
  return (req, _res, next) => {
    if (!req.usuario) return next(ApiError.unauthorized());
    if (!roles.includes(req.usuario.rol)) {
      return next(ApiError.forbidden('Tu rol no tiene acceso a este recurso'));
    }
    return next();
  };
}

/**
 * Resuelve el tenant del medico autenticado y lo deja en req.medico.
 * Es la pieza central del aislamiento multi-tenant: los controladores de
 * medico filtran siempre por req.medico.id y nunca por un id del body.
 *
 * Bloquea al medico suspendido por el administrador (salvo lectura de su
 * propio perfil y el pago de la suscripcion, que usan otras rutas).
 */
async function resolverTenant(req, _res, next) {
  try {
    if (!req.usuario || req.usuario.rol !== 'medico') {
      return next(ApiError.forbidden('Solo disponible para medicos'));
    }

    const medico = await Medico.findByUserId(req.usuario.id);
    if (!medico) return next(ApiError.notFound('No existe un perfil medico para este usuario'));

    req.medico = medico;
    return next();
  } catch (error) {
    return next(error);
  }
}

/**
 * Exige que el tenant este activo. Se aplica despues de resolverTenant en
 * las rutas de escritura (crear horarios, consultorios, etc.).
 */
function exigirTenantActivo(req, _res, next) {
  if (req.medico && req.medico.estado !== 'activo') {
    return next(ApiError.forbidden(
      'Tu cuenta esta suspendida por falta de pago de la suscripcion. Regularizala para seguir operando.'
    ));
  }
  return next();
}

module.exports = {
  firmarToken,
  autenticar,
  autenticarOpcional,
  permitir,
  resolverTenant,
  exigirTenantActivo,
};
