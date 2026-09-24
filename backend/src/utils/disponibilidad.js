/**
 * utils/disponibilidad.js
 * Calcula los slots libres de un medico.
 *
 * Algoritmo:
 *   1. Toma los bloques de `horarios` del dia de la semana correspondiente.
 *   2. Descarta los consultorios marcados como ausencia para esa fecha.
 *   3. Los parte en slots de `duracion_turno_min` minutos.
 *   4. Descarta los slots que se superponen con turnos vigentes.
 *   5. Descarta los slots que ya pasaron (si la fecha es hoy).
 *   6. Si el medico usa ORDEN DE LLEGADA, deja solo el primer turno libre de
 *      cada consultorio, salvo en las jornadas que arrancan dentro de las
 *      proximas 6 horas, donde se ofrecen todos los libres.
 *
 * Todo se recalcula en cada consulta a partir del estado actual de los
 * turnos. No hay ningun contador ni puntero guardado, y eso es lo que hace
 * que una cancelacion libere el lugar sola: el turno deja de estar ocupado y
 * en la siguiente consulta vuelve a aparecer.
 *
 * Trabaja con minutos enteros; no hay objetos Date de por medio, asi que no
 * hay corrimientos de zona horaria.
 */
const Horario = require('../models/horario.model');
const Turno = require('../models/turno.model');
const Ausencia = require('../models/ausencia.model');
const {
  horaAMinutos, minutosAHora, diaSemanaDeFecha, seSuperponen, hoyIso, sumarDias, horasHasta,
} = require('./tiempo');

/**
 * Ventana de liberacion del modo ORDEN DE LLEGADA.
 *
 * Cuando faltan menos de estas horas para que empiece la jornada, la fila
 * deja de aplicarse y se ofrecen TODOS los turnos libres de esa jornada.
 *
 * Por que existe: la fila sirve para repartir por orden mientras hay tiempo,
 * pero cerca del horario se vuelve en contra. Si dos pacientes cancelaron a
 * ultimo momento, ofrecer un unico turno hace que esos huecos queden sin
 * cubrir aunque haya gente buscando, y el consultorio termina con la sala
 * vacia a las 10 y llena a las 11. Con la ventana abierta se ven los huecos
 * intermedios y tambien la cola de la jornada.
 */
const HORAS_VENTANA_LIBERACION = 6;

/**
 * @param {Object} medico  fila de v_medicos (necesita id y duracion_turno_min)
 * @param {string} fecha   "YYYY-MM-DD"
 * @param {Object} [opciones]
 * @param {boolean} [opciones.aplicarModoAgenda=true]
 *   `true` devuelve lo que puede reservar un paciente: con ORDEN DE LLEGADA,
 *   solo los turnos habilitados. `false` devuelve TODOS los huecos libres,
 *   cada uno con su bandera `habilitado`.
 *
 *   La agenda del medico usa `false`: el profesional necesita ver sus huecos
 *   reales para saber como tiene el dia. Con el filtro puesto veria un unico
 *   hueco verde y parecerian turnos que no existen. Toda reserva, en cambio,
 *   pasa por `buscarSlot`, que si aplica el modo.
 * @returns {Promise<Array<Object>>}
 */
async function slotsDelDia(medico, fecha, { aplicarModoAgenda = true } = {}) {
  const diaSemana = diaSemanaDeFecha(fecha);
  const todosLosBloques = await Horario.listarPorMedicoYDia(medico.id, diaSemana);
  if (!todosLosBloques.length) return [];

  // El medico pudo cancelar el dia en algunos consultorios (o en todos): esos
  // bloques no generan disponibilidad, para que no entren turnos nuevos.
  const bloqueados = await Ausencia.consultoriosBloqueados(medico.id, fecha);
  const bloques = bloqueados.length
    ? todosLosBloques.filter((b) => !bloqueados.includes(b.consultorio_id))
    : todosLosBloques;
  if (!bloques.length) return [];

  const ocupados = await Turno.listarOcupadosDelDia(medico.id, fecha);
  const ocupadosMin = ocupados.map((t) => ({
    inicio: horaAMinutos(t.hora_inicio),
    fin: horaAMinutos(t.hora_fin),
  }));

  const duracion = Number(medico.duracion_turno_min) || 30;
  const esHoy = fecha === hoyIso();
  const ahora = new Date();
  const minutosAhora = ahora.getHours() * 60 + ahora.getMinutes();

  const slots = [];

  for (const bloque of bloques) {
    const inicioBloque = horaAMinutos(bloque.hora_inicio);
    const finBloque = horaAMinutos(bloque.hora_fin);

    /*
     * Cuanto falta para que arranque ESTA jornada. Se mide por bloque y no
     * por dia porque un profesional puede atender de 9 a 12 en una sede y de
     * 16 a 20 en otra: son dos filas distintas y cada una entra en la ventana
     * por su cuenta.
     *
     * horasHasta() trabaja con Date completos, asi que el calculo tambien es
     * correcto cuando la jornada es manana temprano y ahora es de noche.
     * El valor es negativo con la jornada ya empezada, que tambien cuenta
     * como dentro de la ventana: es justo cuando mas interesa cubrir huecos.
     */
    const jornadaProxima = horasHasta(fecha, bloque.hora_inicio) < HORAS_VENTANA_LIBERACION;

    for (let m = inicioBloque; m + duracion <= finBloque; m += duracion) {
      const fin = m + duracion;

      // Ya paso la hora -> no se ofrece.
      if (esHoy && m <= minutosAhora) continue;

      // Choca con un turno vigente (propio o de otro consultorio del medico).
      const chocado = ocupadosMin.some((o) => seSuperponen(m, fin, o.inicio, o.fin));
      if (chocado) continue;

      slots.push({
        fecha,
        horaInicio: minutosAHora(m),
        horaFin: minutosAHora(fin),
        consultorioId: bloque.consultorio_id,
        consultorio: bloque.consultorio,
        localidad: bloque.localidad,
        // Inicio de la jornada a la que pertenece el turno, y si esa jornada
        // ya entro en la ventana de liberacion. La pantalla del paciente lo
        // usa para explicar por que de golpe hay mas turnos a la vista.
        jornadaInicio: minutosAHora(inicioBloque),
        jornadaProxima,
      });
    }
  }

  const ordenados = slots.sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));

  /*
   * MODO ORDEN DE LLEGADA
   * ---------------------
   * Solo se ofrece el PRIMER turno libre de cada consultorio. Al ocuparse,
   * el siguiente pasa a ser el primero libre y se habilita solo: no hay
   * estado que mantener, porque "el primero disponible" se recalcula en cada
   * consulta a partir de los turnos vigentes.
   *
   * Eso resuelve tambien el caso de la cancelacion: si se libera un turno
   * anterior al que estaba habilitado, vuelve a ser el primero libre y se
   * vuelve a ofrecer; la secuencia continua desde ahi.
   *
   * El filtro es POR CONSULTORIO y no por dia: un profesional que atiende a
   * la manana en una sede y a la tarde en otra tiene dos filas distintas, y
   * habilitar un unico turno para ambas dejaria una sede sin poder reservar.
   *
   * VENTANA DE LAS 6 HORAS
   * ----------------------
   * Las jornadas que arrancan dentro de las proximas 6 horas quedan exentas
   * de la fila: se ofrecen todos sus turnos libres, incluidos los huecos que
   * dejaron las cancelaciones y el ultimo turno de la jornada.
   *
   * No hace falta consultar los turnos cancelados por separado: un turno
   * cancelado sale del indice de ocupacion (ver activo_key en el esquema), asi
   * que para este calculo ya es un horario libre mas. "Verificar los
   * cancelados" es, literalmente, no filtrarlos.
   *
   * Ejemplo — jornada de 9 a 12, turnos de 20 min, ocupados de 9 a 11, y se
   * cancelan el de 9:20 y el de 10:00. Faltando menos de 6 horas se ofrecen
   * los dos huecos (9:20 y 10:00) junto con la cola libre de la jornada
   * (11:00, 11:20 y 11:40). Fuera de la ventana solo se ofreceria 9:20.
   *
   * Las jornadas que todavia estan lejos siguen en fila normalmente, asi que
   * un dia puede tener la manana liberada y la tarde secuencial.
   */
  if (medico.modo_agenda !== 'orden_llegada') {
    // Seleccion libre: todo turno libre esta habilitado.
    ordenados.forEach((slot) => { slot.habilitado = true; });
    return ordenados;
  }

  // Primer turno libre de cada consultorio entre las jornadas que SIGUEN en
  // fila. Las que ya entraron en la ventana no participan del reparto.
  const primeroPorConsultorio = new Map();
  for (const slot of ordenados) {
    if (slot.jornadaProxima) continue;
    if (!primeroPorConsultorio.has(slot.consultorioId)) {
      primeroPorConsultorio.set(slot.consultorioId, slot);
    }
  }
  const habilitadosEnFila = new Set(primeroPorConsultorio.values());

  ordenados.forEach((slot) => {
    slot.habilitado = slot.jornadaProxima || habilitadosEnFila.has(slot);
  });

  return aplicarModoAgenda ? ordenados.filter((s) => s.habilitado) : ordenados;
}

/**
 * Disponibilidad de varios dias consecutivos (vista de calendario).
 * @param {Object} medico
 * @param {string} desde  "YYYY-MM-DD"
 * @param {number} dias   cantidad de dias a proyectar (max 60)
 * @returns {Promise<Array<{fecha:string, slots:Array}>>}
 */
async function slotsDelRango(medico, desde, dias = 14) {
  const total = Math.min(Math.max(Number(dias) || 14, 1), 60);
  const resultado = [];

  for (let i = 0; i < total; i += 1) {
    const fecha = sumarDias(desde, i);
    // eslint-disable-next-line no-await-in-loop
    const slots = await slotsDelDia(medico, fecha);
    resultado.push({ fecha, slots });
  }

  return resultado;
}

/**
 * Verifica que un slot concreto sea valido y este libre. Es la validacion
 * previa a reservar (la garantia definitiva la da la transaccion + el
 * indice unico de `turnos`).
 *
 * @returns {Promise<Object|null>} el slot si existe y esta libre, si no null
 */
async function buscarSlot(medico, fecha, horaInicio) {
  const slots = await slotsDelDia(medico, fecha);
  const objetivo = horaAMinutos(horaInicio);
  return slots.find((s) => horaAMinutos(s.horaInicio) === objetivo) || null;
}

module.exports = { slotsDelDia, slotsDelRango, buscarSlot };
