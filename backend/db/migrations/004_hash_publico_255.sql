-- ============================================================================
--  Migracion 004 - hash_publico a VARCHAR(255)
--
--  CORRIGE: ER_DATA_TOO_LONG ("Data too long for column 'hash_publico'") al
--  guardar el enlace de agendamiento de un medico.
--
--  ---------------------------------------------------------------------------
--  Causa
--  ---------------------------------------------------------------------------
--  La columna nacio como CHAR(22), medida para el token aleatorio del disenio
--  original. Al pasar el enlace a un identificador legible
--  (matricula-apellido-nombre), el valor dejo de tener largo fijo y paso a
--  depender del nombre del profesional:
--
--      mp-14523-romero-laura                       21 caracteres  (entraba justo)
--      mp-12345-fernandez-maria-alejandra          34 caracteres  -> ER_DATA_TOO_LONG
--
--  Con STRICT_TRANS_TABLES activo —el valor por defecto en MySQL 8— el exceso
--  no se recorta en silencio: la operacion falla.
--
--  ---------------------------------------------------------------------------
--  Por que 255 y no otro numero
--  ---------------------------------------------------------------------------
--  El largo maximo del slug se deduce de las columnas que lo componen:
--
--      medicos.matricula   VARCHAR(40)
--      users.apellido      VARCHAR(80)
--      users.nombre        VARCHAR(80)
--      separadores                   2
--      sufijo de regeneracion   hasta 6
--      ----------------------------------
--      PEOR CASO                   208
--
--  255 cubre ese peor caso con margen, de modo que el codigo NUNCA necesita
--  recortar el identificador. La migracion 003 lo habia dejado en 120, que
--  alcanzaba para nombres normales pero obligaba a recortar los largos (y el
--  recorte podia generar colisiones entre dos profesionales).
--
--  Si en el futuro se agrandan `matricula`, `nombre` o `apellido`, hay que
--  revisar este numero Y la constante LARGO_MAXIMO de utils/enlaceMedico.js.
--  El chequeo de arranque (config/verificarEsquema.js) avisa si se desalinean.
--
--  ---------------------------------------------------------------------------
--  Seguridad de la operacion
--  ---------------------------------------------------------------------------
--  Solo AMPLIA la columna: ningun dato existente se pierde ni se trunca, y se
--  puede re-ejecutar sin efecto. El indice UNIQUE se mantiene: 255 * 4 bytes
--  (utf8mb4) = 1020, por debajo del limite de 3072 de InnoDB.
-- ============================================================================

USE agendamed;

ALTER TABLE medicos
  MODIFY hash_publico VARCHAR(255) NULL
  COMMENT 'Identificador publico del enlace /reservar/:id (matricula-apellido-nombre). Peor caso 208 car.';
