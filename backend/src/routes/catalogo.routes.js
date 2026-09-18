/**
 * routes/catalogo.routes.js   ->  /api/catalogo
 * Especialidades y localidades: datos publicos que alimentan los selects del
 * frontend (registro de medico, alta de consultorio, filtros de busqueda).
 */
const { Router } = require('express');
const Catalogo = require('../models/catalogo.model');
const asyncHandler = require('../utils/asyncHandler');

const router = Router();

router.get('/especialidades', asyncHandler(async (_req, res) => {
  res.json({ ok: true, especialidades: await Catalogo.listarEspecialidades() });
}));

router.get('/localidades', asyncHandler(async (_req, res) => {
  res.json({ ok: true, localidades: await Catalogo.listarLocalidades() });
}));

// Alimenta el select de obra social del modal del turno.
router.get('/obras-sociales', asyncHandler(async (_req, res) => {
  res.json({ ok: true, obrasSociales: await Catalogo.listarObrasSociales() });
}));

module.exports = router;
