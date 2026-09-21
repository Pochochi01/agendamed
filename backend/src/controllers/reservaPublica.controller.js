/**
 * controllers/reservaPublica.controller.js
 * Agendamiento directo por enlace: /reservar/:hash
 *
 * Es el unico flujo de reserva SIN sesion: el paciente entra por un enlace que
 * el medico comparte (normalmente por WhatsApp), ve los turnos libres de ese
 * profesional y reserva cargando solo nombre y DNI.
 *
 * --------------------------------------------------------------------------
 * El WhatsApp: lo pone el PACIENTE y viaja como parametro
 * --------------------------------------------------------------------------
 * El enlace del medico es UNO SOLO y generico: el mismo para todos, sin el
 * numero de nadie.
 *
 * Al entrar, la pagina le pide al paciente su WhatsApp antes que nada y lo
 * pasa a la URL (`?wa=`). Desde ese momento es un dato fijo: cuando completa
 * nombre, apellido y DNI, el campo aparece cargado y bloqueado.
 *
 * Del lado del servidor el numero se toma de `wa` con prioridad sobre
 * `whatsapp`, justamente porque `wa` es el que vino del parametro. Si un
 * cliente mandara los dos con valores distintos, gana el parametro: el campo
 * del formulario no puede pisarlo.
 *
 * Nota: ninguna API web expone el telefono del dispositivo, asi que el numero
 * tiene que declararlo la persona. Es un dato informado, no verificado; para
 * confirmarlo habria que mandar un codigo por WhatsApp, que excede este
 * modulo.
 */
const Medico = require('../models/medico.model');
const Paciente = require('../models/paciente.model');
const Turno = require('../models/turno.model');
const ApiError = require('../utils/ApiError');
const { esIdentificadorValido } = require('../utils/enlaceMedico');
const { baseUrlPublica, esCompartible } = require('../utils/urlPublica');
const { slotsDelRango, buscarSlot } = require('../utils/disponibilidad');
const { hoyIso } = require('../utils/tiempo');

/** Deja el telefono en digitos (admite el + inicial). */
function normalizarWhatsapp(valor) {
  if (!valor) return null;
  const limpio = String(valor).trim().replace(/[^\d+]/g, '');
  const soloDigitos = limpio.replace(/\D/g, '');
  // Entre 8 y 15 digitos: cubre numeros locales e internacionales (E.164).
  if (soloDigitos.length < 8 || soloDigitos.length > 15) return null;
  return soloDigitos;
}

/** Resuelve el medico del identificador del enlace o lanza 404. */
async function medicoDelHash(hash) {
  if (!esIdentificadorValido(hash)) throw ApiError.notFound('El enlace no es valido');

  const medico = await Medico.findByHashPublico(hash);
  if (!medico) throw ApiError.notFound('El enlace no es valido o fue dado de baja');
  if (!medico.enlace_activo) throw ApiError.notFound('El profesional desactivo este enlace');
  if (medico.estado !== 'activo' || !medico.usuario_activo) {
    throw ApiError.notFound('El profesional no esta recibiendo turnos en este momento');
  }
  return medico;
}

/**
 * GET /api/reservar/:hash?desde=YYYY-MM-DD&dias=30&wa=549...&fw=...
 *
 * Renderiza todo lo que la pagina publica necesita en una sola llamada: los
 * datos del profesional y su calendario de turnos libres.
 *
 * NO se exponen email ni telefono del medico: es una pagina publica.
 */
async function disponibilidadPorHash(req, res) {
  const medico = await medicoDelHash(req.params.hash);

  const desde = req.query.desde || hoyIso();
  const dias = Number(req.query.dias || 30);
  const calendario = await slotsDelRango(medico, desde, dias);

  return res.json({
    ok: true,
    medico: {
      nombre: medico.nombre,
      apellido: medico.apellido,
      especialidad: medico.especialidad,
      matricula: medico.matricula,
      duracionTurnoMin: medico.duracion_turno_min,
      precioConsulta: medico.precio_consulta,
      porcentajeSena: medico.porcentaje_sena,
      mercadopagoConfigurado: Boolean(medico.mercadopago_configurado),
    },
    // Solo los dias con turnos libres: la pagina publica no muestra dias vacios.
    calendario: calendario.filter((d) => d.slots.length > 0),
  });
}

/**
 * POST /api/reservar/:hash
 * Body: { nombre, apellido, dni, whatsapp, fecha, horaInicio, consultorioId?, motivoConsulta? }
 *
 * Reserva sin sesion. El paciente se identifica por DNI: si ya existe se
 * reutiliza, y si no se crea como INVITADO (usuario sin credenciales).
 *
 * `whatsapp` lo escribe el propio paciente y es obligatorio: es el unico canal
 * que tiene el profesional para contactarlo despues, porque una reserva por
 * enlace no deja email ni cuenta.
 */
async function reservarPorHash(req, res) {
  const medico = await medicoDelHash(req.params.hash);

  const { nombre, apellido, dni, fecha, horaInicio, consultorioId = null, motivoConsulta = null } = req.body;

  /*
   * El parametro `wa` (o `?wa=` en la query) tiene PRIORIDAD sobre el campo
   * `whatsapp` del cuerpo: es el que el paciente confirmo al entrar y el que
   * la pagina muestra bloqueado. Si llegaran los dos, el del formulario no
   * puede sobreescribirlo.
   */
  const whatsapp = normalizarWhatsapp(req.body.wa ?? req.query.wa ?? req.body.whatsapp);
  if (!whatsapp) {
    throw ApiError.badRequest(
      'Ingresa un numero de WhatsApp valido: es la unica forma que tiene el consultorio '
      + 'de comunicarse con vos.'
    );
  }

  if (fecha < hoyIso()) throw ApiError.badRequest('No se pueden reservar turnos en fechas pasadas');

  // El slot debe existir en la plantilla, no estar tomado y no caer en un dia
  // que el medico haya cancelado (slotsDelDia ya descuenta las ausencias).
  const slot = await buscarSlot(medico, fecha, horaInicio);
  if (!slot) {
    throw ApiError.conflict('Ese horario no esta disponible. Actualiza la pagina y elegi otro.');
  }
  if (consultorioId && Number(consultorioId) !== slot.consultorioId) {
    throw ApiError.conflict(
      `Ese horario corresponde al consultorio "${slot.consultorio}". Actualiza la pagina y volve a elegir.`
    );
  }

  // Paciente: se reutiliza por DNI o se crea como invitado.
  let paciente = await Paciente.findByDni(dni);
  if (paciente) {
    // Se guarda el ultimo numero informado: es el que sirve para contactarlo.
    await Paciente.actualizarWhatsapp(paciente.id, whatsapp);
  } else {
    const pacienteId = await Paciente.crearInvitado({
      nombre: nombre.trim(),
      apellido: apellido.trim(),
      dni: String(dni).trim(),
      telefonoWhatsapp: whatsapp,
    });
    paciente = await Paciente.findById(pacienteId);
  }

  const cobraOnline = Boolean(medico.mercadopago_configurado) && Number(medico.precio_consulta) > 0;

  try {
    const turnoId = await Turno.reservar({
      pacienteId: paciente.id,
      medicoId: medico.id,
      consultorioId: slot.consultorioId,
      fecha,
      horaInicio: slot.horaInicio,
      horaFin: slot.horaFin,
      montoTotal: medico.precio_consulta,
      motivoConsulta,
      // Queda registrado el numero con el que se hizo ESTA reserva.
      telefonoWhatsapp: whatsapp,
      canal: 'enlace_directo',
    });

    if (!cobraOnline) await Turno.cambiarEstado(turnoId, 'confirmado');

    const turno = await Turno.findById(turnoId);

    return res.status(201).json({
      ok: true,
      mensaje: cobraOnline
        ? 'Turno reservado. Para confirmarlo hay que abonar la sena o el total.'
        : 'Turno confirmado. La consulta se abona en el consultorio.',
      requierePago: cobraOnline,
      turno: {
        id: turno.id,
        fecha: turno.fecha,
        horaInicio: turno.hora_inicio,
        horaFin: turno.hora_fin,
        estado: turno.estado,
        consultorio: turno.consultorio,
        direccion: turno.consultorio_direccion,
        montoTotal: Number(turno.monto_total),
      },
      paciente: {
        nombre: paciente.nombre,
        apellido: paciente.apellido,
        dni: paciente.dni,
        whatsapp: whatsapp,
      },
    });
  } catch (error) {
    if (error.code === 'SLOT_OCUPADO' || error.code === 'ER_DUP_ENTRY') {
      throw ApiError.conflict('Ese horario acaba de ser reservado por otra persona');
    }
    throw error;
  }
}

/**
 * GET /api/medicos/mi/enlace  (medico)
 * Devuelve el enlace para compartir. Lo genera si el medico no lo tenia.
 */
async function miEnlace(req, res) {
  const identificador = await Medico.asegurarHashPublico(req.medico.id);
  const medico = await Medico.findById(req.medico.id);

  // La base se deduce de la request (dominio real detras de Nginx) en vez de
  // depender de FRONTEND_URL, que suele quedar en localhost. Ver urlPublica.js
  const base = baseUrlPublica(req);
  const url = `${base}/reservar/${identificador}`;

  return res.json({
    ok: true,
    hash: identificador,
    identificador,
    url,
    base,
    activo: Boolean(medico.enlace_activo),
    /*
     * Datos para la tarjeta con el codigo QR que el profesional imprime o
     * comparte. Van en esta misma respuesta y no en otra consulta porque la
     * tarjeta los necesita junto con el enlace: pedirlos por separado seria
     * dos llamadas para armar una sola cosa.
     */
    profesional: {
      nombre: medico.nombre,
      apellido: medico.apellido,
      especialidad: medico.especialidad,
      matricula: medico.matricula,
    },
    // El frontend avisa si el enlace quedo apuntando a localhost, para que el
    // medico no copie algo que nadie puede abrir.
    compartible: esCompartible(base),
    /*
     * El enlace es UNO SOLO y sirve para todos los pacientes. Ya no se arma
     * uno por persona con su numero: el paciente escribe su WhatsApp en el
     * formulario de reserva y queda guardado en el turno.
     */
    ayuda: 'Compartí este mismo enlace con todos tus pacientes. '
      + 'Cada uno ingresa su WhatsApp al reservar y lo vas a ver en el turno.',
  });
}

/** POST /api/medicos/mi/enlace/regenerar  (medico) */
async function regenerarEnlace(req, res) {
  const medico = await Medico.regenerarHashPublico(req.medico.id);
  const base = baseUrlPublica(req);

  return res.json({
    ok: true,
    mensaje: 'Enlace regenerado. El anterior dejo de funcionar.',
    hash: medico.hash_publico,
    identificador: medico.hash_publico,
    url: `${base}/reservar/${medico.hash_publico}`,
    compartible: esCompartible(base),
  });
}

/** PATCH /api/medicos/mi/enlace  (medico) Body: { activo } */
async function cambiarEstadoEnlace(req, res) {
  const activo = Boolean(req.body.activo);
  const medico = await Medico.setEnlaceActivo(req.medico.id, activo);
  return res.json({
    ok: true,
    mensaje: activo ? 'Enlace activado' : 'Enlace desactivado',
    activo: Boolean(medico.enlace_activo),
  });
}

module.exports = {
  disponibilidadPorHash,
  reservarPorHash,
  miEnlace,
  regenerarEnlace,
  cambiarEstadoEnlace,
  normalizarWhatsapp,
};
