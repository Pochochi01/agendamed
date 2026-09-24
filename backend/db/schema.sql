-- ============================================================================
--  AgendaMed - Esquema de base de datos (MySQL 8.x)
--  Modelo multi-tenant: cada MEDICO es un tenant. Todos los recursos
--  (consultorios, horarios, turnos, suscripciones) cuelgan de medico_id.
--
--  Normalizacion hasta 3FN:
--    1FN -> valores atomicos (la direccion se divide en calle/numero/piso...)
--    2FN -> toda columna no clave depende de la PK completa
--    3FN -> sin dependencias transitivas: especialidad y localidad viven en
--           tablas propias; nombre/email/telefono viven solo en `users` y no
--           se duplican en `medicos` ni en `pacientes`.
-- ============================================================================

DROP DATABASE IF EXISTS agendamed;
CREATE DATABASE agendamed CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE agendamed;

-- ---------------------------------------------------------------------------
-- USERS: identidad y credenciales. Unica fuente de nombre/email/telefono.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre         VARCHAR(80)  NOT NULL,
  apellido       VARCHAR(80)  NOT NULL,
  -- email y password_hash son NULL-ables para admitir cuentas INVITADAS: el
  -- enlace de agendamiento directo crea el paciente con solo nombre y DNI.
  -- `password_hash IS NULL` es la marca de "no puede iniciar sesion" y
  -- auth.controller lo rechaza explicitamente. UNIQUE admite varios NULL.
  email          VARCHAR(160) NULL,
  telefono       VARCHAR(30)  NULL,
  password_hash  VARCHAR(255) NULL,
  rol            ENUM('admin','medico','paciente') NOT NULL,
  activo         TINYINT(1)   NOT NULL DEFAULT 1,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email),
  KEY ix_users_rol (rol)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- ESPECIALIDADES: extraida de `medicos` para cumplir 3FN (el nombre de la
-- especialidad dependia transitivamente del medico y no de su PK).
-- ---------------------------------------------------------------------------
CREATE TABLE especialidades (
  id     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  UNIQUE KEY uq_especialidades_nombre (nombre)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- LOCALIDADES: evita repetir ciudad/provincia en cada consultorio.
-- ---------------------------------------------------------------------------
CREATE TABLE localidades (
  id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre    VARCHAR(100) NOT NULL,
  provincia VARCHAR(100) NOT NULL,
  UNIQUE KEY uq_localidad (nombre, provincia)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- MEDICOS (tenant). Relacion 1:1 con users.
--   estado          -> alta/baja logica que controla el Administrador General
--   duracion_turno  -> tamano del slot con el que se genera la disponibilidad
--   porcentaje_sena -> % del precio que se cobra como sena al reservar
-- ---------------------------------------------------------------------------
CREATE TABLE medicos (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id            INT UNSIGNED NOT NULL,
  especialidad_id    INT UNSIGNED NOT NULL,
  matricula          VARCHAR(40)  NOT NULL,
  -- DNI del profesional. Es el primer componente del enlace publico, y el
  -- unico del trio DNI+apellido+matricula que es unico por si solo: dos
  -- profesionales pueden compartir apellido y, entre jurisdicciones, hasta el
  -- numero de matricula. NULL-able para los que ya existian antes de pedirlo.
  dni                VARCHAR(20)  NULL,
  -- Define como los nombra el sistema: "Dr." / "Dra.". NULL = sin indicar,
  -- que se muestra como "Dr/a." y es un valor valido, no un dato faltante.
  genero             ENUM('masculino','femenino') NULL,
  -- Identificador del enlace publico /reservar/:id.
  -- Formato legible: dni-apellido-matricula (ej: "28456789-romero-mp-14523").
  -- Se eligio legible sobre aleatorio porque el enlace se comparte por
  -- WhatsApp y un token opaco parece spam. No expone nada que la busqueda
  -- publica de medicos no muestre ya. Ver utils/enlaceMedico.js.
  --
  -- VARCHAR(255) y no menos: el largo depende del nombre del profesional y el
  -- peor caso es matricula(40) + apellido(80) + nombre(80) + separadores(2) +
  -- sufijo(6) = 208. Quedarse corto produce ER_DATA_TOO_LONG al guardar.
  -- Debe mantenerse alineado con LARGO_MAXIMO de utils/enlaceMedico.js.
  hash_publico       VARCHAR(255) NULL,
  enlace_activo      TINYINT(1)   NOT NULL DEFAULT 1,
  -- QR del enlace, generado en el servidor y GUARDADO (PNG en base64), junto
  -- con la direccion que ese PNG lleva dentro. Guardarlo en vez de
  -- recalcularlo es lo que permite VERIFICAR: en cada consulta se compara
  -- qr_url_codificada con la URL del enlace vigente y solo se regenera si
  -- dejaron de coincidir. Ver services/qrEnlace.js.
  qr_data_url        MEDIUMTEXT   NULL,
  qr_url_codificada  VARCHAR(255) NULL,
  duracion_turno_min SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  -- Que ve el paciente al entrar por el enlace:
  --   libre          todos los horarios disponibles del dia
  --   orden_llegada  solo el primero libre de cada consultorio, salvo dentro
  --                  de las 6 h previas a la jornada. Ver utils/disponibilidad.js
  modo_agenda        ENUM('libre','orden_llegada') NOT NULL DEFAULT 'libre',
  precio_consulta    DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  porcentaje_sena    TINYINT UNSIGNED NOT NULL DEFAULT 30,
  estado             ENUM('activo','suspendido') NOT NULL DEFAULT 'activo',
  -- Credenciales de MercadoPago PROPIAS del profesional: el dinero de las
  -- consultas va a su cuenta, no a la de la plataforma. El access token se
  -- guarda cifrado (AES-256-GCM, ver utils/cripto.js) y NUNCA se devuelve por
  -- la API: hacia afuera solo viaja el booleano `mercadopago_configurado`.
  -- Si estan en NULL, el profesional no cobra online y sus turnos se
  -- confirman directamente al reservarse.
  mp_access_token    VARCHAR(512) NULL,
  mp_public_key      VARCHAR(120) NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_medicos_user (user_id),
  UNIQUE KEY uq_medicos_matricula (matricula),
  -- El DNI es unico porque forma parte del enlace publico. UNIQUE admite
  -- varios NULL, asi que los profesionales que todavia no lo cargaron no
  -- chocan entre si.
  UNIQUE KEY uq_medicos_dni (dni),
  UNIQUE KEY uq_medicos_hash (hash_publico),
  KEY ix_medicos_especialidad (especialidad_id),
  CONSTRAINT fk_medicos_user         FOREIGN KEY (user_id)         REFERENCES users(id)          ON DELETE CASCADE,
  CONSTRAINT fk_medicos_especialidad FOREIGN KEY (especialidad_id) REFERENCES especialidades(id) ON DELETE RESTRICT,
  CONSTRAINT ck_medicos_sena CHECK (porcentaje_sena BETWEEN 0 AND 100),
  CONSTRAINT ck_medicos_slot CHECK (duracion_turno_min BETWEEN 5 AND 240)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- OBRAS_SOCIALES: catalogo. Igual que especialidades y localidades, se extrae
-- para cumplir 3FN (el nombre dependia transitivamente del paciente).
-- ---------------------------------------------------------------------------
CREATE TABLE obras_sociales (
  id     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  sigla  VARCHAR(30)  NULL,
  activa TINYINT(1)   NOT NULL DEFAULT 1,
  UNIQUE KEY uq_obras_sociales_nombre (nombre)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- PACIENTES. Relacion 1:1 con users; los datos de contacto no se duplican.
-- ---------------------------------------------------------------------------
CREATE TABLE pacientes (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id          INT UNSIGNED NOT NULL,
  dni              VARCHAR(20) NOT NULL,
  fecha_nacimiento DATE NULL,
  -- La obra social vive en el PACIENTE, no en el turno: es un dato persistente
  -- de la persona. El medico la carga una vez y queda para los turnos futuros.
  obra_social_id   INT UNSIGNED NULL,
  nro_afiliado     VARCHAR(50)  NULL,
  -- WhatsApp de contacto que el paciente informa al reservar. Se actualiza
  -- con el ultimo que haya cargado: es el numero vigente para contactarlo.
  telefono_whatsapp VARCHAR(30) NULL,
  UNIQUE KEY uq_pacientes_user (user_id),
  UNIQUE KEY uq_pacientes_dni (dni),
  KEY ix_pacientes_obra_social (obra_social_id),
  KEY ix_pacientes_whatsapp (telefono_whatsapp),
  CONSTRAINT fk_pacientes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_pacientes_obra_social
    FOREIGN KEY (obra_social_id) REFERENCES obras_sociales(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- CONSULTORIOS: pertenecen a un medico (aislamiento por tenant).
-- ---------------------------------------------------------------------------
CREATE TABLE consultorios (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  medico_id    INT UNSIGNED NOT NULL,
  nombre       VARCHAR(100) NOT NULL,
  calle        VARCHAR(120) NOT NULL,
  numero       VARCHAR(20)  NOT NULL,
  piso_depto   VARCHAR(30)  NULL,
  localidad_id INT UNSIGNED NOT NULL,
  telefono     VARCHAR(30)  NULL,
  activo       TINYINT(1)   NOT NULL DEFAULT 1,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_consultorio_nombre_medico (medico_id, nombre),
  KEY ix_consultorios_localidad (localidad_id),
  CONSTRAINT fk_consultorios_medico    FOREIGN KEY (medico_id)    REFERENCES medicos(id)     ON DELETE CASCADE,
  CONSTRAINT fk_consultorios_localidad FOREIGN KEY (localidad_id) REFERENCES localidades(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- HORARIOS: plantilla semanal de atencion. dia_semana 1=Lunes .. 7=Domingo.
-- La no-superposicion entre consultorios se valida en la capa de modelo
-- (models/horario.model.js -> findSuperpuestos) porque MySQL no soporta
-- constraints de exclusion por rango.
-- ---------------------------------------------------------------------------
CREATE TABLE horarios (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  medico_id      INT UNSIGNED NOT NULL,
  consultorio_id INT UNSIGNED NOT NULL,
  dia_semana     TINYINT UNSIGNED NOT NULL,
  hora_inicio    TIME NOT NULL,
  hora_fin       TIME NOT NULL,
  activo         TINYINT(1) NOT NULL DEFAULT 1,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_horarios_medico_dia (medico_id, dia_semana, activo),
  KEY ix_horarios_consultorio_dia (consultorio_id, dia_semana, activo),
  CONSTRAINT fk_horarios_medico      FOREIGN KEY (medico_id)      REFERENCES medicos(id)      ON DELETE CASCADE,
  CONSTRAINT fk_horarios_consultorio FOREIGN KEY (consultorio_id) REFERENCES consultorios(id) ON DELETE CASCADE,
  CONSTRAINT ck_horarios_dia   CHECK (dia_semana BETWEEN 1 AND 7),
  CONSTRAINT ck_horarios_rango CHECK (hora_inicio < hora_fin)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- TURNOS. Los indices unicos impiden la doble reserva a nivel motor:
--   - un medico no puede tener dos turnos vigentes en el mismo instante
--   - un consultorio no puede alojar dos turnos vigentes en el mismo instante
-- `activo_key` vale 1 mientras el turno esta vigente y NULL si fue cancelado,
-- de modo que los cancelados quedan fuera del indice unico (NULL no colisiona)
-- y el slot se libera automaticamente.
-- ---------------------------------------------------------------------------
CREATE TABLE turnos (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  paciente_id        INT UNSIGNED NOT NULL,
  medico_id          INT UNSIGNED NOT NULL,
  consultorio_id     INT UNSIGNED NOT NULL,
  fecha              DATE NOT NULL,
  hora_inicio        TIME NOT NULL,
  hora_fin           TIME NOT NULL,
  estado             ENUM('pendiente','confirmado','cancelado','completado','ausente') NOT NULL DEFAULT 'pendiente',
  monto_total        DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  motivo_consulta    VARCHAR(255) NULL,
  -- WhatsApp informado en ESTA reserva (puede diferir del contacto actual del
  -- paciente si despues lo cambio) y canal por el que entro el turno.
  telefono_whatsapp  VARCHAR(30) NULL,
  canal              ENUM('web','enlace_directo') NOT NULL DEFAULT 'web',
  -- Acceso del paciente a SU turno en /turno/:codigo, sin cuenta ni
  -- contrasena. El codigo ES la credencial, por eso es aleatorio, unico y el
  -- endpoint publico esta limitado por intentos. Alfabeto sin caracteres
  -- confundibles (nada de O/0 ni I/1) porque se dicta y se copia a mano.
  -- NULL-able: los turnos anteriores a esta funcion no tienen codigo.
  codigo_cancelacion CHAR(12) NULL,
  motivo_cancelacion VARCHAR(255) NULL,
  cancelado_por      ENUM('paciente','medico','admin') NULL,
  cancelado_at       DATETIME NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  activo_key         TINYINT(1) GENERATED ALWAYS AS (IF(estado = 'cancelado', NULL, 1)) STORED,
  UNIQUE KEY uq_turno_medico_slot      (medico_id, fecha, hora_inicio, activo_key),
  UNIQUE KEY uq_turno_consultorio_slot (consultorio_id, fecha, hora_inicio, activo_key),
  UNIQUE KEY uq_turnos_codigo (codigo_cancelacion),
  KEY ix_turnos_paciente (paciente_id, fecha),
  KEY ix_turnos_medico_fecha (medico_id, fecha),
  -- Sostiene el recuento de cancelaciones previas de un paciente con un
  -- medico, que la agenda calcula para cada turno que muestra.
  KEY ix_turnos_cancelaciones (paciente_id, medico_id, estado, cancelado_por),
  CONSTRAINT fk_turnos_paciente    FOREIGN KEY (paciente_id)    REFERENCES pacientes(id)    ON DELETE CASCADE,
  CONSTRAINT fk_turnos_medico      FOREIGN KEY (medico_id)      REFERENCES medicos(id)      ON DELETE CASCADE,
  CONSTRAINT fk_turnos_consultorio FOREIGN KEY (consultorio_id) REFERENCES consultorios(id) ON DELETE RESTRICT,
  CONSTRAINT ck_turnos_rango CHECK (hora_inicio < hora_fin)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- PAGOS de turnos (sena o total) via MercadoPago.
-- ---------------------------------------------------------------------------
CREATE TABLE pagos (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  turno_id           INT UNSIGNED NOT NULL,
  paciente_id        INT UNSIGNED NOT NULL,
  monto              DECIMAL(10,2) NOT NULL,
  tipo               ENUM('sena','total') NOT NULL,
  estado             ENUM('pendiente','aprobado','rechazado','reembolsado') NOT NULL DEFAULT 'pendiente',
  mp_preference_id   VARCHAR(100) NULL,
  mp_payment_id      VARCHAR(100) NULL,
  mp_status_detail   VARCHAR(120) NULL,
  fecha_acreditacion DATETIME NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pagos_mp_payment (mp_payment_id),
  KEY ix_pagos_turno (turno_id),
  KEY ix_pagos_preference (mp_preference_id),
  CONSTRAINT fk_pagos_turno    FOREIGN KEY (turno_id)    REFERENCES turnos(id)    ON DELETE CASCADE,
  CONSTRAINT fk_pagos_paciente FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE CASCADE,
  CONSTRAINT ck_pagos_monto CHECK (monto > 0)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- SUSCRIPCIONES_MEDICOS: canon mensual que el medico paga a la plataforma.
-- Un registro por medico/mes/anio.
-- ---------------------------------------------------------------------------
CREATE TABLE suscripciones_medicos (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  medico_id        INT UNSIGNED NOT NULL,
  mes              TINYINT UNSIGNED NOT NULL,
  anio             SMALLINT UNSIGNED NOT NULL,
  monto            DECIMAL(10,2) NOT NULL,
  estado           ENUM('pendiente','pagada','vencida') NOT NULL DEFAULT 'pendiente',
  mp_preference_id VARCHAR(100) NULL,
  mp_payment_id    VARCHAR(100) NULL,
  fecha_pago       DATETIME NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_suscripcion_periodo (medico_id, anio, mes),
  KEY ix_suscripciones_estado (estado),
  CONSTRAINT fk_suscripciones_medico FOREIGN KEY (medico_id) REFERENCES medicos(id) ON DELETE CASCADE,
  CONSTRAINT ck_suscripciones_mes CHECK (mes BETWEEN 1 AND 12)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- AUSENCIAS_MEDICO: cancelacion de un dia, por consultorio.
--
-- Cancelar un dia tiene que hacer dos cosas: cancelar los turnos existentes Y
-- evitar que se reserven nuevos. Esta tabla es lo segundo: el calculo de
-- disponibilidad descarta los (medico, consultorio, fecha) que figuren aca.
--
-- Se guarda una fila por consultorio en lugar de un consultorio_id NULL que
-- signifique "todos": evita esa semantica ambigua y habilita el caso de
-- ausentarse solo en algunas sedes. Cancelar el dia completo inserta una fila
-- por cada consultorio del medico.
-- ---------------------------------------------------------------------------
CREATE TABLE ausencias_medico (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  medico_id         INT UNSIGNED NOT NULL,
  consultorio_id    INT UNSIGNED NOT NULL,
  fecha             DATE NOT NULL,
  -- Motivo de lista cerrada + aclaracion libre opcional.
  tipo_motivo       ENUM('vacaciones','congreso','curso','personal','otro') NOT NULL DEFAULT 'otro',
  -- Agrupa los dias de una MISMA suspension (unas vacaciones, un congreso)
  -- para poder listarla como una unidad y levantarla de una sola vez.
  -- NULL en los dias cancelados de a uno desde la agenda diaria; para esos,
  -- listarPeriodos arma el pseudo-id "dia-<fecha>".
  rango_id          CHAR(12) NULL,
  motivo            VARCHAR(255) NULL,
  turnos_cancelados SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ausencia (medico_id, consultorio_id, fecha),
  KEY ix_ausencias_fecha (fecha),
  KEY ix_ausencias_rango (rango_id),
  CONSTRAINT fk_ausencias_medico      FOREIGN KEY (medico_id)      REFERENCES medicos(id)      ON DELETE CASCADE,
  CONSTRAINT fk_ausencias_consultorio FOREIGN KEY (consultorio_id) REFERENCES consultorios(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- HISTORIAS_CLINICAS: evoluciones en texto.
--
-- SOLO TEXTO. No hay columna de audio ni de archivo, a proposito: el dictado
-- se transcribe en el navegador con la Web Speech API y el audio nunca se
-- envia al servidor ni se persiste. Ver frontend/src/components/DictadoVoz.jsx
--
-- turno_id es NULL-able para registrar una evolucion fuera de un turno (una
-- consulta telefonica) sin inventar un turno falso. ON DELETE SET NULL:
-- borrar un turno no debe borrar la evolucion clinica.
-- ---------------------------------------------------------------------------
CREATE TABLE historias_clinicas (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  paciente_id INT UNSIGNED NOT NULL,
  medico_id   INT UNSIGNED NOT NULL,
  turno_id    INT UNSIGNED NULL,
  texto       TEXT NOT NULL,
  -- Como se cargo. Permite auditar y que el medico sepa que textos vienen de
  -- un dictado (y conviene releer antes de darlos por definitivos).
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
-- VISTA de apoyo: medico + datos de usuario + especialidad ya resueltos.
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
       -- Solo el indicador: el token cifrado no sale de la tabla.
       (m.mp_access_token IS NOT NULL) AS mercadopago_configurado,
       m.mp_public_key
FROM medicos m
JOIN users u          ON u.id = m.user_id
JOIN especialidades e ON e.id = m.especialidad_id;

-- ---------------------------------------------------------------------------
-- VISTA: paciente con su obra social resuelta y el indicador de cuenta
-- invitada (creada por el enlace directo, sin contrasena).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_pacientes AS
SELECT p.id, p.user_id, p.dni, p.fecha_nacimiento, p.telefono_whatsapp,
       p.obra_social_id, p.nro_afiliado,
       os.nombre AS obra_social, os.sigla AS obra_social_sigla,
       u.nombre, u.apellido, u.email, u.telefono, u.activo,
       (u.password_hash IS NULL) AS es_invitado
FROM pacientes p
JOIN users u                ON u.id = p.user_id
LEFT JOIN obras_sociales os ON os.id = p.obra_social_id;

-- ---------------------------------------------------------------------------
-- MIGRACIONES: registro de los .sql de db/migrations ya aplicados.
--
-- Por que esta aca, en el script de instalacion desde cero.
-- ---------------------------------------------------------------------------
-- Este archivo YA CONTIENE el resultado de todas las migraciones listadas
-- abajo: una base recien creada con schema.sql nace al dia. Registrarlas como
-- aplicadas hace que `npm run db:up` no tenga nada que hacer sobre una
-- instalacion nueva, en lugar de reintentarlas todas y apoyarse en que los
-- errores de "ya existe" se toleren.
--
-- REGLA AL AGREGAR UNA MIGRACION NUEVA: se hacen las dos cosas, siempre.
--   1. Se crea db/migrations/00N_*.sql, para las bases que ya estan en uso.
--   2. Se refleja el cambio en este archivo Y se agrega el INSERT de abajo,
--      para las instalaciones desde cero.
-- Omitir el paso 2 es lo que hace que `npm run db:seed` falle en un servidor
-- nuevo con "Unknown column": el seed carga datos que el esquema no tiene.
-- `npm run db:check` compara las dos rutas y falla si se desincronizan.
-- ---------------------------------------------------------------------------
CREATE TABLE migraciones (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre      VARCHAR(190) NOT NULL,
  sentencias  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  omitidas    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  aplicada_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_migraciones_nombre (nombre)
) ENGINE=InnoDB;

INSERT INTO migraciones (nombre, sentencias, omitidas) VALUES
  ('001_registro_cancelaciones.sql', 0, 0),
  ('002_modulo_agendamiento.sql',    0, 0),
  ('003_enlace_legible.sql',         0, 0),
  ('004_hash_publico_255.sql',       0, 0),
  ('005_agenda_avanzada.sql',        0, 0);
