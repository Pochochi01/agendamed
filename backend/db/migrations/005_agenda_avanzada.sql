-- ============================================================================
--  Migracion 005 - Enlace por DNI, QR persistido, modos de agenda,
--                  genero del profesional y suspension por rango
--
--  Solo AGREGA columnas y tablas: no borra ni modifica datos existentes.
-- ============================================================================

USE agendamed;

-- ---------------------------------------------------------------------------
-- 1. MEDICOS: DNI, genero, modo de agenda y QR del enlace
-- ---------------------------------------------------------------------------
--
-- dni
--   El enlace publico pasa a construirse con DNI + apellido + matricula.
--   Va en `medicos` y no en `users` por coherencia con `pacientes.dni`, que
--   ya esta en la tabla del rol. Es NULL-able porque los profesionales
--   cargados antes de esta migracion no lo tienen: sus enlaces YA estan
--   generados y se conservan tal cual, asi que no se les exige
--   retroactivamente. Para las altas nuevas el formulario lo pide.
--
-- genero
--   Define el tratamiento que se muestra: "Dr." o "Dra.". Nullable para los
--   ya cargados; sin dato se usa la forma neutra "Dr/a.".
--
-- modo_agenda
--   'libre'         -> el paciente elige cualquier turno disponible
--   'orden_llegada' -> solo se ofrece el PRIMER turno libre de cada
--                      consultorio y dia; al ocuparse se habilita el
--                      siguiente. El default es 'libre' para no cambiarle el
--                      comportamiento a quien ya estaba usando el sistema.
--
-- qr_data_url / qr_url_codificada
--   El QR se genera al crear el enlace y se guarda junto a el.
--   `qr_url_codificada` guarda la URL que el QR realmente codifica: sirve
--   para VERIFICAR que apunta a la misma direccion del enlace y regenerarlo
--   solo si dejaron de coincidir (por ejemplo si cambio el dominio).
--   MEDIUMTEXT porque un data URL PNG de 720px ronda los 6-10 KB.
-- ---------------------------------------------------------------------------
ALTER TABLE medicos
  ADD COLUMN dni               VARCHAR(20) NULL AFTER user_id,
  ADD COLUMN genero            ENUM('masculino','femenino') NULL AFTER dni,
  ADD COLUMN modo_agenda       ENUM('libre','orden_llegada') NOT NULL DEFAULT 'libre'
    AFTER duracion_turno_min,
  ADD COLUMN qr_data_url       MEDIUMTEXT NULL AFTER enlace_activo,
  ADD COLUMN qr_url_codificada VARCHAR(255) NULL AFTER qr_data_url,
  ADD UNIQUE KEY uq_medicos_dni (dni);

-- ---------------------------------------------------------------------------
-- 2. AUSENCIAS_MEDICO: motivo tipificado y agrupacion por rango
-- ---------------------------------------------------------------------------
--
-- tipo_motivo
--   Motivo estandarizado. `motivo` (texto libre) se conserva para el detalle
--   que el profesional quiera agregar y para lo que se informa al paciente.
--
-- rango_id
--   Una suspension de varios dias inserta una fila por dia y consultorio
--   (que es lo que consulta el calculo de disponibilidad), pero todas
--   comparten este identificador. Asi la pantalla puede mostrarlas como un
--   unico periodo —"Vacaciones del 1 al 15"— y levantarlas juntas.
-- ---------------------------------------------------------------------------
ALTER TABLE ausencias_medico
  ADD COLUMN tipo_motivo ENUM('vacaciones','congreso','curso','personal','otro')
    NOT NULL DEFAULT 'otro' AFTER fecha,
  ADD COLUMN rango_id CHAR(12) NULL AFTER tipo_motivo,
  ADD KEY ix_ausencias_rango (rango_id);

-- ---------------------------------------------------------------------------
-- 3. TURNOS: codigo de cancelacion para pacientes sin cuenta
-- ---------------------------------------------------------------------------
--
-- Un paciente que reserva por el enlace es una cuenta INVITADA: no tiene
-- email ni contrasena, asi que no puede entrar al panel a cancelar.
--
-- Este codigo aleatorio es su "acceso": se le muestra al confirmar la reserva
-- y le permite cancelar desde /turno/<codigo> sin iniciar sesion. Es la pieza
-- que hace que "el paciente puede cancelar su turno" tambien sea cierto para
-- quien reservo por el enlace.
--
-- Es aleatorio y no derivado del id, para que no se pueda adivinar el codigo
-- de otro paciente probando numeros.
-- ---------------------------------------------------------------------------
ALTER TABLE turnos
  ADD COLUMN codigo_cancelacion CHAR(12) NULL AFTER canal,
  ADD UNIQUE KEY uq_turnos_codigo (codigo_cancelacion);

-- ---------------------------------------------------------------------------
-- 4. Vista actualizada
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_medicos AS
SELECT m.id, m.user_id, u.nombre, u.apellido, u.email, u.telefono, u.activo AS usuario_activo,
       m.dni, m.genero,
       e.id AS especialidad_id, e.nombre AS especialidad,
       m.matricula, m.hash_publico, m.enlace_activo,
       m.qr_data_url, m.qr_url_codificada,
       m.duracion_turno_min, m.modo_agenda,
       m.precio_consulta, m.porcentaje_sena,
       m.estado, m.created_at,
       (m.mp_access_token IS NOT NULL) AS mercadopago_configurado,
       m.mp_public_key
FROM medicos m
JOIN users u          ON u.id = m.user_id
JOIN especialidades e ON e.id = m.especialidad_id;
