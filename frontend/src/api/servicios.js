/**
 * api/servicios.js
 * Capa de acceso a la API agrupada por recurso. Los componentes nunca llaman
 * a axios directo: importan de aca. Asi los endpoints quedan en un solo lugar.
 */
import api from './axios';

/* --------------------------------- AUTH --------------------------------- */
export const authApi = {
  registro: (datos) => api.post('/auth/registro', datos).then((r) => r.data),
  login: (credenciales) => api.post('/auth/login', credenciales).then((r) => r.data),
  perfil: () => api.get('/auth/perfil').then((r) => r.data),
  actualizarPerfil: (datos) => api.put('/auth/perfil', datos).then((r) => r.data),
  cambiarPassword: (datos) => api.put('/auth/password', datos).then((r) => r.data),
};

/* ------------------------------- CATALOGO ------------------------------- */
export const catalogoApi = {
  /**
   * @param {Object} [params]
   * @param {string} [params.q]  busca por coincidencia en CUALQUIER parte del
   *   nombre, sin distinguir mayusculas ni tildes. Sin `q`, trae el catalogo.
   * @param {number} [params.limite]
   */
  especialidades: (params = {}) =>
    api.get('/catalogo/especialidades', { params }).then((r) => r.data.especialidades),

  /**
   * Agrega una especialidad al catalogo. Idempotente: si ya existe (aun
   * escrita distinto) devuelve la existente con `creada: false`.
   */
  crearEspecialidad: (nombre) =>
    api.post('/catalogo/especialidades', { nombre }).then((r) => r.data),
  localidades: () => api.get('/catalogo/localidades').then((r) => r.data.localidades),
  obrasSociales: () => api.get('/catalogo/obras-sociales').then((r) => r.data.obrasSociales),
};

/* ------------------- RESERVA PUBLICA (enlace directo) ------------------- */
/**
 * Endpoints del enlace /reservar/:hash. No llevan token: el paciente entra
 * sin sesion. El numero de WhatsApp viaja como parametro del enlace.
 */
export const reservaPublicaApi = {
  disponibilidad: (hash, params) => api.get(`/reservar/${hash}`, { params }).then((r) => r.data),
  reservar: (hash, datos) => api.post(`/reservar/${hash}`, datos).then((r) => r.data),
};

/* ------------------------- AGENDA DIARIA (medico) ----------------------- */
export const agendaApi = {
  // Devuelve los intervalos del dia, "disponible" u "ocupado".
  dia: (params) => api.get('/agenda/dia', { params }).then((r) => r.data),
  // Devuelve { ausencias, periodos, motivos }: el detalle por dia y consultorio,
  // los periodos agrupados para la pantalla de suspensiones, y el catalogo de motivos.
  ausencias: (params) => api.get('/agenda/ausencias', { params }).then((r) => r.data),
  cancelarDia: (datos) => api.post('/agenda/cancelar-dia', datos).then((r) => r.data),
  reactivarDia: (datos) => api.delete('/agenda/cancelar-dia', { data: datos }).then((r) => r.data),

  /** Suspende un dia o un rango completo (vacaciones, congreso, curso...). */
  suspender: (datos) => api.post('/agenda/suspender', datos).then((r) => r.data),
  levantarSuspension: (rangoId) =>
    api.delete(`/agenda/suspender/${rangoId}`).then((r) => r.data),
};

/* --------- ACCESO DEL PACIENTE A SU TURNO POR CODIGO (publico) ---------- */
/**
 * Quien reserva por el enlace no tiene cuenta: el codigo que recibe al
 * reservar es su unico acceso al turno. No lleva token.
 */
export const turnoPublicoApi = {
  ver: (codigo) => api.get(`/turno/${codigo}`).then((r) => r.data),
  cancelar: (codigo, motivo) =>
    api.post(`/turno/${codigo}/cancelar`, { motivo }).then((r) => r.data),
};

/* ------------------------- TRANSCRIPCION (dictado) ---------------------- */
/**
 * Envia la grabacion COMPLETA y devuelve el texto.
 *
 * El servidor la procesa en memoria y la descarta: no se guarda en disco ni
 * en la base. Lo que se persiste es el texto, y recien cuando el medico lo
 * revisa y lo guarda con pacientesApi.crearEvolucion.
 */
export const transcripcionApi = {
  estado: () => api.get('/historia/transcribir/estado').then((r) => r.data),

  /**
   * @param {Blob} blob            audio completo de MediaRecorder
   * @param {Function} [onProgreso] recibe 0..100 mientras sube
   */
  transcribir: (blob, onProgreso) => {
    const formulario = new FormData();
    // La extension acompana al mimetype para que el servidor lo reconozca.
    const extension = (blob.type.split(';')[0].split('/')[1] || 'webm');
    formulario.append('audio', blob, `dictado.${extension}`);

    return api.post('/historia/transcribir', formulario, {
      // Se deja que el navegador ponga el boundary del multipart.
      headers: { 'Content-Type': undefined },
      // La transcripcion puede tardar: se sube el timeout por encima del
      // default de 15 s de la instancia.
      timeout: 180000,
      onUploadProgress: (evento) => {
        if (onProgreso && evento.total) {
          onProgreso(Math.round((evento.loaded * 100) / evento.total));
        }
      },
    }).then((r) => r.data);
  },
};

/* ---------------- PACIENTES: obra social e historia clinica ------------- */
/**
 * La historia clinica recibe y devuelve SOLO TEXTO. No hay ningun endpoint
 * que acepte audio: el dictado se transcribe en el navegador.
 */
export const pacientesApi = {
  ficha: (id) => api.get(`/pacientes/${id}`).then((r) => r.data),
  actualizarDatos: (id, datos) => api.patch(`/pacientes/${id}`, datos).then((r) => r.data),
  actualizarObraSocial: (id, datos) =>
    api.patch(`/pacientes/${id}/obra-social`, datos).then((r) => r.data),

  historia: (id) => api.get(`/pacientes/${id}/historia`).then((r) => r.data),
  crearEvolucion: (id, datos) => api.post(`/pacientes/${id}/historia`, datos).then((r) => r.data),
  actualizarEvolucion: (pacienteId, id, texto) =>
    api.put(`/pacientes/${pacienteId}/historia/${id}`, { texto }).then((r) => r.data),
  eliminarEvolucion: (pacienteId, id) =>
    api.delete(`/pacientes/${pacienteId}/historia/${id}`).then((r) => r.data),
};

/* -------------------------------- MEDICOS -------------------------------- */
export const medicosApi = {
  // Publico
  buscar: (params) => api.get('/medicos', { params }).then((r) => r.data.medicos),
  detalle: (id) => api.get(`/medicos/${id}`).then((r) => r.data.medico),
  disponibilidad: (id, params) => api.get(`/medicos/${id}/disponibilidad`, { params }).then((r) => r.data),

  // Admin: CRUD completo
  listarAdmin: (params) => api.get('/medicos/admin/todos', { params }).then((r) => r.data),
  crear: (datos) => api.post('/medicos', datos).then((r) => r.data),
  actualizar: (id, datos) => api.put(`/medicos/${id}`, datos).then((r) => r.data),
  // Baja logica, reversible.
  cambiarEstado: (id, estado) => api.patch(`/medicos/${id}/estado`, { estado }).then((r) => r.data),
  // Eliminacion definitiva: primero se consulta el alcance, y el DELETE exige
  // repetir el email del profesional como confirmacion.
  impactoEliminacion: (id) => api.get(`/medicos/${id}/impacto-eliminacion`).then((r) => r.data),
  eliminar: (id, confirmacion) =>
    api.delete(`/medicos/${id}`, { data: { confirmacion } }).then((r) => r.data),

  // Tenant
  miPerfil: () => api.get('/medicos/mi/perfil').then((r) => r.data),
  actualizarMiPerfil: (datos) => api.put('/medicos/mi/perfil', datos).then((r) => r.data),
  // La duracion del slot se edita desde la pantalla de horarios.
  actualizarDuracionTurno: ({ horas, minutos }) =>
    api.patch('/medicos/mi/duracion-turno', { horas, minutos }).then((r) => r.data),
  misEstadisticas: () => api.get('/medicos/mi/estadisticas').then((r) => r.data.estadisticas),

  // Credenciales de MercadoPago del profesional (cobro de sus turnos).
  // El access token nunca vuelve del servidor: solo el estado de la conexion.
  // Modo de agenda: 'libre' u 'orden_llegada'.
  actualizarModoAgenda: (modoAgenda) =>
    api.patch('/medicos/mi/modo-agenda', { modoAgenda }).then((r) => r.data),

  /**
   * Enlace de agendamiento y su codigo QR.
   * El QR viene de la base: es el mismo que se emitio, y la respuesta informa
   * con `qrVerificado` si codifica la direccion del enlace vigente.
   */
  miEnlace: () => api.get('/medicos/mi/enlace').then((r) => r.data),
  regenerarEnlace: () => api.post('/medicos/mi/enlace/regenerar').then((r) => r.data),
  cambiarEstadoEnlace: (activo) => api.patch('/medicos/mi/enlace', { activo }).then((r) => r.data),

  estadoMercadoPago: () => api.get('/medicos/mi/mercadopago').then((r) => r.data),
  conectarMercadoPago: (datos) => api.put('/medicos/mi/mercadopago', datos).then((r) => r.data),
  desconectarMercadoPago: () => api.delete('/medicos/mi/mercadopago').then((r) => r.data),
};

/* ----------------------------- CONSULTORIOS ----------------------------- */
export const consultoriosApi = {
  listar: (params) => api.get('/consultorios', { params }).then((r) => r.data.consultorios),
  crear: (datos) => api.post('/consultorios', datos).then((r) => r.data),
  actualizar: (id, datos) => api.put(`/consultorios/${id}`, datos).then((r) => r.data),
  eliminar: (id) => api.delete(`/consultorios/${id}`).then((r) => r.data),
};

/* -------------------------------- HORARIOS ------------------------------- */
export const horariosApi = {
  listar: () => api.get('/horarios').then((r) => r.data),
  crear: (datos) => api.post('/horarios', datos).then((r) => r.data),
  actualizar: (id, datos) => api.put(`/horarios/${id}`, datos).then((r) => r.data),
  eliminar: (id) => api.delete(`/horarios/${id}`).then((r) => r.data),
};

/* --------------------------------- TURNOS -------------------------------- */
export const turnosApi = {
  reservar: (datos) => api.post('/turnos', datos).then((r) => r.data),
  misTurnos: (params) => api.get('/turnos/mis-turnos', { params }).then((r) => r.data),
  agenda: (params) => api.get('/turnos/agenda', { params }).then((r) => r.data),
  detalle: (id) => api.get(`/turnos/${id}`).then((r) => r.data),
  cancelar: (id, motivo) => api.patch(`/turnos/${id}/cancelar`, { motivo }).then((r) => r.data),
  cambiarEstado: (id, estado) => api.patch(`/turnos/${id}/estado`, { estado }).then((r) => r.data),
  misPacientes: () => api.get('/turnos/mis-pacientes').then((r) => r.data.pacientes),
  // Registro de cancelaciones de un paciente con el medico autenticado.
  cancelacionesDePaciente: (pacienteId) =>
    api.get(`/turnos/pacientes/${pacienteId}/cancelaciones`).then((r) => r.data),
};

/* --------------------------------- PAGOS --------------------------------- */
export const pagosApi = {
  // El cobro sale por la cuenta de MercadoPago del profesional. Si no la tiene
  // configurada, el backend responde 409 y el turno ya quedo confirmado sin
  // pago, asi que el frontend ni siquiera ofrece esta accion.
  crearPreferencia: (turnoId, tipo) => api.post('/pagos/preferencia', { turnoId, tipo }).then((r) => r.data),
  misPagos: () => api.get('/pagos/mis-pagos').then((r) => r.data.pagos),
  recibidos: (params) => api.get('/pagos/recibidos', { params }).then((r) => r.data),
  deTurno: (turnoId) => api.get(`/pagos/turno/${turnoId}`).then((r) => r.data),
};

/* ----------------------------- SUSCRIPCIONES ----------------------------- */
export const suscripcionesApi = {
  listar: (params) => api.get('/suscripciones', { params }).then((r) => r.data.suscripciones),
  generarPeriodo: (datos) => api.post('/suscripciones/generar-periodo', datos).then((r) => r.data),
  cambiarEstado: (id, estado) => api.patch(`/suscripciones/${id}/estado`, { estado }).then((r) => r.data),
  suspenderMorosos: () => api.post('/suscripciones/suspender-morosos').then((r) => r.data),
  mias: () => api.get('/suscripciones/mis-suscripciones').then((r) => r.data),
  pagar: (id) => api.post(`/suscripciones/${id}/pagar`).then((r) => r.data),
  confirmarSimulado: (id) => api.post(`/suscripciones/${id}/confirmar-simulado`).then((r) => r.data),
};
