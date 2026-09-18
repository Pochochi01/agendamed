/**
 * db/seed.js
 * Carga datos de prueba: admin, dos medicos (uno suspendido), dos pacientes,
 * consultorios, horarios, un turno con sena pagada y las suscripciones del mes.
 *
 *   npm run db:seed
 *
 * Credenciales generadas (todas con password "Agenda2026"):
 *   admin@agendamed.com      -> Administrador General
 *   dra.romero@agendamed.com -> Medica activa (Cardiologia)
 *   dr.paz@agendamed.com     -> Medico suspendido (Dermatologia)
 *   paciente1@mail.com       -> Paciente
 *   paciente2@mail.com       -> Paciente
 */
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
require('dotenv').config();

const PASSWORD_DEMO = 'Agenda2026';

(async () => {
  const cx = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'agendamed',
    multipleStatements: true,
  });

  try {
    const hash = await bcrypt.hash(PASSWORD_DEMO, 12);
    const hoy = new Date();
    const anio = hoy.getFullYear();
    const mes = hoy.getMonth() + 1;

    console.log('[seed] Limpiando tablas...');
    await cx.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['historias_clinicas', 'ausencias_medico', 'pagos', 'turnos', 'horarios',
      'consultorios', 'suscripciones_medicos', 'medicos', 'pacientes', 'users',
      'especialidades', 'localidades', 'obras_sociales']) {
      await cx.query(`TRUNCATE TABLE ${t}`);
    }
    await cx.query('SET FOREIGN_KEY_CHECKS = 1');

    /* ------------------------------ Catalogos --------------------------- */
    console.log('[seed] Catalogos...');
    const especialidades = ['Cardiologia', 'Dermatologia', 'Clinica Medica', 'Pediatria',
      'Traumatologia', 'Ginecologia', 'Oftalmologia', 'Neurologia'];
    for (const nombre of especialidades) {
      await cx.execute('INSERT INTO especialidades (nombre) VALUES (?)', [nombre]);
    }

    const localidades = [
      ['Cordoba', 'Cordoba'], ['Villa Carlos Paz', 'Cordoba'], ['Rio Cuarto', 'Cordoba'],
      ['CABA', 'Buenos Aires'], ['La Plata', 'Buenos Aires'], ['Rosario', 'Santa Fe'],
    ];
    for (const [nombre, provincia] of localidades) {
      await cx.execute('INSERT INTO localidades (nombre, provincia) VALUES (?, ?)', [nombre, provincia]);
    }

    const obrasSociales = [
      ['OSDE', 'OSDE'], ['Swiss Medical', 'SMG'], ['Galeno', 'GAL'], ['Medife', 'MEDIFE'],
      ['OSECAC', 'OSECAC'], ['PAMI', 'PAMI'], ['IOMA', 'IOMA'], ['APROSS', 'APROSS'],
      ['Particular', 'PART'],
    ];
    for (const [nombre, sigla] of obrasSociales) {
      await cx.execute('INSERT INTO obras_sociales (nombre, sigla) VALUES (?, ?)', [nombre, sigla]);
    }

    /* ------------------------------- Usuarios --------------------------- */
    console.log('[seed] Usuarios...');
    const crearUser = async (nombre, apellido, email, telefono, rol) => {
      const [r] = await cx.execute(
        `INSERT INTO users (nombre, apellido, email, telefono, password_hash, rol)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [nombre, apellido, email, telefono, hash, rol]
      );
      return r.insertId;
    };

    await crearUser('Ana', 'Gimenez', 'admin@agendamed.com', '3510000000', 'admin');

    const userRomero = await crearUser('Laura', 'Romero', 'dra.romero@agendamed.com', '3511111111', 'medico');
    const userPaz = await crearUser('Martin', 'Paz', 'dr.paz@agendamed.com', '3512222222', 'medico');
    const userPac1 = await crearUser('Julian', 'Torres', 'paciente1@mail.com', '3513333333', 'paciente');
    const userPac2 = await crearUser('Sofia', 'Medina', 'paciente2@mail.com', '3514444444', 'paciente');

    // El medico suspendido no puede loguear (baja logica del usuario).
    await cx.execute('UPDATE users SET activo = 0 WHERE id = ?', [userPaz]);

    /* -------------------------------- Medicos --------------------------- */
    console.log('[seed] Medicos...');
    const [rRomero] = await cx.execute(
      `INSERT INTO medicos (user_id, especialidad_id, matricula, duracion_turno_min, precio_consulta, porcentaje_sena, estado)
       VALUES (?, 1, 'MP-14523', 30, 18000.00, 30, 'activo')`,
      [userRomero]
    );
    const medicoRomero = rRomero.insertId;

    const [rPaz] = await cx.execute(
      `INSERT INTO medicos (user_id, especialidad_id, matricula, duracion_turno_min, precio_consulta, porcentaje_sena, estado)
       VALUES (?, 2, 'MP-20981', 20, 15000.00, 50, 'suspendido')`,
      [userPaz]
    );
    const medicoPaz = rPaz.insertId;

    /* ------------------------------- Pacientes -------------------------- */
    const [rPac1] = await cx.execute(
      'INSERT INTO pacientes (user_id, dni, fecha_nacimiento) VALUES (?, ?, ?)',
      [userPac1, '35123456', '1990-04-12']
    );
    const paciente1 = rPac1.insertId;
    await cx.execute(
      'INSERT INTO pacientes (user_id, dni, fecha_nacimiento) VALUES (?, ?, ?)',
      [userPac2, '38987654', '1995-11-03']
    );

    /* ----------------------------- Consultorios ------------------------- */
    console.log('[seed] Consultorios y horarios...');
    const [cCentro] = await cx.execute(
      `INSERT INTO consultorios (medico_id, nombre, calle, numero, piso_depto, localidad_id, telefono)
       VALUES (?, 'Centro Medico Nueva Cordoba', 'Av. Velez Sarsfield', '1250', 'Piso 3 Of. B', 1, '3515550001')`,
      [medicoRomero]
    );
    const [cCarlosPaz] = await cx.execute(
      `INSERT INTO consultorios (medico_id, nombre, calle, numero, piso_depto, localidad_id, telefono)
       VALUES (?, 'Consultorio Carlos Paz', 'Av. San Martin', '480', NULL, 2, '3541550002')`,
      [medicoRomero]
    );
    await cx.execute(
      `INSERT INTO consultorios (medico_id, nombre, calle, numero, piso_depto, localidad_id, telefono)
       VALUES (?, 'Policlinico Sur', 'Bv. San Juan', '890', 'Local 4', 1, '3515550003')`,
      [medicoPaz]
    );

    /* ------------------------------- Horarios --------------------------- */
    // Nota: los bloques de la Dra. Romero no se superponen entre si aunque
    // esten en consultorios distintos (regla que valida horario.controller).
    const horarios = [
      [medicoRomero, cCentro.insertId, 1, '09:00:00', '13:00:00'],
      [medicoRomero, cCarlosPaz.insertId, 1, '15:00:00', '19:00:00'],
      [medicoRomero, cCentro.insertId, 2, '09:00:00', '13:00:00'],
      [medicoRomero, cCentro.insertId, 3, '14:00:00', '18:00:00'],
      [medicoRomero, cCarlosPaz.insertId, 4, '09:00:00', '12:00:00'],
      [medicoRomero, cCentro.insertId, 5, '09:00:00', '13:00:00'],
    ];
    for (const h of horarios) {
      await cx.execute(
        `INSERT INTO horarios (medico_id, consultorio_id, dia_semana, hora_inicio, hora_fin)
         VALUES (?, ?, ?, ?, ?)`,
        h
      );
    }

    /* --------------------------- Turno de ejemplo ----------------------- */
    /* -------------------- Credenciales de MercadoPago ------------------- */
    // La Dra. Romero cobra online: se le carga un access token de PRUEBA,
    // cifrado igual que si lo hubiera cargado desde su panel. El Dr. Paz
    // queda sin credenciales, para poder ver el flujo "confirmar sin pago".
    console.log('[seed] Credenciales de MercadoPago (solo la Dra. Romero)...');
    const { cifrar } = require('../src/utils/cripto');
    await cx.execute(
      'UPDATE medicos SET mp_access_token = ?, mp_public_key = ? WHERE id = ?',
      [
        cifrar('TEST-0000000000000000-000000-00000000000000000000000000000000-000000000'),
        'TEST-00000000-0000-0000-0000-000000000000',
        medicoRomero,
      ]
    );

    /* ------------------- Enlaces de agendamiento directo ---------------- */
    console.log('[seed] Enlaces publicos...');
    const { generarHashPublico } = require('../src/utils/hash');
    const hashRomero = generarHashPublico();
    await cx.execute('UPDATE medicos SET hash_publico = ? WHERE id = ?', [hashRomero, medicoRomero]);
    await cx.execute('UPDATE medicos SET hash_publico = ? WHERE id = ?',
      [generarHashPublico(), medicoPaz]);

    /* --------------- Paciente INVITADO (llego por el enlace) ------------ */
    // Simula a alguien que reservo desde WhatsApp sin tener cuenta: usuario
    // sin email ni contrasena, con el numero de origen cargado.
    const [uInvitado] = await cx.execute(
      `INSERT INTO users (nombre, apellido, email, telefono, password_hash, rol)
       VALUES ('Marcos', 'Ibarra', NULL, '5493515550123', NULL, 'paciente')`
    );
    const [pInvitado] = await cx.execute(
      `INSERT INTO pacientes (user_id, dni, telefono_whatsapp, obra_social_id, nro_afiliado)
       VALUES (?, '30111222', '5493515550123', 1, '62001234567/01')`,
      [uInvitado.insertId]
    );

    console.log('[seed] Turno de ejemplo con sena pagada...');
    // Proximo lunes a las 09:00 en el consultorio del centro.
    const proximoLunes = new Date(hoy);
    proximoLunes.setDate(hoy.getDate() + ((8 - (hoy.getDay() || 7)) % 7 || 7));
    const fechaTurno = proximoLunes.toISOString().slice(0, 10);

    const [rTurno] = await cx.execute(
      `INSERT INTO turnos
         (paciente_id, medico_id, consultorio_id, fecha, hora_inicio, hora_fin, estado, monto_total, motivo_consulta)
       VALUES (?, ?, ?, ?, '09:00:00', '09:30:00', 'confirmado', 18000.00, 'Control anual')`,
      [paciente1, medicoRomero, cCentro.insertId, fechaTurno]
    );

    await cx.execute(
      `INSERT INTO pagos (turno_id, paciente_id, monto, tipo, estado, mp_payment_id, fecha_acreditacion)
       VALUES (?, ?, 5400.00, 'sena', 'aprobado', 'SEED-0001', NOW())`,
      [rTurno.insertId, paciente1]
    );

    /* ------- Turno del invitado, reservado por el enlace directo -------- */
    const [rTurnoInvitado] = await cx.execute(
      `INSERT INTO turnos
         (paciente_id, medico_id, consultorio_id, fecha, hora_inicio, hora_fin, estado,
          monto_total, motivo_consulta, telefono_whatsapp, canal)
       VALUES (?, ?, ?, ?, '09:30:00', '10:00:00', 'confirmado', 18000.00,
               'Dolor de pecho al esfuerzo', '5493515550123', 'enlace_directo')`,
      [pInvitado.insertId, medicoRomero, cCentro.insertId, fechaTurno]
    );

    /* ----------------- Historia clinica (solo texto) -------------------- */
    console.log('[seed] Evoluciones de ejemplo...');
    await cx.execute(
      `INSERT INTO historias_clinicas (paciente_id, medico_id, turno_id, texto, origen)
       VALUES (?, ?, ?, ?, 'manual')`,
      [paciente1, medicoRomero, rTurno.insertId,
        'Paciente asintomatico. Control anual. TA 120/80, FC 72 regular. '
        + 'Auscultacion cardiaca sin soplos. Se solicita ECG y laboratorio de rutina.']
    );
    await cx.execute(
      `INSERT INTO historias_clinicas (paciente_id, medico_id, turno_id, texto, origen)
       VALUES (?, ?, ?, ?, 'dictado')`,
      [pInvitado.insertId, medicoRomero, rTurnoInvitado.insertId,
        'Primera consulta. Refiere dolor precordial de tres semanas de evolucion, '
        + 'asociado al esfuerzo, que cede con el reposo. Sin antecedentes cardiologicos. '
        + 'Se indica ergometria y control en dos semanas.']
    );

    /* ----------------------------- Suscripciones ------------------------ */
    console.log('[seed] Suscripciones del mes...');
    const monto = Number(process.env.SUSCRIPCION_MONTO || 15000);
    await cx.execute(
      `INSERT INTO suscripciones_medicos (medico_id, mes, anio, monto, estado, fecha_pago, mp_payment_id)
       VALUES (?, ?, ?, ?, 'pagada', NOW(), 'SEED-SUS-1')`,
      [medicoRomero, mes, anio, monto]
    );
    await cx.execute(
      `INSERT INTO suscripciones_medicos (medico_id, mes, anio, monto, estado)
       VALUES (?, ?, ?, ?, 'vencida')`,
      [medicoPaz, mes, anio, monto]
    );

    console.log('\n[seed] Listo. Credenciales de prueba (password: %s):', PASSWORD_DEMO);
    console.table([
      { rol: 'admin', email: 'admin@agendamed.com' },
      { rol: 'medico (activo)', email: 'dra.romero@agendamed.com' },
      { rol: 'medico (suspendido)', email: 'dr.paz@agendamed.com' },
      { rol: 'paciente', email: 'paciente1@mail.com' },
      { rol: 'paciente', email: 'paciente2@mail.com' },
      { rol: 'paciente INVITADO (sin acceso)', email: 'DNI 30111222 - reservo por enlace' },
    ]);

    console.log('\n[seed] Enlace de agendamiento directo de la Dra. Romero:');
    console.log(`   http://localhost:5173/reservar/${hashRomero}?wa=5493511234567`);
    console.log('   (el parametro wa es el WhatsApp del paciente; sin el no se puede reservar)\n');
  } catch (error) {
    console.error('[seed] Error:', error.message);
    process.exitCode = 1;
  } finally {
    await cx.end();
  }
})();
