/**
 * utils/tratamiento.js
 * Tratamiento del profesional segun su genero: "Dr." o "Dra."
 *
 * Existe una copia equivalente en frontend/src/utils/tratamiento.js. Se
 * duplica a proposito: son dos bundles distintos y montar un paquete
 * compartido para seis lineas costaria mas de lo que ahorra. Si se cambia uno,
 * cambiar el otro.
 */

/** Forma neutra para los profesionales que todavia no cargaron su genero. */
const NEUTRO = 'Dr/a.';

/**
 * @param {'masculino'|'femenino'|null|undefined} genero
 * @returns {string} "Dr.", "Dra." o "Dr/a."
 */
function tratamiento(genero) {
  if (genero === 'masculino') return 'Dr.';
  if (genero === 'femenino') return 'Dra.';
  return NEUTRO;
}

/**
 * Nombre completo con tratamiento, listo para mostrar.
 *
 * Dos ordenes, segun para quien sea el texto:
 *
 *   natural: false  ->  "Dra. Romero, Laura"   listados y pantallas internas,
 *                                              donde se busca por apellido
 *   natural: true   ->  "Dra. Laura Romero"    material para el paciente,
 *                                              donde se lee como presentacion
 *
 * @param {Object} medico  con genero, apellido y nombre
 * @param {Object} [opciones]
 * @param {boolean} [opciones.soloApellido]
 * @param {boolean} [opciones.natural]
 * @returns {string}
 */
function nombreConTratamiento(medico, { soloApellido = false, natural = false } = {}) {
  if (!medico) return '';
  const titulo = tratamiento(medico.genero ?? medico.medico_genero);
  if (soloApellido) return `${titulo} ${medico.apellido}`;
  if (natural) return `${titulo} ${medico.nombre} ${medico.apellido}`;
  return `${titulo} ${medico.apellido}, ${medico.nombre}`;
}

module.exports = { tratamiento, nombreConTratamiento, NEUTRO };
