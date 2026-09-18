# Despliegue en VPS de Hostinger

Guía para dejar AgendaMed funcionando en un VPS con Ubuntu 22.04 o 24.04.

**Arquitectura final:** Nginx recibe el tráfico en los puertos 80/443, sirve el frontend compilado como archivos estáticos y redirige `/api` al backend de Node, que escucha solo en `localhost:4000`. MySQL queda accesible únicamente desde la propia máquina.

```
Internet ──► Nginx :443 ──┬─► /        → /var/www/agendamed (build de React)
                          └─► /api     → localhost:4000 (Node + PM2)
                                             │
                                             └─► MySQL :3306 (solo local)
```

> **HTTPS no es opcional en este proyecto.** El dictado por voz de la historia clínica usa la Web Speech API, que los navegadores **solo habilitan en contextos seguros**. Sobre `http://` el micrófono no arranca. El paso 8 (certificado) es obligatorio para que esa función exista.

---

## Antes de empezar

Necesitás:

- Un VPS de Hostinger con Ubuntu (el plan más chico alcanza: 1 vCPU / 4 GB).
- Un dominio apuntando al VPS. En el panel DNS de tu dominio creá dos registros **A** hacia la IP del VPS:
  - `@` → `IP_DEL_VPS`
  - `www` → `IP_DEL_VPS`
- La IP y la contraseña de root, que Hostinger muestra en **VPS → Administrar**.

Esperá a que el DNS propague antes del paso 8. Para comprobarlo, desde tu PC:

```bash
nslookup tudominio.com
```

Tiene que devolver la IP del VPS. Suele tardar entre minutos y un par de horas.

En toda la guía reemplazá `tudominio.com` por tu dominio real.

---

## 1. Conectarte y crear un usuario

Desde tu máquina (PowerShell o Git Bash):

```bash
ssh root@IP_DEL_VPS
```

Trabajar como root todo el tiempo es innecesariamente riesgoso. Creá un usuario con sudo:

```bash
adduser agenda                 # te pide una contraseña
usermod -aG sudo agenda
rsync --archive --chown=agenda:agenda ~/.ssh /home/agenda   # copia tu acceso SSH
```

Cerrá la sesión y volvé a entrar con el usuario nuevo:

```bash
exit
ssh agenda@IP_DEL_VPS
```

Actualizá el sistema:

```bash
sudo apt update && sudo apt upgrade -y
```

---

## 2. Firewall

Abrí solo lo necesario. El puerto 4000 **no** se expone: Nginx llega por `localhost`.

```bash
sudo apt install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
sudo ufw status
```

Debería listar `OpenSSH` y `Nginx Full`, nada más.

---

## 3. Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v && npm -v
```

---

## 4. MySQL

```bash
sudo apt install -y mysql-server
sudo systemctl enable --now mysql
sudo mysql_secure_installation
```

En el asistente: poné contraseña de root, y respondé **Y** a quitar usuarios anónimos, deshabilitar el login remoto de root y eliminar la base de prueba.

Creá la base y un usuario propio para la aplicación — la app **no** debe conectarse como root:

```bash
sudo mysql
```

Dentro de MySQL (cambiá la contraseña por una larga y aleatoria):

```sql
CREATE DATABASE agendamed CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'agendamed'@'localhost' IDENTIFIED BY 'PONE_UNA_CLAVE_LARGA_ACA';
GRANT ALL PRIVILEGES ON agendamed.* TO 'agendamed'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

Confirmá que MySQL escucha solo localmente:

```bash
sudo ss -tlnp | grep 3306      # tiene que decir 127.0.0.1:3306
```

---

## 5. Subir el código

**Opción A — Git (recomendada).** Hace que actualizar sea un `git pull`:

```bash
sudo mkdir -p /var/www && sudo chown agenda:agenda /var/www
cd /var/www
git clone https://github.com/TU_USUARIO/AgendaMed.git agendamed
cd agendamed
```

Si el repo es privado, generá una clave en el VPS (`ssh-keygen -t ed25519`) y cargá `~/.ssh/id_ed25519.pub` como *Deploy key* en GitHub.

**Opción B — Subir desde tu PC.** Desde `C:\Proyectos\AgendaMed`:

```bash
ssh agenda@IP_DEL_VPS "mkdir -p /var/www/agendamed"
scp -r backend frontend package*.json agenda@IP_DEL_VPS:/var/www/agendamed/
```

> No copies `node_modules` ni los `.env` locales: las dependencias se instalan en el VPS y las credenciales de producción son otras. Si usás `scp`, verificá que `node_modules` no viaje.

---

## 6. Configurar el backend

```bash
cd /var/www/agendamed/backend
npm ci --omit=dev          # si no hay package-lock.json, usá: npm install --omit=dev
cp .env.example .env
```

Generá los dos secretos **en el VPS** (no reutilices los de tu máquina):

```bash
echo "JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
echo "CRED_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
```

Editá el archivo (`nano .env`) y dejalo así:

```ini
PORT=4000
NODE_ENV=production
FRONTEND_URL=https://tudominio.com

DB_HOST=localhost
DB_PORT=3306
DB_USER=agendamed
DB_PASSWORD=la_clave_que_pusiste_en_el_paso_4
DB_NAME=agendamed

JWT_SECRET=pega_aca_el_primero
JWT_EXPIRES_IN=8h

CRED_SECRET=pega_aca_el_segundo

# Credenciales de LA PLATAFORMA: solo cobran la suscripción de los médicos.
# Los turnos se cobran con las credenciales que carga cada profesional.
MP_ACCESS_TOKEN=
MP_PUBLIC_KEY=
MP_WEBHOOK_URL=https://tudominio.com/api/pagos/webhook

SUSCRIPCION_MONTO=15000
CANCELACION_HORAS_RECOMENDADAS=24
CANCELACIONES_ALERTA=2
```

Protegé el archivo, que contiene la clave de la base:

```bash
chmod 600 .env
```

> **`CRED_SECRET` no se cambia después.** Con esa clave se cifran los access token de MercadoPago de cada médico. Si la cambiás, esos tokens dejan de poder descifrarse y **cada profesional tiene que volver a conectar su cuenta**. Guardala donde guardes tus contraseñas.

Creá las tablas:

```bash
npm run db:migrate     # base nueva y vacía
npm run db:up          # aplica las migraciones pendientes
```

> `db:migrate` arranca con `DROP DATABASE`. Es correcto en una instalación nueva; **nunca lo corras sobre una base con datos reales** — para eso está `db:up`, que es incremental.

Creá tu cuenta de administrador (**no** uses `db:seed` en producción: vacía todas las tablas):

```bash
npm run db:admin -- tuemail@tudominio.com "UnaClaveLargaYSegura123"
```

Probá que el backend arranca:

```bash
node src/server.js
```

Tenés que ver `[db] Conexion a MySQL establecida` y `[api] AgendaMed escuchando...`. Cortá con `Ctrl+C`.

---

## 7. Compilar el frontend

```bash
cd /var/www/agendamed/frontend
npm ci        # o npm install
npm run build
```

Queda todo en `frontend/dist/`. No hace falta configurar `VITE_API_URL`: el cliente llama a `/api` de forma relativa y Nginx lo redirige al backend en el mismo dominio.

---

## 8. Nginx y certificado HTTPS

```bash
sudo apt install -y nginx
sudo nano /etc/nginx/sites-available/agendamed
```

Pegá esto (cambiá el dominio):

```nginx
server {
    listen 80;
    server_name tudominio.com www.tudominio.com;

    root /var/www/agendamed/frontend/dist;
    index index.html;

    # El frontend es una SPA: cualquier ruta que no sea un archivo real
    # (/medico, /reservar/<hash>, ...) la resuelve React Router.
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Los assets llevan hash en el nombre: se pueden cachear sin miedo.
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        # Sin esto el rate limit vería siempre la IP de Nginx y limitaría a
        # todos juntos (app.js ya tiene 'trust proxy' activado).
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    client_max_body_size 1m;
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;
}
```

Activá el sitio y verificá la sintaxis:

```bash
sudo ln -s /etc/nginx/sites-available/agendamed /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

Ahora el certificado. **Este paso es el que habilita el dictado por voz:**

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tudominio.com -d www.tudominio.com
```

Elegí la opción de **redirigir HTTP a HTTPS**. Certbot reescribe la configuración y deja la renovación automática programada. Comprobala:

```bash
sudo certbot renew --dry-run
```

---

## 9. Dejar el backend corriendo con PM2

```bash
sudo npm install -g pm2
cd /var/www/agendamed/backend
pm2 start src/server.js --name agendamed-api
pm2 save
pm2 startup systemd -u agenda --hp /home/agenda
```

El último comando imprime una línea que empieza con `sudo env PATH=...`. **Copiala y ejecutala**: es lo que hace que la API vuelva sola después de un reinicio del VPS.

Comprobá:

```bash
pm2 status
pm2 logs agendamed-api --lines 30
```

---

## 10. Verificar que todo funciona

```bash
curl -s https://tudominio.com/api/health
```

Tiene que responder `{"ok":true,"servicio":"AgendaMed API",...}`.

Después, en el navegador:

| Qué probar | Cómo |
|---|---|
| El sitio carga | `https://tudominio.com` |
| El candado de HTTPS aparece | Barra de direcciones |
| Login del admin | `/login` con la cuenta del paso 6 |
| Rutas profundas | Entrá directo a `https://tudominio.com/medico` y recargá con F5 — si da 404, falta el `try_files` |
| Dictado por voz | Panel del médico → un turno → Historia clínica → Iniciar dictado |

---

## 11. Después de dejarlo andando

**Crear los médicos.** Entrá como admin a `/admin` y usá "Nuevo médico". Cada profesional después carga sus consultorios, horarios y su cuenta de MercadoPago desde su propio panel.

**MercadoPago.** El cobro de turnos usa las credenciales de cada médico (`/medico/cobros`), no las de la plataforma. Para que los pagos se acrediten solos, en el panel de MercadoPago de cada profesional hay que configurar la notificación de webhook apuntando a:

```
https://tudominio.com/api/pagos/webhook
```

Las variables `MP_ACCESS_TOKEN` y `MP_PUBLIC_KEY` del `.env` son solo para cobrarles la suscripción mensual a los médicos; si todavía no vas a cobrarla, dejalas vacías.

**Backups.** Esto guarda historias clínicas: un backup diario no es opcional.

```bash
sudo mkdir -p /var/backups/agendamed && sudo chown agenda:agenda /var/backups/agendamed
crontab -e
```

Agregá:

```cron
0 3 * * * mysqldump -u agendamed -p'TU_CLAVE' agendamed | gzip > /var/backups/agendamed/agendamed-$(date +\%F).sql.gz
0 4 * * * find /var/backups/agendamed -name "*.sql.gz" -mtime +30 -delete
```

Bajate una copia a tu PC de vez en cuando: un backup que vive en el mismo servidor no te salva si perdés el servidor.

---

## Actualizar la aplicación

Con la opción de Git, cada despliegue nuevo es:

```bash
cd /var/www/agendamed
git pull

cd backend
npm ci --omit=dev
npm run db:up            # incremental, NO borra datos
pm2 restart agendamed-api

cd ../frontend
npm ci
npm run build            # Nginx sirve el dist nuevo, no hace falta recargarlo
```

---

## Si algo falla

| Síntoma | Dónde mirar |
|---|---|
| 502 Bad Gateway | El backend está caído: `pm2 status`, `pm2 logs agendamed-api` |
| La API responde pero devuelve 500 | `pm2 logs`. Suele ser `.env` mal cargado o migración pendiente (`npm run db:up`) |
| `/medico` da 404 al recargar | Falta `try_files $uri $uri/ /index.html` en Nginx |
| El micrófono no arranca | Verificá que la URL sea `https://`. Sobre `http://` el navegador bloquea la Web Speech API |
| `ER_ACCESS_DENIED_ERROR` | Usuario o clave de MySQL mal en `.env` |
| Los pagos no se acreditan | El webhook de MercadoPago tiene que apuntar al dominio público con HTTPS |
| Certbot falla | El DNS todavía no propagó: `nslookup tudominio.com` |

Logs útiles:

```bash
pm2 logs agendamed-api --lines 100      # aplicación
sudo tail -f /var/log/nginx/error.log   # Nginx
sudo journalctl -u mysql -n 50          # MySQL
```
