/**
 * utils/tratamiento.js
 * Tratamiento del profesional segun su genero: "Dr." o "Dra."
 *
 * Copia equivalente de backend/src/utils/tratamiento.js. Se duplica a
 * proposito: son dos bundles distintos y montar un paquete compartido para
 * seis lineas costaria mas de lo que ahorra. Si se cambia uno, cambiar el otro.
 */

/** Forma neutra para los profesionales que todavia no cargaron su genero. */
export const NEUTRO = 'Dr/a.';

/**
 * @param {'masculino'|'femenino'|null|undefined} genero
 * @returns {string} "Dr.", "Dra." o "Dr/a."
 */
export function tratamiento(genero) {
  if (genero === 'masculino') return 'Dr.';
  if (genero === 'femenino') return 'Dra.';
  return NEUTRO;
}

/**
 * Nombre completo con tratamiento, listo para mostrar.
 *
 * Acepta tanto un objeto con `genero` como uno que ya traiga `tratamiento`
 * resuelto por el backend, para no tener que normalizar en cada llamada.
 *
 * @param {Object} medico
 * @param {Object} [opciones]
 * @param {boolean} [opciones.soloApellido]
 * @returns {string} "Dra. Romero, Laura"
 */
export function nombreConTratamiento(medico, { soloApellido = false } = {}) {
  if (!medico) return '';
  const titulo = medico.tratamiento || tratamiento(medico.genero ?? medico.medico_genero);
  const apellido = medico.apellido || medico.medico_apellido || '';
  const nombre = medico.nombre || medico.medico_nombre || '';

  if (soloApellido || !nombre) return `${titulo} ${apellido}`.trim();
  return `${titulo} ${apellido}, ${nombre}`;
}

/** Opciones del selector de genero. */
export const GENEROS = [
  { valor: 'masculino', etiqueta: 'Hombre', titulo: 'Dr.' },
  { valor: 'femenino', etiqueta: 'Mujer', titulo: 'Dra.' },
];
