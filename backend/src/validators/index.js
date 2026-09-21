/**
 * validators/index.js
 * Reglas de validacion/saneamiento de entrada con express-validator.
 * Se aplican en las rutas, antes de llegar al controlador; el middleware
 * `validate` corta la request si algo no cumple.
 */
const { body, param, query } = require('express-validator');

const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/* -------------------------------- AUTH --------------------------------- */

const registro = [
  body('nombre').trim().notEmpty().withMessage('El nombre es obligatorio').isLength({ max: 80 }),
  body('apellido').trim().notEmpty().withMessage('El apellido es obligatorio').isLength({ max: 80 }),
  body('email').trim().isEmail().withMessage('Email invalido').normalizeEmail(),
  body('password')
    .isLength({ min: 8 }).withMessage('La contrasena debe tener al menos 8 caracteres')
    .matches(/[a-zA-Z]/).withMessage('La contrasena debe incluir letras')
    .matches(/\d/).withMessage('La contrasena debe incluir numeros'),
  body('telefono').optional({ values: 'falsy' }).trim().isLength({ max: 30 }),
  body('rol').isIn(['medico', 'paciente']).withMessage('El rol debe ser medico o paciente'),

  // Campos condicionales segun el rol
  body('matricula')
    .if(body('rol').equals('medico'))
    .trim().notEmpty().withMessage('La matricula es obligatoria para un medico'),
  body('precioConsulta')
    .optional({ values: 'falsy' }).isFloat({ min: 0 }).withMessage('Precio invalido'),
  body('dni')
    .if(body('rol').equals('paciente'))
    .trim().notEmpty().withMessage('El DNI es obligatorio')
    .isLength({ min: 6, max: 20 }).withMessage('DNI invalido'),
  body('fechaNacimiento')
    .optional({ values: 'falsy' }).isISO8601().withMessage('Fecha de nacimiento invalida'),
];

const login = [
  body('email').trim().isEmail().withMessage('Email invalido').normalizeEmail(),
  body('password').notEmpty().withMessage('La contrasena es obligatoria'),
];

const actualizarPerfil = [
  body('nombre').trim().notEmpty().isLength({ max: 80 }),
  body('apellido').trim().notEmpty().isLength({ max: 80 }),
  body('telefono').optional({ values: 'falsy' }).trim().isLength({ max: 30 }),
];

const cambiarPassword = [
  body('passwordActual').notEmpty().withMessage('Indica tu contrasena actual'),
  body('passwordNueva')
    .isLength({ min: 8 }).withMessage('La nueva contrasena debe tener al menos 8 caracteres')
    .matches(/[a-zA-Z]/).withMessage('Debe incluir letras')
    .matches(/\d/).withMessage('Debe incluir numeros'),
];

/* ------------------------------- MEDICOS ------------------------------- */

const configuracionMedico = [
  body('especialidadId').isInt({ min: 1 }).withMessage('Especialidad invalida'),
  body('matricula').trim().notEmpty().withMessage('La matricula es obligatoria'),
  body('duracionTurnoMin').isInt({ min: 5, max: 240 }).withMessage('La duracion debe estar entre 5 y 240 minutos'),
  body('precioConsulta').isFloat({ min: 0 }).withMessage('Precio invalido'),
  body('porcentajeSena').isInt({ min: 0, max: 100 }).withMessage('La sena debe ser un porcentaje entre 0 y 100'),
];

const estadoMedico = [
  param('id').isInt({ min: 1 }),
  body('estado').isIn(['activo', 'suspendido']).withMessage('Estado invalido'),
];

/**
 * Duracion del turno cargada en dos campos separados.
 *
 * Rangos por campo: horas 0-4, minutos 0-60. Se aceptan 60 minutos como
 * equivalente a una hora (0 h 60 min y 1 h 0 min dan el mismo resultado);
 * el control del total (entre 5 min y 4 h) lo hace el controlador, que es
 * quien rechaza combinaciones como 4 h + 60 min.
 *
 * Los campos llegan como texto desde el formulario: isInt valida igual el
 * string numerico. Se usa { min: 0 } en notEmpty para que el "0" no se tome
 * como valor vacio.
 */
const duracionTurno = [
  body('horas')
    .exists({ checkNull: true }).withMessage('Indica las horas (0 si el turno dura menos de una hora)')
    .isInt({ min: 0, max: 4 }).withMessage('Las horas deben ser un numero entero entre 0 y 4'),
  body('minutos')
    .exists({ checkNull: true }).withMessage('Indica los minutos')
    .isInt({ min: 0, max: 60 }).withMessage('Los minutos deben ser un numero entero entre 0 y 60'),
];

/** Campos profesionales comunes al alta y la edicion desde el admin. */
const camposProfesionales = [
  body('nombre').trim().notEmpty().withMessage('El nombre es obligatorio').isLength({ max: 80 }),
  body('apellido').trim().notEmpty().withMessage('El apellido es obligatorio').isLength({ max: 80 }),
  body('email').trim().isEmail().withMessage('Email invalido').normalizeEmail(),
  body('telefono').optional({ values: 'falsy' }).trim().isLength({ max: 30 }),
  body('especialidadId').isInt({ min: 1 }).withMessage('Especialidad invalida'),
  body('matricula').trim().notEmpty().withMessage('La matricula es obligatoria').isLength({ max: 40 }),
  body('duracionTurnoMin').optional({ values: 'null' })
    .isInt({ min: 5, max: 240 }).withMessage('La duracion debe estar entre 5 y 240 minutos'),
  body('precioConsulta').optional({ values: 'null' })
    .isFloat({ min: 0 }).withMessage('Precio invalido'),
  body('porcentajeSena').optional({ values: 'null' })
    .isInt({ min: 0, max: 100 }).withMessage('La sena debe ser un porcentaje entre 0 y 100'),
];

/** Alta de medico desde el panel de administracion: la password es obligatoria. */
const crearMedicoAdmin = [
  ...camposProfesionales,
  body('password')
    .isLength({ min: 8 }).withMessage('La contrasena debe tener al menos 8 caracteres')
    .matches(/[a-zA-Z]/).withMessage('La contrasena debe incluir letras')
    .matches(/\d/).withMessage('La contrasena debe incluir numeros'),
];

/** Edicion: la password es opcional y solo se envia para resetearla. */
const actualizarMedicoAdmin = [
  param('id').isInt({ min: 1 }).withMessage('Id invalido'),
  ...camposProfesionales,
  body('password')
    .optional({ values: 'falsy' })
    .isLength({ min: 8 }).withMessage('La contrasena debe tener al menos 8 caracteres')
    .matches(/[a-zA-Z]/).withMessage('La contrasena debe incluir letras')
    .matches(/\d/).withMessage('La contrasena debe incluir numeros'),
];

/**
 * Eliminacion definitiva: se exige repetir el email del profesional. El
 * controlador comprueba ademas que coincida con el del medico indicado.
 */
const eliminarMedico = [
  param('id').isInt({ min: 1 }).withMessage('Id invalido'),
  body('confirmacion')
    .trim().notEmpty().withMessage('Repeti el email del profesional para confirmar la eliminacion'),
];

/**
 * Credenciales de MercadoPago del profesional.
 * No se valida el formato exacto del token (MercadoPago lo cambia con el
 * tiempo): se comprueba que tenga pinta de credencial y la validez real la
 * confirma el controlador consultando la API.
 */
const credencialesMp = [
  body('accessToken')
    .trim()
    .notEmpty().withMessage('Pega tu Access Token de MercadoPago')
    .isLength({ min: 20, max: 500 }).withMessage('El Access Token no parece completo'),
  body('publicKey')
    .optional({ values: 'falsy' })
    .trim().isLength({ max: 120 }).withMessage('La Public Key no parece valida'),
];

/* ----------------------------- CONSULTORIOS ---------------------------- */

const consultorio = [
  body('nombre').trim().notEmpty().withMessage('El nombre es obligatorio').isLength({ max: 100 }),
  body('calle').trim().notEmpty().withMessage('La calle es obligatoria').isLength({ max: 120 }),
  body('numero').trim().notEmpty().withMessage('El numero es obligatorio').isLength({ max: 20 }),
  body('pisoDepto').optional({ values: 'falsy' }).trim().isLength({ max: 30 }),
  body('telefono').optional({ values: 'falsy' }).trim().isLength({ max: 30 }),
  body('localidadId').optional({ values: 'falsy' }).isInt({ min: 1 }),
  body('localidad').optional({ values: 'falsy' }).trim().isLength({ max: 100 }),
  body('provincia').optional({ values: 'falsy' }).trim().isLength({ max: 100 }),
];

/* ------------------------------- HORARIOS ------------------------------ */

const horario = [
  body('consultorioId').isInt({ min: 1 }).withMessage('Consultorio invalido'),
  body('diaSemana').isInt({ min: 1, max: 7 }).withMessage('El dia debe ir de 1 (Lunes) a 7 (Domingo)'),
  body('horaInicio').matches(HORA_REGEX).withMessage('Hora de inicio invalida (HH:MM)'),
  body('horaFin').matches(HORA_REGEX).withMessage('Hora de fin invalida (HH:MM)'),
];

/* -------------------------------- TURNOS ------------------------------- */

const reservarTurno = [
  body('medicoId').isInt({ min: 1 }).withMessage('Medico invalido'),
  body('fecha').isISO8601().withMessage('Fecha invalida (YYYY-MM-DD)'),
  body('horaInicio').matches(HORA_REGEX).withMessage('Hora invalida (HH:MM)'),
  // Consultorio elegido en el paso 2 del flujo de reserva. Opcional, pero si
  // viene el controlador verifica que sea el del slot.
  body('consultorioId').optional({ values: 'null' }).isInt({ min: 1 }).withMessage('Consultorio invalido'),
  body('motivoConsulta').optional({ values: 'falsy' }).trim().isLength({ max: 255 }),
];

const cancelarTurno = [
  param('id').isInt({ min: 1 }),
  body('motivo').optional({ values: 'falsy' }).trim().isLength({ max: 255 }),
];

/* --------------------- RESERVA PUBLICA (enlace directo) ---------------- */

/**
 * Reserva sin sesion. El paciente carga nombre, apellido, DNI y su WhatsApp.
 *
 * El WhatsApp es OBLIGATORIO: una reserva por enlace no deja email ni cuenta,
 * asi que es el unico canal que le queda al profesional para contactarlo.
 * El controlador lo normaliza a solo digitos antes de guardarlo.
 */
const reservaPublica = [
  body('nombre').trim().notEmpty().withMessage('Ingresa tu nombre').isLength({ max: 80 }),
  body('apellido').trim().notEmpty().withMessage('Ingresa tu apellido').isLength({ max: 80 }),
  body('dni').trim().notEmpty().withMessage('Ingresa tu DNI')
    .isLength({ min: 6, max: 20 }).withMessage('DNI invalido')
    .matches(/^[\d.\s-]+$/).withMessage('El DNI solo puede tener numeros'),
  body('fecha').isISO8601().withMessage('Fecha invalida (YYYY-MM-DD)'),
  body('horaInicio').matches(HORA_REGEX).withMessage('Hora invalida (HH:MM)'),
  body('consultorioId').optional({ values: 'null' }).isInt({ min: 1 }).withMessage('Consultorio invalido'),
  body('motivoConsulta').optional({ values: 'falsy' }).trim().isLength({ max: 255 }),
  /*
   * Formato del WhatsApp. La PRESENCIA la exige el controlador y no este
   * validador, porque el numero puede llegar en `whatsapp` (formulario) o en
   * `wa` (enlaces antiguos que lo traian en la URL): pedirlo obligatorio aca
   * rechazaria los segundos. El controlador normaliza y, si no queda un numero
   * valido, responde 400 con un mensaje claro.
   */
  body('whatsapp').optional({ values: 'falsy' }).trim()
    .isLength({ min: 8, max: 25 }).withMessage('El numero de WhatsApp no parece valido')
    .matches(/^[\d\s()+-]+$/).withMessage('El WhatsApp solo puede tener numeros'),
  body('wa').optional({ values: 'falsy' }).trim()
    .isLength({ min: 8, max: 25 }).withMessage('Numero de WhatsApp invalido'),
];

/* ----------------------------- AGENDA DIARIA --------------------------- */

const agendaDia = [
  query('fecha').optional().isISO8601().withMessage('Fecha invalida (YYYY-MM-DD)'),
  query('consultorioId').optional({ values: 'falsy' }).isInt({ min: 1 }),
];

/**
 * Cancelar / reactivar una jornada.
 * `consultorioIds` es opcional: si no viene, aplica a todos los consultorios
 * del medico (dia completo).
 */
const cancelarDia = [
  body('fecha').isISO8601().withMessage('Indica la fecha (YYYY-MM-DD)'),
  body('consultorioIds').optional({ values: 'falsy' })
    .isArray().withMessage('consultorioIds debe ser un arreglo de ids'),
  body('consultorioIds.*').optional().isInt({ min: 1 }).withMessage('Consultorio invalido'),
  body('motivo').optional({ values: 'falsy' }).trim().isLength({ max: 255 }),
];

/* --------------------- OBRA SOCIAL / HISTORIA CLINICA ------------------ */

const obraSocial = [
  param('id').isInt({ min: 1 }).withMessage('Paciente invalido'),
  // null / vacio = paciente particular.
  body('obraSocialId').optional({ values: 'falsy' })
    .isInt({ min: 1 }).withMessage('Obra social invalida'),
  body('nroAfiliado').optional({ values: 'falsy' })
    .trim().isLength({ max: 50 }).withMessage('El numero de afiliado es demasiado largo'),
];

const datosPaciente = [
  param('id').isInt({ min: 1 }).withMessage('Paciente invalido'),
  body('nombre').trim().notEmpty().withMessage('El nombre es obligatorio').isLength({ max: 80 }),
  body('apellido').trim().notEmpty().withMessage('El apellido es obligatorio').isLength({ max: 80 }),
  body('telefono').optional({ values: 'falsy' }).trim().isLength({ max: 30 }),
  body('fechaNacimiento').optional({ values: 'falsy' })
    .isISO8601().withMessage('Fecha de nacimiento invalida'),
];

/**
 * Detecta contenido binario disfrazado de texto.
 *
 * No alcanza con que el endpoint solo acepte un campo `texto`: una auditoria
 * mostro que se podia pasar un data-URI de audio DENTRO de ese campo y quedaba
 * guardado en la base, que es exactamente lo que la restriccion de
 * arquitectura prohibe. Estas dos reglas lo cierran:
 *
 *   1. data-URI de cualquier tipo (data:audio/..., data:application/..., etc.)
 *   2. cualquier "palabra" de mas de 120 caracteres sin espacios: el texto
 *      clinico real no tiene tokens asi de largos, pero base64 si. Es una
 *      regla generica, no solo contra audio.
 */
function sinContenidoBinario(texto) {
  const valor = String(texto || '');

  if (/^\s*data:[a-z]+\/[a-z0-9.+-]+;base64,/i.test(valor)) {
    throw new Error('La evolucion solo admite texto. No se aceptan archivos ni audio codificado.');
  }
  if (/\bdata:(audio|video|image|application)\//i.test(valor)) {
    throw new Error('La evolucion solo admite texto. No se aceptan archivos ni audio codificado.');
  }
  if (/[A-Za-z0-9+/=]{120,}/.test(valor)) {
    throw new Error('La evolucion contiene datos que no son texto legible. Revisa el contenido.');
  }
  return true;
}

/**
 * Evolucion de la historia clinica. SOLO TEXTO.
 * No hay validador de archivo porque no existe endpoint que reciba audio, y
 * `sinContenidoBinario` impide colarlo dentro del propio campo de texto.
 */
const evolucion = [
  body('texto')
    .trim().notEmpty().withMessage('La evolucion no puede estar vacia')
    .isLength({ max: 20000 }).withMessage('La evolucion es demasiado extensa')
    .custom(sinContenidoBinario),
  body('turnoId').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('Turno invalido'),
  body('origen').optional({ values: 'falsy' })
    .isIn(['dictado', 'manual']).withMessage('Origen invalido'),
];

/* -------------------------------- PAGOS -------------------------------- */

const crearPreferencia = [
  body('turnoId').isInt({ min: 1 }).withMessage('Turno invalido'),
  body('tipo').isIn(['sena', 'total']).withMessage('El tipo debe ser "sena" o "total"'),
];

/* ----------------------------- SUSCRIPCIONES --------------------------- */

const generarPeriodo = [
  body('anio').optional().isInt({ min: 2020, max: 2100 }),
  body('mes').optional().isInt({ min: 1, max: 12 }),
  body('monto').optional().isFloat({ min: 0 }),
];

/* ------------------------------- COMUNES ------------------------------- */

const idParam = [param('id').isInt({ min: 1 }).withMessage('Id invalido')];

const rangoFechas = [
  query('desde').optional().isISO8601().withMessage('Fecha "desde" invalida'),
  query('hasta').optional().isISO8601().withMessage('Fecha "hasta" invalida'),
];

module.exports = {
  registro,
  login,
  actualizarPerfil,
  cambiarPassword,
  configuracionMedico,
  estadoMedico,
  duracionTurno,
  crearMedicoAdmin,
  actualizarMedicoAdmin,
  eliminarMedico,
  credencialesMp,
  consultorio,
  horario,
  reservarTurno,
  cancelarTurno,
  crearPreferencia,
  generarPeriodo,
  reservaPublica,
  agendaDia,
  cancelarDia,
  obraSocial,
  datosPaciente,
  evolucion,
  idParam,
  rangoFechas,
};
