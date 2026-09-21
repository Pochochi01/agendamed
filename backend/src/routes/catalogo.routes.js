/**
 * routes/catalogo.routes.js   ->  /api/catalogo
 * Especialidades, localidades y obras sociales: datos que alimentan los
 * selects del frontend (registro, alta de consultorio, filtros, perfil).
 *
 * Las lecturas son PUBLICAS: el buscador de medicos las necesita sin sesion.
 * El alta de una especialidad si pide sesion de medico o admin, para que el
 * catalogo no quede expuesto a que cualquiera lo llene de basura.
 */
const { Router } = require('express');
const { body, query: queryValidator } = require('express-validator');
const Catalogo = require('../models/catalogo.model');
const validate = require('../middlewares/validate.middleware');
const { autenticar, permitir } = require('../middlewares/auth.middleware');
const asyncHandler = require('../utils/asyncHandler');

const router = Router();

/**
 * GET /api/catalogo/especialidades?q=texto&limite=20
 *
 * `q` busca por coincidencia en CUALQUIER parte del nombre, sin distinguir
 * mayusculas ni tildes (lo resuelve la collation de la columna).
 * Sin `q` devuelve el catalogo completo, ordenado alfabeticamente.
 */
router.get(
  '/especialidades',
  queryValidator('q').optional({ values: 'falsy' }).trim().isLength({ max: 100 }),
  queryValidator('limite').optional({ values: 'falsy' }).isInt({ min: 1, max: 200 }),
  validate,
  asyncHandler(async (req, res) => {
    const especialidades = await Catalogo.listarEspecialidades({
      busqueda: req.query.q || '',
      limite: Number(req.query.limite || 0),
    });
    res.json({ ok: true, especialidades, total: especialidades.length });
  })
);

/**
 * POST /api/catalogo/especialidades   (medico o admin)
 * Body: { nombre }
 *
 * Para cuando el profesional no encuentra la suya en la lista.
 *
 * Es idempotente: si ya existe (aun escrita con otra capitalizacion o sin
 * tildes) devuelve la existente en lugar de crear un duplicado, y avisa con
 * `creada: false`. Asi el catalogo no se fragmenta en variantes del mismo
 * nombre.
 */
router.post(
  '/especialidades',
  autenticar,
  permitir('medico', 'admin'),
  body('nombre')
    .trim()
    .notEmpty().withMessage('Escribi el nombre de la especialidad')
    .isLength({ min: 3, max: 100 })
    .withMessage('El nombre debe tener entre 3 y 100 caracteres')
    // Letras (con tildes), numeros, espacios y los signos que aparecen en
    // nombres reales: "Cirugia Cardiovascular", "Clinica Medica - Adultos".
    .matches(/^[\p{L}\p{N}\s.,()/-]+$/u)
    .withMessage('El nombre tiene caracteres no permitidos'),
  validate,
  asyncHandler(async (req, res) => {
    const especialidad = await Catalogo.crearEspecialidadSiNoExiste(req.body.nombre);

    return res.status(especialidad.creada ? 201 : 200).json({
      ok: true,
      mensaje: especialidad.creada
        ? `Especialidad "${especialidad.nombre}" agregada`
        : `Esa especialidad ya estaba cargada como "${especialidad.nombre}"`,
      especialidad: { id: especialidad.id, nombre: especialidad.nombre },
      creada: especialidad.creada,
    });
  })
);

router.get('/localidades', asyncHandler(async (_req, res) => {
  res.json({ ok: true, localidades: await Catalogo.listarLocalidades() });
}));

// Alimenta el select de obra social del modal del turno.
router.get('/obras-sociales', asyncHandler(async (_req, res) => {
  res.json({ ok: true, obrasSociales: await Catalogo.listarObrasSociales() });
}));

module.exports = router;
