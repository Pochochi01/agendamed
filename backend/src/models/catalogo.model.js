/**
 * models/catalogo.model.js
 * Tablas de catalogo introducidas por la normalizacion a 3FN:
 * `especialidades` y `localidades`.
 */
const { query, queryOne } = require('../config/db');

const Catalogo = {
  listarEspecialidades() {
    return query('SELECT id, nombre FROM especialidades ORDER BY nombre');
  },

  findEspecialidad(id) {
    return queryOne('SELECT id, nombre FROM especialidades WHERE id = ?', [id]);
  },

  /** Alta idempotente: devuelve la existente si el nombre ya esta cargado. */
  async crearEspecialidadSiNoExiste(nombre) {
    const existente = await queryOne('SELECT id, nombre FROM especialidades WHERE nombre = ?', [nombre]);
    if (existente) return existente;
    const res = await query('INSERT INTO especialidades (nombre) VALUES (?)', [nombre]);
    return { id: res.insertId, nombre };
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
