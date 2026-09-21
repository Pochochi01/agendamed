/**
 * controllers/reservaPublica.controller.js
 * Agendamiento directo por enlace: /reservar/:hash
 *
 * Es el unico flujo de reserva SIN sesion: el paciente entra por un enlace que
 * el medico comparte (normalmente por WhatsApp), ve los turnos libres de ese
 * profesional y reserva cargando solo nombre y DNI.
 *
 * --------------------------------------------------------------------------
 * Sobre el numero de WhatsApp
 * --------------------------------------------------------------------------
 * El navegador NO puede leer el telefono del dispositivo: no existe ninguna
 * API web que lo exponga. El numero llega como parametro de la URL
 * (?wa=549351...), que es lo que se puede lograr en la practica cuando el
 * enlace lo genera un bot de WhatsApp o se arma uno por paciente.
 *
 * Consecuencia a tener en cuenta: el parametro es texto en una URL y, por lo
 * tanto, un paciente podria editarlo. Se trata como "numero declarado en el
 * origen", no como dato verificado. Para que sea confiable hay que firmarlo
 * (ver `verificarFirmaWhatsapp`, activable con WA_FIRMA_SECRET).
 *
 * Del lado del paciente el numero es de solo lectura: el formulario lo muestra
 * deshabilitado y aca se toma SIEMPRE del parametro de entrada, nunca de un
 * campo editable del formulario.
 */
const crypto = require('crypto');
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

/**
 * Valida la firma del numero, si se configuro WA_FIRMA_SECRET.
 * El enlace se arma como ?wa=<numero>&fw=<hmac>. Sin secreto configurado se
 * acepta el numero sin firmar (modo simple).
 *
 * @returns {{valido:boolean, verificado:boolean}}
 */
function verificarFirmaWhatsapp(numero, firma) {
  const secreto = process.env.WA_FIRMA_SECRET;
  if (!secreto) return { valido: true, verificado: false };
  if (!firma) return { valido: false, verificado: false };

  const esperada = crypto.createHmac('sha256', secreto).update(String(numero)).digest('hex').slice(0, 32);
  const a = Buffer.from(String(firma));
  const b = Buffer.from(esperada);
  const valido = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { valido, verificado: valido };
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

  // El numero viaja en la respuesta ya normalizado, para que el formulario lo
  // muestre deshabilitado y lo reenvie tal cual.
  const whatsapp = normalizarWhatsapp(req.query.wa);
  const firma = whatsapp ? verificarFirmaWhatsapp(whatsapp, req.query.fw) : { valido: true, verificado: false };

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
    whatsapp: {
      numero: whatsapp,
      // El formulario usa esto para avisar si falta el numero en el enlace.
      presente: Boolean(whatsapp),
      firmaValida: firma.valido,
      verificado: firma.verificado,
    },
    // Solo los dias con turnos libres: la pagina publica no muestra dias vacios.
    calendario: calendario.filter((d) => d.slots.length > 0),
  });
}

/**
 * POST /api/reservar/:hash
 * Body: { nombre, apellido, dni, fecha, horaInicio, consultorioId?, motivoConsulta?, wa, fw? }
 *
 * Reserva sin sesion. El paciente se identifica por DNI: si ya existe se
 * reutiliza, y si no se crea como INVITADO (usuario sin credenciales).
 */
async function reservarPorHash(req, res) {
  const medico = await medicoDelHash(req.params.hash);

  const { nombre, apellido, dni, fecha, horaInicio, consultorioId = null, motivoConsulta = null } = req.body;

  // El numero se toma del parametro de entrada, NUNCA de un campo editable.
  const whatsapp = normalizarWhatsapp(req.body.wa ?? req.query.wa);
  if (!whatsapp) {
    throw ApiError.badRequest(
      'El enlace no incluye un numero de WhatsApp valido. Pedile al consultorio el enlace con tu numero.'
    );
  }
  const firma = verificarFirmaWhatsapp(whatsapp, req.body.fw ?? req.query.fw);
  if (!firma.valido) throw ApiError.badRequest('El enlace esta alterado o vencido. Pedi uno nuevo.');

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
    // Si no tenia numero cargado, se completa. Si ya tenia, NO se sobreescribe:
    // el telefono de origen no se modifica ni se borra.
    await Paciente.completarWhatsappSiFalta(paciente.id, whatsapp);
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
    // El frontend avisa si el enlace quedo apuntando a localhost, para que el
    // medico no copie algo que nadie puede abrir.
    compartible: esCompartible(base),
    // Plantilla para compartir por WhatsApp: el consultorio reemplaza el
    // marcador por el numero del paciente antes de enviarlo.
    urlConWhatsapp: `${url}?wa=NUMERO_DEL_PACIENTE`,
    ayuda: 'Agrega ?wa=<numero> al enlace para que el turno quede asociado a ese WhatsApp.',
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
