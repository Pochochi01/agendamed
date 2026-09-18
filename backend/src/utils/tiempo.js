/**
 * utils/tiempo.js
 * Helpers de fecha/hora en formato string (HH:MM:SS / YYYY-MM-DD).
 *
 * Se trabaja con strings y minutos enteros en lugar de objetos Date para
 * evitar corrimientos de zona horaria entre MySQL, Node y el navegador.
 */

const DIAS_SEMANA = ['', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado', 'Domingo'];

/** "09:30" | "09:30:00" -> 570 */
function horaAMinutos(hora) {
  const [h, m] = String(hora).split(':').map(Number);
  return h * 60 + m;
}

/** 570 -> "09:30:00" */
function minutosAHora(minutos) {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

/** Normaliza "9:5" o "09:05" a "09:05:00". */
function normalizarHora(hora) {
  return minutosAHora(horaAMinutos(hora));
}

/**
 * dia_semana segun el esquema: 1=Lunes .. 7=Domingo.
 * getDay() de JS devuelve 0=Domingo, por eso el ajuste.
 * @param {string} fechaIso "YYYY-MM-DD"
 */
function diaSemanaDeFecha(fechaIso) {
  const [a, m, d] = fechaIso.split('-').map(Number);
  const dia = new Date(a, m - 1, d).getDay();
  return dia === 0 ? 7 : dia;
}

/** Dos rangos [aIni,aFin) y [bIni,bFin) en minutos se solapan? */
function seSuperponen(aIni, aFin, bIni, bFin) {
  return aIni < bFin && bIni < aFin;
}

/** Fecha de hoy como "YYYY-MM-DD" en hora local. */
function hoyIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Suma dias a una fecha ISO y devuelve otra fecha ISO. */
function sumarDias(fechaIso, dias) {
  const [a, m, d] = fechaIso.split('-').map(Number);
  const fecha = new Date(a, m - 1, d + dias);
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
}

/** Devuelve un Date local a partir de fecha ISO + hora. */
function aDate(fechaIso, hora = '00:00:00') {
  const [a, m, d] = fechaIso.split('-').map(Number);
  const [hh, mm] = String(hora).split(':').map(Number);
  return new Date(a, m - 1, d, hh || 0, mm || 0, 0, 0);
}

/** Horas que faltan (puede ser negativo) desde ahora hasta fecha+hora. */
function horasHasta(fechaIso, hora) {
  return (aDate(fechaIso, hora).getTime() - Date.now()) / 36e5;
}

module.exports = {
  DIAS_SEMANA,
  horaAMinutos,
  minutosAHora,
  normalizarHora,
  diaSemanaDeFecha,
  seSuperponen,
  hoyIso,
  sumarDias,
  aDate,
  horasHasta,
};
