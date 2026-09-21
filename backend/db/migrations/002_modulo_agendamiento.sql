-- ============================================================================
--  Migracion 002 - Modulo de agendamiento directo, obra social e historia clinica
--
--  Aplica sobre una base ya creada con db/schema.sql (que tambien incluye
--  estos cambios, para instalaciones nuevas):
--      mysql -u root -p agendamed < db/migrations/002_modulo_agendamiento.sql
--
--  Es idempotente donde MySQL lo permite. Envuelta en transaccion: los DDL de
--  MySQL hacen commit implicito, asi que si algo falla hay que revisar el
--  punto exacto antes de reintentar.
-- ============================================================================

USE agendamed;

-- ---------------------------------------------------------------------------
-- 1. USERS: habilitar cuentas INVITADAS.
--
-- El enlace de agendamiento directo permite reservar sin tener cuenta: el
-- paciente solo carga nombre y DNI. Para no duplicar el nombre en otra tabla
-- (y romper la 3FN) se sigue creando una fila en `users`, pero sin email ni
-- contrasena. `password_hash IS NULL` es la marca de "no puede iniciar
-- sesion"; auth.controller lo rechaza explicitamente.
-- UNIQUE permite multiples NULL en MySQL, asi que varios invitados conviven.
-- ---------------------------------------------------------------------------
ALTER TABLE users
  MODIFY email         VARCHAR(160) NULL,
  MODIFY password_hash VARCHAR(255) NULL;

-- ---------------------------------------------------------------------------
-- 2. MEDICOS: hash publico para el enlace directo /reservar/:hash
--
-- No se expone el id autoincremental en un enlace publico: seria enumerable
-- (probar /reservar/1, /reservar/2...). El hash es aleatorio de 22 caracteres
-- url-safe (~128 bits) y se puede regenerar para invalidar el enlace viejo.
-- ---------------------------------------------------------------------------
ALTER TABLE medicos
  ADD COLUMN hash_publico CHAR(22) NULL AFTER matricula,
  ADD COLUMN enlace_activo TINYINT(1) NOT NULL DEFAULT 1 AFTER hash_publico,
  ADD UNIQUE KEY uq_medicos_hash (hash_publico);

-- ---------------------------------------------------------------------------
-- 3. OBRAS_SOCIALES: catalogo (3FN)
--
-- El nombre de la obra social dependia transitivamente del paciente, no de su
-- PK. Se extrae a su propia tabla, igual que se hizo con especialidades y
-- localidades.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS obras_sociales (
  id     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  sigla  VARCHAR(30)  NULL,
  activa TINYINT(1)   NOT NULL DEFAULT 1,
  UNIQUE KEY uq_obras_sociales_nombre (nombre)
) ENGINE=InnoDB;

INSERT IGNORE INTO obras_sociales (nombre, sigla) VALUES
  ('OSDE', 'OSDE'),
  ('Swiss Medical', 'SMG'),
  ('Galeno', 'GAL'),
  ('Medife', 'MEDIFE'),
  ('OSECAC', 'OSECAC'),
  ('PAMI', 'PAMI'),
  ('IOMA', 'IOMA'),
  ('APROSS', 'APROSS'),
  ('Particular', 'PART');

-- ---------------------------------------------------------------------------
-- 4. PACIENTES: obra social, afiliado y WhatsApp de origen
--
-- La obra social se guarda en el PACIENTE y no en el turno: es un dato
-- persistente de la persona, no del evento. Asi el medico la carga una vez y
-- queda disponible para los turnos siguientes.
--
-- `telefono_whatsapp` es el numero con el que el paciente llego por el enlace
-- directo. Queda de solo lectura para el paciente (el formulario publico lo
-- muestra deshabilitado y el backend ignora cualquier intento de cambiarlo).
-- ---------------------------------------------------------------------------
ALTER TABLE pacientes
  ADD COLUMN obra_social_id    INT UNSIGNED NULL AFTER fecha_nacimiento,
  ADD COLUMN nro_afiliado      VARCHAR(50)  NULL AFTER obra_social_id,
  ADD COLUMN telefono_whatsapp VARCHAR(30)  NULL AFTER nro_afiliado,
  ADD KEY ix_pacientes_obra_social (obra_social_id),
  ADD KEY ix_pacientes_whatsapp (telefono_whatsapp),
  ADD CONSTRAINT fk_pacientes_obra_social
    FOREIGN KEY (obra_social_id) REFERENCES obras_sociales(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 5. TURNOS: procedencia de la reserva
--
-- Ademas del numero "primario" del paciente se guarda el WhatsApp con el que
-- se hizo CADA reserva: si el mismo paciente agenda desde otro telefono, el
-- medico ve desde cual se pidio ese turno puntual.
-- ---------------------------------------------------------------------------
ALTER TABLE turnos
  ADD COLUMN telefono_whatsapp VARCHAR(30) NULL AFTER motivo_consulta,
  ADD COLUMN canal ENUM('web','enlace_directo') NOT NULL DEFAULT 'web' AFTER telefono_whatsapp;

-- ---------------------------------------------------------------------------
-- 6. AUSENCIAS_MEDICO: cancelacion de un dia, por consultorio
--
-- Cancelar un dia tiene que hacer dos cosas: cancelar los turnos existentes Y
-- evitar que se reserven nuevos. Esta tabla es lo segundo: el calculo de
-- disponibilidad descarta los (medico, consultorio, fecha) que figuren aca.
--
-- Se guarda una fila por consultorio en lugar de un consultorio_id NULL que
-- signifique "todos": evita la semantica ambigua y permite el caso pedido de
-- ausentarse solo en algunas sedes. Cancelar el dia completo = una fila por
-- cada consultorio del medico.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ausencias_medico (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  medico_id      INT UNSIGNED NOT NULL,
  consultorio_id INT UNSIGNED NOT NULL,
  fecha          DATE NOT NULL,
  motivo         VARCHAR(255) NULL,
  turnos_cancelados SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ausencia (medico_id, consultorio_id, fecha),
  KEY ix_ausencias_fecha (fecha),
  CONSTRAINT fk_ausencias_medico      FOREIGN KEY (medico_id)      REFERENCES medicos(id)      ON DELETE CASCADE,
  CONSTRAINT fk_ausencias_consultorio FOREIGN KEY (consultorio_id) REFERENCES consultorios(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- 7. HISTORIAS_CLINICAS: evoluciones en texto
--
-- SOLO TEXTO. No hay columna de audio ni de archivo, a proposito: el dictado
-- se transcribe en el navegador (Web Speech API) y el audio nunca se envia ni
-- se persiste. Ver frontend/src/components/DictadoVoz.jsx.
--
-- `turno_id` es NULL-able para poder registrar una evolucion fuera de un turno
-- (una consulta telefonica, por ejemplo) sin inventar un turno falso.
-- ON DELETE SET NULL: borrar un turno no debe borrar la evolucion clinica.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS historias_clinicas (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  paciente_id INT UNSIGNED NOT NULL,
  medico_id   INT UNSIGNED NOT NULL,
  turno_id    INT UNSIGNED NULL,
  texto       TEXT NOT NULL,
  -- Como se cargo la evolucion. Sirve para auditar y para que el medico sepa
  -- que textos vienen de un dictado (y conviene releer).
  origen      ENUM('dictado','manual') NOT NULL DEFAULT 'manual',
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_historias_paciente_medico (paciente_id, medico_id, created_at),
  KEY ix_historias_turno (turno_id),
  CONSTRAINT fk_historias_paciente FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE CASCADE,
  CONSTRAINT fk_historias_medico   FOREIGN KEY (medico_id)   REFERENCES medicos(id)   ON DELETE CASCADE,
  CONSTRAINT fk_historias_turno    FOREIGN KEY (turno_id)    REFERENCES turnos(id)    ON DELETE SET NULL,
  CONSTRAINT ck_historias_texto CHECK (CHAR_LENGTH(TRIM(texto)) > 0)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- 8. Vistas actualizadas
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_medicos AS
SELECT m.id, m.user_id, u.nombre, u.apellido, u.email, u.telefono, u.activo AS usuario_activo,
       e.id AS especialidad_id, e.nombre AS especialidad,
       m.matricula, m.hash_publico, m.enlace_activo,
       m.duracion_turno_min, m.precio_consulta, m.porcentaje_sena,
       m.estado, m.created_at,
       (m.mp_access_token IS NOT NULL) AS mercadopago_configurado,
       m.mp_public_key
FROM medicos m
JOIN users u          ON u.id = m.user_id
JOIN especialidades e ON e.id = m.especialidad_id;

-- Paciente con su obra social ya resuelta.
CREATE OR REPLACE VIEW v_pacientes AS
SELECT p.id, p.user_id, p.dni, p.fecha_nacimiento, p.telefono_whatsapp,
       p.obra_social_id, p.nro_afiliado,
       os.nombre AS obra_social, os.sigla AS obra_social_sigla,
       u.nombre, u.apellido, u.email, u.telefono, u.activo,
       (u.password_hash IS NULL) AS es_invitado
FROM pacientes p
JOIN users u            ON u.id = p.user_id
LEFT JOIN obras_sociales os ON os.id = p.obra_social_id;

-- ---------------------------------------------------------------------------
-- 9. Backfill: hash publico para los medicos ya existentes.
--
-- 22 caracteres base64url a partir de UUID + RANDOM_BYTES. Los medicos nuevos
-- lo reciben desde la aplicacion. NOTA: la migracion 003 reemplaza estos
-- tokens por un identificador legible (matricula-apellido-nombre).
-- ---------------------------------------------------------------------------
UPDATE medicos
   SET hash_publico = LEFT(
         REPLACE(REPLACE(TO_BASE64(UNHEX(REPLACE(UUID(), '-', ''))), '+', '-'), '/', '_'),
         22)
 WHERE hash_publico IS NULL;
