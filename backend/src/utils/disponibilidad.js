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
 *
 * Trabaja con minutos enteros; no hay objetos Date de por medio, asi que no
 * hay corrimientos de zona horaria.
 */
const Horario = require('../models/horario.model');
const Turno = require('../models/turno.model');
const Ausencia = require('../models/ausencia.model');
const { horaAMinutos, minutosAHora, diaSemanaDeFecha, seSuperponen, hoyIso, sumarDias } = require('./tiempo');

/**
 * @param {Object} medico  fila de v_medicos (necesita id y duracion_turno_min)
 * @param {string} fecha   "YYYY-MM-DD"
 * @returns {Promise<Array<{fecha,horaInicio,horaFin,consultorioId,consultorio,localidad}>>}
 */
async function slotsDelDia(medico, fecha) {
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
      });
    }
  }

  return slots.sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));
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
