/**
 * utils/formato.js
 * Helpers de presentacion: fechas, moneda y etiquetas de estado.
 *
 * Las fechas llegan del backend como string "YYYY-MM-DD" y se parsean a mano
 * para evitar que `new Date('2026-01-05')` las interprete como UTC y muestre
 * el dia anterior.
 */

export const DIAS_SEMANA = ['', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado', 'Domingo'];
export const DIAS_CORTOS = ['', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'];

/** "YYYY-MM-DD" -> Date local (sin corrimiento de zona horaria). */
export function aFechaLocal(fechaIso) {
  const [a, m, d] = String(fechaIso).slice(0, 10).split('-').map(Number);
  return new Date(a, m - 1, d);
}

/** "2026-09-21" -> "lunes 21 de septiembre" */
export function fechaLarga(fechaIso) {
  return aFechaLocal(fechaIso).toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

/** "2026-09-21" -> "21/09/2026" */
export function fechaCorta(fechaIso) {
  return aFechaLocal(fechaIso).toLocaleDateString('es-AR');
}

/** "09:30:00" -> "09:30" */
export function hora(valor) {
  return String(valor || '').slice(0, 5);
}

/** 18000 -> "$ 18.000" */
export function moneda(valor) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
  }).format(Number(valor || 0));
}

/** dia_semana (1..7) de una fecha ISO, consistente con el backend. */
export function diaSemanaDeFecha(fechaIso) {
  const d = aFechaLocal(fechaIso).getDay();
  return d === 0 ? 7 : d;
}

/** Fecha de hoy en formato "YYYY-MM-DD" (hora local). */
export function hoyIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Suma dias y devuelve "YYYY-MM-DD". */
export function sumarDias(fechaIso, dias) {
  const f = aFechaLocal(fechaIso);
  f.setDate(f.getDate() + dias);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
}

/** Lunes de la semana a la que pertenece la fecha dada. */
export function lunesDeLaSemana(fechaIso) {
  return sumarDias(fechaIso, -(diaSemanaDeFecha(fechaIso) - 1));
}

/** Clase de badge + etiqueta segun el estado del turno. */
export function estiloEstadoTurno(estado) {
  const mapa = {
    pendiente:  { clase: 'badge-amarillo', texto: 'Pendiente de pago' },
    confirmado: { clase: 'badge-verde',    texto: 'Confirmado' },
    cancelado:  { clase: 'badge-rojo',     texto: 'Cancelado' },
    completado: { clase: 'badge-azul',     texto: 'Completado' },
    ausente:    { clase: 'badge-gris',     texto: 'Ausente' },
  };
  return mapa[estado] || { clase: 'badge-gris', texto: estado };
}

/** Clase de badge + etiqueta segun el estado de pago o suscripcion. */
export function estiloEstadoPago(estado) {
  const mapa = {
    pendiente:   { clase: 'badge-amarillo', texto: 'Pendiente' },
    aprobado:    { clase: 'badge-verde',    texto: 'Aprobado' },
    pagada:      { clase: 'badge-verde',    texto: 'Pagada' },
    rechazado:   { clase: 'badge-rojo',     texto: 'Rechazado' },
    vencida:     { clase: 'badge-rojo',     texto: 'Vencida' },
    reembolsado: { clase: 'badge-gris',     texto: 'Reembolsado' },
  };
  return mapa[estado] || { clase: 'badge-gris', texto: estado };
}

/** Horas que faltan para un turno (negativo si ya paso). */
export function horasHasta(fechaIso, horaStr) {
  const f = aFechaLocal(fechaIso);
  const [hh, mm] = String(horaStr || '00:00').split(':').map(Number);
  f.setHours(hh, mm, 0, 0);
  return (f.getTime() - Date.now()) / 36e5;
}
