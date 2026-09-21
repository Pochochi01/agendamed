/**
 * models/catalogo.model.js
 * Tablas de catalogo introducidas por la normalizacion a 3FN:
 * `especialidades` y `localidades`.
 */
const { query, queryOne } = require('../config/db');

const Catalogo = {
  /**
   * Lista especialidades, opcionalmente filtradas por coincidencia PARCIAL.
   *
   * El LIKE lleva comodines a ambos lados, asi que encuentra el texto en
   * cualquier posicion: "logia" trae Cardiologia, Dermatologia, Neurologia...
   *
   * No hace falta normalizar la busqueda: la columna usa la collation
   * utf8mb4_unicode_ci, que ignora mayusculas Y tildes. Buscar "CARDIOLOGÍA"
   * encuentra "Cardiologia" y viceversa.
   *
   * @param {Object} opciones
   * @param {string} [opciones.busqueda] texto a buscar en cualquier parte
   * @param {number} [opciones.limite]   tope de resultados (0 = sin tope)
   */
  listarEspecialidades({ busqueda = '', limite = 0 } = {}) {
    const texto = String(busqueda || '').trim();

    if (!texto) {
      return query(
        `SELECT id, nombre FROM especialidades ORDER BY nombre
         ${limite ? `LIMIT ${Number(limite)}` : ''}`
      );
    }

    /*
     * Se ordena poniendo primero las que EMPIEZAN con el texto buscado y
     * despues las que solo lo contienen. Escribir "car" deberia ofrecer
     * "Cardiologia" antes que "Cirugia Cardiovascular".
     */
    return query(
      `SELECT id, nombre FROM especialidades
        WHERE nombre LIKE CONCAT('%', ?, '%')
        ORDER BY (nombre LIKE CONCAT(?, '%')) DESC, nombre
        ${limite ? `LIMIT ${Number(limite)}` : ''}`,
      [texto, texto]
    );
  },

  /** Busca por nombre exacto. La collation lo hace insensible a caso y tildes. */
  findEspecialidadPorNombre(nombre) {
    return queryOne(
      'SELECT id, nombre FROM especialidades WHERE nombre = ? LIMIT 1',
      [String(nombre || '').trim()]
    );
  },

  findEspecialidad(id) {
    return queryOne('SELECT id, nombre FROM especialidades WHERE id = ?', [id]);
  },

  /**
   * Alta idempotente: si el nombre ya esta cargado devuelve el existente.
   *
   * La comparacion la hace la base con su collation, que ignora caso y
   * tildes: cargar "cardiología" cuando ya existe "Cardiologia" NO crea un
   * duplicado, devuelve la que ya estaba. Es lo que evita que el catalogo se
   * llene de variantes de lo mismo.
   *
   * @returns {Promise<{id:number, nombre:string, creada:boolean}>}
   */
  async crearEspecialidadSiNoExiste(nombre) {
    const limpio = Catalogo.normalizarNombre(nombre);

    const existente = await Catalogo.findEspecialidadPorNombre(limpio);
    if (existente) return { ...existente, creada: false };

    try {
      const res = await query('INSERT INTO especialidades (nombre) VALUES (?)', [limpio]);
      return { id: res.insertId, nombre: limpio, creada: true };
    } catch (error) {
      // Carrera: otro request la creo entre el SELECT y el INSERT.
      if (error.code === 'ER_DUP_ENTRY') {
        const yaCreada = await Catalogo.findEspecialidadPorNombre(limpio);
        if (yaCreada) return { ...yaCreada, creada: false };
      }
      throw error;
    }
  },

  /**
   * Normaliza el nombre antes de guardarlo: recorta, colapsa espacios
   * repetidos y pone la primera letra en mayuscula.
   *
   * No se capitaliza cada palabra a proposito: "Cirugia de mano" se veria mal
   * como "Cirugia De Mano".
   */
  normalizarNombre(nombre) {
    const limpio = String(nombre || '').trim().replace(/\s+/g, ' ');
    if (!limpio) return '';
    return limpio.charAt(0).toUpperCase() + limpio.slice(1);
  },

  /* --------------------------- Obras sociales --------------------------- */

  listarObrasSociales({ soloActivas = true } = {}) {
    return query(
      `SELECT id, nombre, sigla, activa FROM obras_sociales
       ${soloActivas ? 'WHERE activa = 1' : ''}
       ORDER BY nombre`
    );
  },

  findObraSocial(id) {
    return queryOne('SELECT id, nombre, sigla, activa FROM obras_sociales WHERE id = ?', [id]);
  },

  /** Alta idempotente, para cargar una obra social que no estaba en la lista. */
  async crearObraSocialSiNoExiste(nombre, sigla = null) {
    const existente = await queryOne('SELECT id, nombre, sigla FROM obras_sociales WHERE nombre = ?', [nombre]);
    if (existente) return existente;
    const res = await query('INSERT INTO obras_sociales (nombre, sigla) VALUES (?, ?)', [nombre, sigla]);
    return { id: res.insertId, nombre, sigla };
  },

  /* ----------------------------- Localidades --------------------------- */

  listarLocalidades() {
    return query('SELECT id, nombre, provincia FROM localidades ORDER BY provincia, nombre');
  },

  findLocalidad(id) {
    return queryOne('SELECT id, nombre, provincia FROM localidades WHERE id = ?', [id]);
  },

  async crearLocalidadSiNoExiste(nombre, provincia) {
    const existente = await queryOne(
      'SELECT id, nombre, provincia FROM localidades WHERE nombre = ? AND provincia = ?',
      [nombre, provincia]
    );
    if (existente) return existente;
    const res = await query('INSERT INTO localidades (nombre, provincia) VALUES (?, ?)', [nombre, provincia]);
    return { id: res.insertId, nombre, provincia };
  },
};

module.exports = Catalogo;
