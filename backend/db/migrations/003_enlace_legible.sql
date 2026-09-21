-- ============================================================================
--  Migracion 003 - Enlace de agendamiento legible
--
--  El identificador de /reservar/:id pasa de ser un token aleatorio de 22
--  caracteres a un slug con la matricula y el nombre del profesional:
--
--      elvJc7LnEfGs2EDCuuW5Sw   ->   mp-14523-romero-laura
--
--  Motivo: un enlace legible se reconoce al compartirlo por WhatsApp. El
--  anterior parecia spam.
--
--  Los enlaces viejos dejan de resolver despues de esta migracion. Si ya
--  compartiste alguno, hay que reenviarlo.
-- ============================================================================

USE agendamed;

-- 1. La columna pasa de CHAR(22) a VARCHAR para admitir el slug completo.
ALTER TABLE medicos
  MODIFY hash_publico VARCHAR(120) NULL
  COMMENT 'Identificador publico del enlace /reservar/:id (matricula-apellido-nombre)';

-- 2. Backfill: se arma el slug de cada medico.
--
--    La normalizacion se hace con REPLACE encadenados porque MySQL no tiene
--    una funcion para quitar tildes. Cubre las vocales acentuadas y la enie,
--    que es lo que aparece en nombres en castellano. Los casos raros los
--    resuelve la aplicacion, que regenera el slug con la misma logica en
--    utils/enlaceMedico.js.
UPDATE medicos m
  JOIN users u ON u.id = m.user_id
   SET m.hash_publico = TRIM(BOTH '-' FROM
       REGEXP_REPLACE(
         LOWER(
           REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
           REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
             CONCAT(m.matricula, '-', u.apellido, '-', u.nombre),
             'á','a'),'é','e'),'í','i'),'ó','o'),'ú','u'),'ü','u'),'ñ','n'),
             'Á','a'),'É','e'),'Í','i'),'Ó','o'),'Ú','u'),'Ü','u'),'Ñ','n')
         ),
         '[^a-z0-9]+', '-'
       )
     );

-- 3. Resolucion de colisiones.
--    La matricula es UNIQUE, asi que dos medicos no pueden generar el mismo
--    slug. Aun asi se comprueba: si la normalizacion dejara duplicados (por
--    ejemplo matriculas "MP 123" y "MP-123"), se agrega el id como sufijo.
UPDATE medicos m
  JOIN (
    SELECT hash_publico
      FROM medicos
     WHERE hash_publico IS NOT NULL
     GROUP BY hash_publico
    HAVING COUNT(*) > 1
  ) dup ON dup.hash_publico = m.hash_publico
   SET m.hash_publico = CONCAT(m.hash_publico, '-', m.id);
