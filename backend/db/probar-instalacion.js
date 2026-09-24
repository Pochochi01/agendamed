/**
 * db/probar-instalacion.js
 * Ensaya la instalacion completa en un servidor nuevo, sin tocar la base real.
 *
 *     npm run db:test-install
 *
 * ==========================================================================
 * Para que sirve
 * ==========================================================================
 * Reproduce, de punta a punta, lo que se corre en un VPS recien armado:
 *
 *     npm run db:migrate     (crea la base con db/schema.sql)
 *     npm run db:seed        (carga los datos de prueba)
 *     npm start              (arranca la API)
 *
 * y despues consulta la base para comprobar que los datos entraron completos.
 *
 * La idea es que un error de despliegue se vea ACA, en la maquina de
 * desarrollo y antes del push, y no por SSH en el servidor con el sitio ya
 * anunciado. El caso tipico es el seed cargando una columna que schema.sql
 * nunca tuvo: en desarrollo anda, porque esa base llego migrando, y en el
 * servidor nuevo falla con "Unknown column".
 *
 * Todo ocurre sobre una base descartable (`agendamed_test_install`), que se
 * borra al terminar aunque el ensayo falle.
 *
 * Complementa a `npm run db:check`, que compara las DOS rutas de instalacion
 * entre si. Este prueba que la ruta del servidor nuevo, ademas, funciona.
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const { execFileSync, spawn } = require('child_process');
const mysql = require('mysql2/promise');
require('dotenv').config();

const BASE = 'agendamed_test_install';
const RAIZ = path.join(__dirname, '..');

/** Un puerto libre, para no chocar con la instancia de desarrollo. */
function puertoLibre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/**
 * Levanta la API contra la base de ensayo y espera a que este escuchando.
 * Devuelve { proceso, base } para poder consultarla y despues matarla.
 */
function levantarApi(puerto) {
  return new Promise((resolve, reject) => {
    const proceso = spawn(process.execPath, [path.join(RAIZ, 'src', 'server.js')], {
      cwd: RAIZ,
      env: { ...process.env, DB_NAME: BASE, PORT: String(puerto), NODE_ENV: 'test' },
    });

    let salida = '';
    const alSalir = (chunk) => {
      salida += chunk.toString();
      if (salida.includes('escuchando en')) resolve({ proceso, salida });
    };
    proceso.stdout.on('data', alSalir);
    proceso.stderr.on('data', alSalir);

    proceso.once('exit', (codigo) => {
      reject(new Error(`la API no arranco (codigo ${codigo}):\n${salida.trim().split('\n').slice(-5).join('\n')}`));
    });

    setTimeout(() => reject(new Error(`la API no arranco en 30 s:\n${salida}`)), 30000).unref();
  });
}

let fallos = 0;
function comprobar(nombre, condicion, detalle = '') {
  if (!condicion) fallos += 1;
  console.log(`  ${condicion ? 'OK   ' : 'FALLA'} ${nombre}${detalle ? ` -> ${detalle}` : ''}`);
}

const conexion = () => mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  multipleStatements: true,
});

/** schema.sql redirigido a la base de ensayo. Ver db/comparar-esquema.js. */
function schemaPara(nombre) {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')
    .replace(/DROP DATABASE IF EXISTS agendamed;/, `DROP DATABASE IF EXISTS ${nombre};`)
    .replace(/CREATE DATABASE agendamed /, `CREATE DATABASE ${nombre} `)
    .replace(/^USE agendamed;/m, `USE ${nombre};`);

  if (sql.includes('agendamed;') || sql.includes('CREATE DATABASE agendamed ')) {
    throw new Error('No se pudo redirigir schema.sql a la base de ensayo. Abortado por seguridad.');
  }
  return sql;
}

/** Corre un script de db/ con la base de ensayo. Devuelve su salida. */
function correr(script) {
  return execFileSync(process.execPath, [path.join(__dirname, script)], {
    cwd: RAIZ,
    env: { ...process.env, DB_NAME: BASE },
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

(async () => {
  const cx = await conexion();

  try {
    /* ---------------- 1. npm run db:migrate ------------------------- */
    console.log('\n[1/5] db:migrate  (crear la base con schema.sql)');
    await cx.query(schemaPara(BASE));
    comprobar('la base se crea sin errores', true);

    /* ---------------- 2. npm run db:seed ---------------------------- */
    console.log('\n[2/5] db:seed  (cargar los datos de prueba)');
    try {
      correr('seed.js');
      comprobar('el seed corre completo', true);
    } catch (error) {
      const salida = `${error.stdout || ''}${error.stderr || ''}`.trim();
      comprobar('el seed corre completo', false, salida.split('\n').slice(-6).join(' | '));
      throw new Error('El seed fallo: una instalacion nueva no queda utilizable.');
    }

    /* ---------------- 3. db:up no tiene nada que hacer -------------- */
    console.log('\n[3/5] db:up sobre la base recien creada');
    const salidaUp = correr('migrate-up.js');
    comprobar('no reintenta migraciones ya incluidas en schema.sql',
      salidaUp.includes('ya estaba al dia'),
      salidaUp.split('\n').filter((l) => l.includes('[migrate-up]')).slice(-1)[0] || '');

    /* ---------------- 4. Los datos entraron completos --------------- */
    console.log('\n[4/5] Integridad de los datos cargados');
    await cx.query(`USE \`${BASE}\``);

    const [[conteo]] = await cx.query(`
      SELECT (SELECT COUNT(*) FROM users)          AS usuarios,
             (SELECT COUNT(*) FROM medicos)        AS medicos,
             (SELECT COUNT(*) FROM pacientes)      AS pacientes,
             (SELECT COUNT(*) FROM consultorios)   AS consultorios,
             (SELECT COUNT(*) FROM horarios)       AS horarios,
             (SELECT COUNT(*) FROM turnos)         AS turnos,
             (SELECT COUNT(*) FROM especialidades) AS especialidades,
             (SELECT COUNT(*) FROM localidades)    AS localidades,
             (SELECT COUNT(*) FROM obras_sociales) AS obras_sociales`);

    Object.entries(conteo).forEach(([tabla, filas]) => {
      comprobar(`${tabla} tiene datos`, Number(filas) > 0, `${filas} fila(s)`);
    });

    // Columnas que el seed carga y que son las que se olvidan al agregar una
    // migracion. Si schema.sql se atrasa, aca quedan en NULL o explota arriba.
    const [medicos] = await cx.query(
      'SELECT matricula, dni, genero, modo_agenda FROM medicos ORDER BY id'
    );
    comprobar('los medicos del seed traen DNI',
      medicos.every((m) => m.dni), medicos.map((m) => `${m.matricula}:${m.dni}`).join(' '));
    comprobar('los medicos del seed traen genero',
      medicos.every((m) => m.genero), medicos.map((m) => m.genero).join(' '));
    comprobar('modo_agenda toma su valor por defecto',
      medicos.every((m) => m.modo_agenda === 'libre'), medicos.map((m) => m.modo_agenda).join(' '));

    // La vista tiene que exponer las columnas nuevas: los modelos leen de ahi.
    const [[vista]] = await cx.query('SELECT * FROM v_medicos LIMIT 1');
    ['dni', 'genero', 'modo_agenda', 'qr_data_url', 'qr_url_codificada'].forEach((col) => {
      comprobar(`v_medicos expone ${col}`, col in vista);
    });

    // El chequeo de esquema del arranque, contra esta base.
    const verif = execFileSync(process.execPath, ['-e', `
      process.env.DB_NAME = '${BASE}';
      require('./src/config/verificarEsquema').verificarEsquema()
        .then((r) => { console.log(r.ok ? 'ESQUEMA_OK' : 'ESQUEMA_DESACTUALIZADO'); process.exit(0); });
    `], { cwd: RAIZ, env: { ...process.env, DB_NAME: BASE }, encoding: 'utf8', stdio: 'pipe' });
    comprobar('la base recien instalada pasa el chequeo del arranque',
      verif.includes('ESQUEMA_OK'), verif.trim().split('\n').slice(-1)[0]);

    /* ---------------- 5. La API arranca y se puede operar ----------- */
    console.log('\n[5/5] La API sobre la base recien instalada');
    const puerto = await puertoLibre();
    let api = null;
    try {
      api = await levantarApi(puerto);
      comprobar('la API arranca', true, `puerto ${puerto}`);

      const API = `http://localhost:${puerto}/api`;
      const pedir = async (ruta, opciones = {}) => {
        const r = await fetch(`${API}${ruta}`, {
          ...opciones,
          headers: { 'Content-Type': 'application/json', ...(opciones.headers || {}) },
        });
        return { estado: r.status, datos: await r.json().catch(() => ({})) };
      };

      // Alta de un profesional por el formulario publico de registro. Es el
      // camino que mas campos toca de una sola vez, y el que se rompe si un
      // formulario deja de cubrir alguna columna de su tabla.
      const alta = await pedir('/auth/registro', {
        method: 'POST',
        body: JSON.stringify({
          rol: 'medico',
          nombre: 'Prueba', apellido: 'Instalacion',
          email: `prueba.instalacion.${Date.now()}@ejemplo.test`,
          telefono: '3415550000',
          password: 'Prueba1234',
          dni: '39888777',
          genero: 'masculino',
          especialidadId: 1,
          matricula: 'MP-99999',
          duracionTurnoMin: 20,
          precioConsulta: 1000,
          porcentajeSena: 30,
        }),
      });
      comprobar('se puede registrar un medico con todos sus campos',
        alta.estado === 201,
        `estado ${alta.estado} ${JSON.stringify(alta.datos.detalles || alta.datos.mensaje || '')}`);

      if (alta.estado === 201) {
        const token = alta.datos.token;
        const enlace = await pedir('/medicos/mi/enlace', {
          headers: { Authorization: `Bearer ${token}` },
        });
        comprobar('el enlace se arma con el DNI que se cargo en el alta',
          String(enlace.datos.hash || '').startsWith('39888777-'), String(enlace.datos.hash));
        comprobar('el QR queda guardado y apunta al enlace',
          Boolean(enlace.datos.qr) && enlace.datos.qrUrlCodificada === enlace.datos.url,
          `${String(enlace.datos.qrUrlCodificada)} vs ${String(enlace.datos.url)}`);

        const perfil = await pedir('/medicos/mi/perfil', {
          headers: { Authorization: `Bearer ${token}` },
        });
        comprobar('el genero cargado en el alta queda guardado',
          perfil.datos.medico?.genero === 'masculino', String(perfil.datos.medico?.genero));

        // DNI repetido: tiene que dar un 409 con mensaje, no un 500 de MySQL.
        const repetido = await pedir('/auth/registro', {
          method: 'POST',
          body: JSON.stringify({
            rol: 'medico',
            nombre: 'Otro', apellido: 'Profesional',
            email: `otro.${Date.now()}@ejemplo.test`,
            password: 'Prueba1234',
            dni: '39888777',
            especialidadId: 1, matricula: 'MP-88888',
          }),
        });
        comprobar('un DNI repetido se rechaza con un mensaje, no con un 500',
          repetido.estado === 409, `estado ${repetido.estado} ${String(repetido.datos.mensaje || '')}`);
      }

      // Login con una de las cuentas del seed: prueba que los hashes entraron.
      const login = await pedir('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'dra.romero@agendamed.com', password: 'Agenda2026' }),
      });
      comprobar('las cuentas del seed pueden iniciar sesion', login.estado === 200,
        `estado ${login.estado}`);
    } finally {
      if (api) api.proceso.kill();
    }
  } catch (error) {
    fallos += 1;
    console.error(`\n  ERROR: ${error.message}`);
  } finally {
    await cx.query(`DROP DATABASE IF EXISTS \`${BASE}\``);
    await cx.end();
  }

  console.log('\n' + '='.repeat(74));
  if (fallos === 0) {
    console.log('[test-install] OK: un servidor nuevo queda instalado y con datos coherentes.');
    console.log('='.repeat(74));
    process.exit(0);
  }
  console.error(`[test-install] ${fallos} PROBLEMA(S): el despliegue en un servidor nuevo fallaria.`);
  console.error('='.repeat(74));
  process.exit(1);
})();
