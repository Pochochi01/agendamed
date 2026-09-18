/**
 * controllers/auth.controller.js
 * Registro (medico / paciente), login, perfil y cambio de password.
 *
 * Seguridad:
 *  - las contrasenas se guardan con bcrypt (coste 12), nunca en claro;
 *  - el login responde el mismo mensaje generico ante email inexistente o
 *    password incorrecta, para no revelar que cuentas existen;
 *  - el registro publico solo permite crear roles 'medico' y 'paciente':
 *    el rol 'admin' se siembra por seed.
 */
const bcrypt = require('bcryptjs');
const { transaction } = require('../config/db');
const User = require('../models/user.model');
const Medico = require('../models/medico.model');
const Paciente = require('../models/paciente.model');
const Catalogo = require('../models/catalogo.model');
const Suscripcion = require('../models/suscripcion.model');
const ApiError = require('../utils/ApiError');
const { firmarToken } = require('../middlewares/auth.middleware');
const { negocio } = require('../config/env');

const COSTO_BCRYPT = 12;

/** Arma la respuesta de sesion (token + usuario + perfil del rol). */
async function armarSesion(usuario) {
  const token = firmarToken(usuario);
  const base = {
    id: usuario.id,
    nombre: usuario.nombre,
    apellido: usuario.apellido,
    email: usuario.email,
    telefono: usuario.telefono,
    rol: usuario.rol,
  };

  if (usuario.rol === 'medico') {
    base.medico = await Medico.findByUserId(usuario.id);
  } else if (usuario.rol === 'paciente') {
    base.paciente = await Paciente.findByUserId(usuario.id);
  }

  return { token, usuario: base };
}

/**
 * POST /api/auth/registro
 * Body comun: nombre, apellido, email, password, telefono
 *   rol 'medico'   -> especialidadId | especialidad, matricula, precioConsulta?
 *   rol 'paciente' -> dni, fechaNacimiento?
 */
async function registro(req, res) {
  const { nombre, apellido, email, password, telefono = null, rol } = req.body;

  if (!['medico', 'paciente'].includes(rol)) {
    throw ApiError.badRequest('El rol debe ser "medico" o "paciente"');
  }

  if (await User.findByEmail(email)) {
    throw ApiError.conflict('Ya existe un usuario registrado con ese email');
  }

  const passwordHash = await bcrypt.hash(password, COSTO_BCRYPT);

  // Resolver la especialidad fuera de la transaccion (catalogo compartido).
  let especialidadId = null;
  if (rol === 'medico') {
    if (req.body.especialidadId) {
      const esp = await Catalogo.findEspecialidad(req.body.especialidadId);
      if (!esp) throw ApiError.badRequest('La especialidad indicada no existe');
      especialidadId = esp.id;
    } else if (req.body.especialidad) {
      especialidadId = (await Catalogo.crearEspecialidadSiNoExiste(req.body.especialidad.trim())).id;
    } else {
      throw ApiError.badRequest('Indica la especialidad del medico');
    }
  }

  /*
   * Si ya existe un paciente con ese DNI puede ser por dos motivos:
   *
   *   a) Es una cuenta INVITADA que se creo al reservar por el enlace directo.
   *      En ese caso el registro NO es un conflicto: es la misma persona
   *      dandose de alta. Se le agregan las credenciales al usuario existente
   *      ("reclamar la cuenta") para que conserve sus turnos e historia
   *      clinica en lugar de quedar con dos identidades.
   *
   *   b) Es una cuenta ya registrada -> ahi si es un conflicto real.
   */
  if (rol === 'paciente') {
    const existente = await Paciente.findByDni(req.body.dni);

    if (existente && !existente.es_invitado) {
      throw ApiError.conflict('Ya hay un paciente registrado con ese DNI');
    }

    if (existente && existente.es_invitado) {
      await User.convertirInvitadoEnRegistrado(existente.user_id, {
        nombre, apellido, email, telefono, passwordHash,
      });
      if (req.body.fechaNacimiento) {
        await Paciente.actualizarDatos(existente.id, {
          nombre, apellido, telefono, fechaNacimiento: req.body.fechaNacimiento,
        });
      }

      const usuarioReclamado = await User.findById(existente.user_id);
      const sesion = await armarSesion(usuarioReclamado);

      return res.status(200).json({
        ok: true,
        mensaje: 'Cuenta activada. Tus turnos anteriores ya estan en tu panel.',
        cuentaReclamada: true,
        ...sesion,
      });
    }
  }

  // users + (medicos|pacientes) se crean juntos o no se crea nada.
  const userId = await transaction(async (cx) => {
    const nuevoUserId = await User.create(
      { nombre, apellido, email, telefono, passwordHash, rol },
      cx
    );

    if (rol === 'medico') {
      await Medico.create(
        {
          userId: nuevoUserId,
          especialidadId,
          matricula: req.body.matricula,
          duracionTurnoMin: req.body.duracionTurnoMin || 30,
          precioConsulta: req.body.precioConsulta || 0,
          porcentajeSena: req.body.porcentajeSena ?? 30,
        },
        cx
      );
    } else {
      await Paciente.create(
        { userId: nuevoUserId, dni: req.body.dni, fechaNacimiento: req.body.fechaNacimiento || null },
        cx
      );
    }

    return nuevoUserId;
  });

  // Al medico nuevo se le abre el periodo de suscripcion del mes en curso.
  if (rol === 'medico') {
    const medico = await Medico.findByUserId(userId);
    const hoy = new Date();
    await Suscripcion.crearSiNoExiste({
      medicoId: medico.id,
      anio: hoy.getFullYear(),
      mes: hoy.getMonth() + 1,
      monto: negocio.suscripcionMonto,
    });
  }

  const usuario = await User.findById(userId);
  const sesion = await armarSesion(usuario);

  return res.status(201).json({ ok: true, mensaje: 'Cuenta creada correctamente', ...sesion });
}

/** POST /api/auth/login */
async function login(req, res) {
  const { email, password } = req.body;
  const CREDENCIALES_INVALIDAS = 'Email o contrasena incorrectos';

  const usuario = await User.findByEmailConHash(email);
  if (!usuario) throw ApiError.unauthorized(CREDENCIALES_INVALIDAS);

  // Cuenta INVITADA (creada por el enlace de agendamiento directo): no tiene
  // contrasena, asi que no puede iniciar sesion. Se responde el mismo mensaje
  // generico para no revelar que la cuenta existe.
  if (!usuario.password_hash) throw ApiError.unauthorized(CREDENCIALES_INVALIDAS);

  const coincide = await bcrypt.compare(password, usuario.password_hash);
  if (!coincide) throw ApiError.unauthorized(CREDENCIALES_INVALIDAS);

  if (!usuario.activo) {
    throw ApiError.forbidden('Tu cuenta esta deshabilitada. Contacta al administrador.');
  }

  delete usuario.password_hash;
  const sesion = await armarSesion(usuario);

  return res.json({ ok: true, mensaje: 'Sesion iniciada', ...sesion });
}

/** GET /api/auth/perfil  (token requerido) */
async function perfil(req, res) {
  const usuario = await User.findById(req.usuario.id);
  if (!usuario) throw ApiError.notFound('Usuario no encontrado');

  const datos = { ...usuario };
  if (usuario.rol === 'medico') datos.medico = await Medico.findByUserId(usuario.id);
  if (usuario.rol === 'paciente') datos.paciente = await Paciente.findByUserId(usuario.id);

  return res.json({ ok: true, usuario: datos });
}

/** PUT /api/auth/perfil */
async function actualizarPerfil(req, res) {
  const { nombre, apellido, telefono } = req.body;
  const usuario = await User.updatePerfil(req.usuario.id, { nombre, apellido, telefono });
  return res.json({ ok: true, mensaje: 'Perfil actualizado', usuario });
}

/** PUT /api/auth/password */
async function cambiarPassword(req, res) {
  const { passwordActual, passwordNueva } = req.body;

  const fila = await User.getPasswordHash(req.usuario.id);
  if (!fila) throw ApiError.notFound('Usuario no encontrado');

  const coincide = await bcrypt.compare(passwordActual, fila.password_hash);
  if (!coincide) throw ApiError.unauthorized('La contrasena actual es incorrecta');

  await User.updatePassword(req.usuario.id, await bcrypt.hash(passwordNueva, COSTO_BCRYPT));
  return res.json({ ok: true, mensaje: 'Contrasena actualizada' });
}

module.exports = { registro, login, perfil, actualizarPerfil, cambiarPassword };
