/**
 * db/crear-admin.js
 * Crea (o actualiza) la cuenta del Administrador General.
 *
 *     node db/crear-admin.js <email> <password> [nombre] [apellido]
 *
 * Para que sirve: `db:seed` hace TRUNCATE de todas las tablas, asi que en
 * produccion no se puede usar. Este script solo agrega el admin, sin tocar
 * ningun otro dato.
 *
 * Si el email ya existe, actualiza su contrasena y se asegura de que el rol
 * sea admin: tambien sirve para recuperar el acceso si se perdio la clave.
 */
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
require('dotenv').config();

const COSTO_BCRYPT = 12;

function uso(mensaje) {
  if (mensaje) console.error(`\n  ${mensaje}\n`);
  console.log('  Uso: node db/crear-admin.js <email> <password> [nombre] [apellido]');
  console.log('  Ej:  node db/crear-admin.js admin@miclinica.com "UnaClaveLarga123"\n');
  process.exit(1);
}

(async () => {
  const [email, password, nombre = 'Administrador', apellido = 'General'] = process.argv.slice(2);

  if (!email || !password) uso('Falta el email o la contrasena.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) uso('El email no es valido.');
  if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    uso('La contrasena debe tener al menos 8 caracteres, con letras y numeros.');
  }

  const cx = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'agendamed',
  });

  try {
    const hash = await bcrypt.hash(password, COSTO_BCRYPT);
    const [existentes] = await cx.execute('SELECT id, rol FROM users WHERE email = ?', [email]);

    if (existentes.length) {
      const usuario = existentes[0];
      await cx.execute(
        "UPDATE users SET password_hash = ?, rol = 'admin', activo = 1 WHERE id = ?",
        [hash, usuario.id]
      );
      console.log(`\n  Cuenta actualizada: ${email} (id ${usuario.id})`);
      if (usuario.rol !== 'admin') console.log(`  El rol paso de "${usuario.rol}" a "admin".`);
    } else {
      const [res] = await cx.execute(
        `INSERT INTO users (nombre, apellido, email, password_hash, rol, activo)
         VALUES (?, ?, ?, ?, 'admin', 1)`,
        [nombre, apellido, email, hash]
      );
      console.log(`\n  Administrador creado: ${email} (id ${res.insertId})`);
    }

    console.log('  Ya podes iniciar sesion en /login\n');
  } catch (error) {
    console.error('\n  Error:', error.sqlMessage || error.message, '\n');
    process.exitCode = 1;
  } finally {
    await cx.end();
  }
})();
