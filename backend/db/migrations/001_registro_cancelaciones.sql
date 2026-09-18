-- ============================================================================
--  Migracion 001 - Indice del registro de cancelaciones
--
--  Sostiene el recuento de cancelaciones previas de un paciente con un medico,
--  que la agenda calcula para cada turno que muestra (ver turno.model.js ->
--  SELECT_BASE, columnas cancelaciones_paciente / ultima_cancelacion_paciente).
--
--  Sin este indice cada fila de la agenda dispara dos subconsultas que
--  recorren `turnos` entero.
-- ============================================================================

USE agendamed;

ALTER TABLE turnos
  ADD KEY ix_turnos_cancelaciones (paciente_id, medico_id, estado, cancelado_por);
