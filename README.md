# AgendaMed

Sistema **multi-tenant** de agenda médica. Cada médico es un *tenant*: administra sus propios consultorios, horarios y turnos, de forma aislada del resto.

**Stack:** Node.js + Express · React + Vite + TailwindCSS · MySQL · JWT · MercadoPago · Axios

---

## Arquitectura

Patrón **MVC** en el backend, con una capa de rutas y otra de middlewares:

```
backend/
├── db/
│   ├── schema.sql          Esquema MySQL normalizado (3FN)
│   ├── migrate.js          Ejecuta el schema
│   └── seed.js             Datos de prueba
└── src/
    ├── config/             env, pool MySQL, SDK de MercadoPago
    ├── models/             Acceso a datos (SQL parametrizado)
    ├── controllers/        Lógica de negocio
    ├── routes/             Definición de endpoints
    ├── middlewares/        Auth/roles/tenant, validación, errores
    ├── validators/         Reglas de express-validator
    ├── utils/              ApiError, asyncHandler, tiempo, disponibilidad
    ├── app.js              Instancia de Express
    └── server.js           Arranque

frontend/
└── src/
    ├── api/                Instancia de Axios + servicios por recurso
    ├── context/            AuthContext (sesión global)
    ├── components/         UI reutilizable + RutaProtegida
    ├── layouts/            Marco común de los paneles
    ├── pages/
    │   ├── auth/           Login, Registro
    │   ├── admin/          Médicos, Suscripciones
    │   ├── medico/         Agenda, Horarios, Consultorios, Suscripción
    │   └── paciente/       Buscar, Reservar, Mis turnos
    └── utils/              Formato de fechas, moneda y estados
```

---

## Puesta en marcha

### 1. Requisitos
- Node.js 18+
- MySQL 8+

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env      # completar credenciales
npm run db:migrate        # crea la base y las tablas
npm run db:seed           # carga datos de prueba
npm run dev               # http://localhost:4000/api
```

### Actualizar una base que ya tiene datos

`db:migrate` ejecuta `schema.sql`, que **empieza con `DROP DATABASE`**: sirve para instalar de cero, no para actualizar. Si la base ya está en uso:

```bash
npm run db:up      # aplica db/migrations/*.sql sin borrar datos
```

El migrador lleva registro en la tabla `migraciones`, así que se puede correr las veces que haga falta: las ya aplicadas se saltean. Además tolera una base "a mitad de camino" — MySQL no soporta `ADD COLUMN IF NOT EXISTS`, así que los errores de *"ya existe"* se tratan como paso cumplido en lugar de abortar.

| Comando | Cuándo |
|---|---|
| `npm run db:migrate` | Instalación nueva. **Borra la base.** |
| `npm run db:up` | Base existente con datos. Incremental y re-ejecutable. |
| `npm run db:seed` | Datos de prueba. **Vacía las tablas** — nunca en producción. |
| `npm run db:admin -- <email> <pass>` | Crea o recupera la cuenta de administrador sin tocar el resto. |

> **El servidor avisa si la base quedó atrás.** Al arrancar verifica que las tablas y los largos de columna coincidan con lo que el código espera ([verificarEsquema.js](backend/src/config/verificarEsquema.js)). Si falta una migración lo dice al instante, con el comando exacto, en lugar de fallar horas después en medio de una operación:
> ```
> [esquema] LA BASE DE DATOS ESTA DESACTUALIZADA
>   - "medicos.hash_publico" es varchar(22) pero el codigo puede generar
>     hasta 255 caracteres. Guardar un valor largo daria ER_DATA_TOO_LONG
>   Migracion(es) pendiente(s): 004_hash_publico_255.sql
>   Para corregirlo, sin perder datos:  npm run db:up
> ```

## Despliegue

Ver **[DEPLOY.md](DEPLOY.md)** para la guía completa en un VPS (Nginx + PM2 + MySQL + HTTPS).

> El dictado por voz **requiere HTTPS**: los navegadores solo habilitan `getUserMedia` y `MediaRecorder` en contextos seguros. Sobre `http://` esa función no arranca.

> `.env` ya fue creado a partir del ejemplo. **Ajustá `DB_PASSWORD` con la contraseña de tu MySQL** antes de correr la migración, y reemplazá `JWT_SECRET` por un valor aleatorio:
> ```bash
> node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
> ```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev               # http://localhost:5173
```

Vite proxea `/api` al backend, así que no hay que tocar CORS en desarrollo.

### 4. Cuentas de prueba (tras el seed)

| Rol | Email | Contraseña |
|---|---|---|
| Administrador General | `admin@agendamed.com` | `Agenda2026` |
| Médica (activa) | `dra.romero@agendamed.com` | `Agenda2026` |
| Médico (suspendido) | `dr.paz@agendamed.com` | `Agenda2026` |
| Paciente | `paciente1@mail.com` | `Agenda2026` |

---

## Módulo de agendamiento directo, obra social e historia clínica

### 1. Enlace de agendamiento directo — `/reservar/:hash`

Ruta **pública, sin sesión**. El médico comparte el enlace (`/medico/enlace`) y el paciente entra, ve los turnos libres de ese profesional y reserva con nombre y DNI.

**El identificador es legible**, armado con matrícula + apellido + nombre:

```
/reservar/mp-14523-romero-laura
```

Antes era un token aleatorio (`elvJc7LnEfGs2EDCuuW5Sw`). Se cambió porque el enlace se comparte por WhatsApp y un token opaco parece spam; así el paciente reconoce de quién es antes de abrirlo. [`enlaceMedico.js`](backend/src/utils/enlaceMedico.js) quita tildes, pasa a minúsculas y colapsa símbolos a guiones, así que `Núñez, José` → `nunez-jose`.

> **Lo que se pierde, dicho explícitamente.** Un identificador legible es **adivinable**: sabiendo matrícula y nombre se puede construir el enlace sin que lo compartan. Eso no filtra nada nuevo —la página muestra nombre, especialidad, precio y turnos libres, exactamente lo que ya devuelve la búsqueda pública de `/api/medicos` a cualquiera—, pero conviene tenerlo claro: el enlace es un atajo, no un secreto.
>
> Lo que sí se pierde es invalidar rotando el identificador, porque regenerarlo daría el mismo texto. Se conserva de dos formas: `enlace_activo` lo apaga sin perderlo, y **regenerar agrega un sufijo numérico** (`...-romero-laura-2`), con lo que el anterior deja de resolver.

**La URL funciona en producción sin configurar nada.** El enlace se armaba con `FRONTEND_URL`, y si esa variable quedaba en `http://localhost:5173` el médico copiaba algo inservible — un error silencioso, porque el enlace *se ve* bien. Ahora [`urlPublica.js`](backend/src/utils/urlPublica.js) resuelve la base en este orden:

1. `PUBLIC_URL` del `.env` — control explícito, gana siempre
2. El dominio que informa el proxy (`X-Forwarded-Host` / `Host`), que detrás de Nginx es el real
3. `FRONTEND_URL` como último recurso

En desarrollo el paso 2 se descarta a propósito: el proxy de Vite reescribe el `Host` a `localhost:4000` (el puerto de la API, que no sirve el frontend), así que se cae a `FRONTEND_URL`, que sí conoce el 5173. Si aun así el enlace queda apuntando a localhost, la pantalla del médico lo **avisa en rojo** en lugar de dejarlo copiar algo roto.

**Paciente invitado.** Reservar no requiere cuenta. Para no duplicar el nombre en otra tabla y romper la 3FN, se crea igual una fila en `users`, pero con `email` y `password_hash` en `NULL`; eso es la marca de "no puede iniciar sesión" y el login lo rechaza explícitamente. Si más adelante ese paciente se registra con el mismo DNI, **reclama su cuenta**: se le agregan las credenciales al usuario existente y conserva sus turnos y su historia clínica.

**El WhatsApp lo aporta el paciente al reservar.** El enlace del médico es **uno solo y genérico**: el mismo para todos, sin el número de nadie. El paciente lo carga en el formulario, junto con nombre y DNI, y queda guardado en el turno para que el profesional pueda comunicarse después.

```
médico  ──comparte──►  /reservar/mp-14523-romero-laura   (un solo enlace)
                                      │
paciente ──reserva──►  nombre · DNI · WhatsApp · día · horario
                                      │
                       turnos.telefono_whatsapp  ──►  agenda del médico
                                                      con acceso directo al chat
```

Es obligatorio porque una reserva por enlace **no deja email ni cuenta**: es el único canal de contacto que queda.

> **Diseño anterior y por qué se cambió.** El número venía como parámetro del enlace (`?wa=...`), lo que obligaba al consultorio a armar un enlace distinto por paciente y a conseguir el número de antemano. Además ninguna API web expone el teléfono del dispositivo —eso no se puede implementar—, así que el dato había que obtenerlo por fuera igual. Pedírselo al paciente es más simple y no depende de nada. El parámetro `?wa=` se sigue aceptando para **precargar** el campo si alguien abre un enlace viejo, pero el campo es editable.

Se guarda en dos lugares con sentidos distintos: `pacientes.telefono_whatsapp` es el **contacto vigente** (se actualiza con el último que informó, por si corrigió un error o cambió de número) y `turnos.telefono_whatsapp` es el usado en *esa* reserva, que no cambia — así el médico conserva el historial de con qué número se pidió cada turno.

### 2. Agenda diaria del médico — `react-big-calendar`

`/medico` muestra la jornada con los intervalos diferenciados por color: **ocupado** (azul, abre el modal al hacer clic), **disponible** (verde punteado, no clickeable), **cancelado** (gris tachado) y **paciente con cancelaciones reiteradas** (rojo). `GET /api/agenda/dia` devuelve ambos tipos en una sola respuesta con claves que no pueden colisionar (`turno-<id>` / `libre-<consultorio>-<hora>`).

**Cancelar el día.** Con más de un consultorio, el modal permite marcar a cuáles no se presentará. La operación hace dos cosas en una transacción: cancela los turnos vigentes **y** registra la ausencia en `ausencias_medico`, para que no entren turnos nuevos — sin esa segunda parte, un paciente podría volver a reservar el día que el médico acaba de cancelar. El cálculo de disponibilidad descarta esos consultorios.

`ausencias_medico` guarda una fila por consultorio en lugar de un `consultorio_id NULL` que signifique "todos": evita la semántica ambigua y habilita el caso de ausentarse solo en algunas sedes.

### 3. Obra social y número de afiliado

Viven en el **paciente**, no en el turno: son datos persistentes de la persona, así que el médico los carga una vez y quedan para los turnos siguientes. `obras_sociales` es un catálogo aparte (3FN, igual que especialidades y localidades). El formulario usa `react-hook-form` y `PATCH /api/pacientes/:id/obra-social`.

### 4. Historia clínica con dictado por voz

**La grabación se transcribe de una sola pasada, al terminar.**

```
[Navegador]                          [Servidor]
MediaRecorder ──► Blob completo ──►  multer.memoryStorage (Buffer en RAM)
                  (POST multipart)        │
                                          ├─► ffmpeg por tuberías → PCM 16 kHz
                                          ├─► Whisper (una sola pasada)
                                          └─► el Buffer se descarta
                                                   │
                        texto ◄─────────────────────┘
                          │
                  el médico lo revisa y corrige
                          │
                  POST /pacientes/:id/historia (JSON)  →  MySQL
```

> **Por qué se dejó el reconocimiento en tiempo real.** La Web Speech API transcribía mientras el médico hablaba, y eso **repetía palabras**: el navegador corta la sesión cada ~60 s, hay que reanudarla, y los tramos solapados duplican las frases del borde. Al procesar la grabación entera de una vez no hay estado acumulado entre tramos, así que la duplicación no puede ocurrir por construcción. Como red adicional, `limpiarTexto()` colapsa oraciones y palabras repetidas consecutivas, que es el artefacto típico de Whisper cuando el audio termina en silencio.

### Dos proveedores, elegibles por `.env`

| `TRANSCRIPCION_PROVEEDOR` | Dónde corre | Privacidad | Velocidad |
|---|---|---|---|
| `local` (por defecto) | Whisper en tu servidor (`@xenova/transformers`) | El audio **no sale de la máquina** | Depende del CPU |
| `externo` | API compatible con OpenAI | El audio **viaja a un tercero** | Rápido siempre |

Para historias clínicas conviene `local`. Medido en un equipo de escritorio con `Xenova/whisper-base`: **18,7 s para 8,4 s de audio** (≈2,2× tiempo real). En un VPS de 1 vCPU es bastante más lento — ver [DEPLOY.md](DEPLOY.md) antes de elegir.

Modelos locales: `whisper-tiny` (~40 MB, rápido, confunde términos médicos), `whisper-base` (~80 MB, recomendado), `whisper-small` (~250 MB, mejor con terminología, más lento).

Se evaluó la alternativa del enunciado —`multer.memoryStorage()` + `@xenova/transformers`— y se descartó: aunque el archivo se descarte enseguida, el audio igual viaja por la red y pasa por la memoria del servidor, sus logs y sus volcados. Con la Web Speech API ese dato **no se produce del lado servidor**, que es una garantía más fuerte que descartarlo a tiempo. En consecuencia:

El audio **sí llega al servidor** (es lo que permite transcribirlo de una pasada), pero no se persiste en ningún punto del recorrido:

- `multer` usa **`memoryStorage()`**, nunca `diskStorage`: el archivo vive como `Buffer` en RAM;
- **un solo endpoint** de toda la API acepta `multipart/form-data` (`POST /api/historia/transcribir`), con lista blanca de tipos y límite de tamaño;
- ffmpeg decodifica **por tuberías** (`pipe:0` → `pipe:1`): no hay archivos temporales ni `writeFile`;
- el controlador **libera el buffer** en un `finally` (`buffer = null; req.file.buffer = null`);
- `historias_clinicas` **no tiene** ninguna columna de audio, blob o archivo — la base entera no tiene una sola columna BLOB;
- la ruta que guarda la evolución sigue aceptando **solo JSON**;
- en el navegador, los trozos de `MediaRecorder` se sueltan tras armar el Blob, y no se guarda nada en `localStorage`, `sessionStorage` ni IndexedDB, ni se ofrece descargar el audio.

Las 22 condiciones están verificadas en las pruebas, sobre el código ejecutable e ignorando comentarios.

**Contrabando por el campo de texto.** Una auditoría mostró que eso no alcanzaba: era posible pegar un data-URI de audio *dentro* del campo `texto` y quedaba guardado en la base — audio persistido, justo lo que la restricción prohíbe. Se cerró con dos reglas, aplicadas en el validador y repetidas en el modelo (para que el invariante valga en cualquier ruta futura, no solo en las actuales):

1. se rechaza cualquier data-URI (`data:audio/…`, `data:video/…`, `data:application/…`);
2. se rechaza cualquier token de más de 120 caracteres sin espacios — el texto clínico real no tiene palabras así de largas, base64 sí. Es una regla genérica contra contenido binario, no solo contra audio.

Verificado con audio real de 30 KB en cinco variantes (data-URI, mayúsculas, base64 crudo, base64 escondido en una frase) y contra falsos positivos con texto clínico legítimo, incluido uno de 5.000 caracteres y valores tipo `TA 130/85`.

**Transcribir y guardar son dos pasos separados, a propósito.** `POST /api/historia/transcribir` devuelve el texto y termina; el guardado sigue pasando por `POST /pacientes/:id/historia`, que no cambió. Así el médico **revisa** la transcripción antes de que entre a la historia clínica —un modelo de voz se equivoca con la terminología médica y nada debería persistirse sin que un humano lo lea— y la ruta de guardado conserva intactas sus validaciones y su control de acceso.

La transcripción es un **borrador editable**, y dictar otro tramo **suma** al texto en vez de reemplazarlo. Al guardar, la respuesta trae la lista completa, así que la evolución se renderiza al instante sin una segunda consulta. `origen: 'dictado'` queda registrado para saber qué textos conviene releer.

**Aislamiento clínico.** Todo acceso pasa por `pacienteAtendidoPor`: la relación médico-paciente la establece haber tenido al menos un turno. Sin esa barrera, cualquier médico del sistema leería la historia de cualquier paciente pasando un id.

### Ejemplo de request/response

**1. Subir la grabación completa**

```http
POST /api/historia/transcribir
Authorization: Bearer <jwt del médico>
Content-Type: multipart/form-data; boundary=----X

------X
Content-Disposition: form-data; name="audio"; filename="dictado.webm"
Content-Type: audio/webm

<bytes del Blob de MediaRecorder>
------X--
```

```json
{
  "ok": true,
  "texto": "El paciente presenta cefalea intensa desde hace dos días. Se solicita tomografía de cerebro.",
  "duracionSeg": 7.8,
  "proveedor": "local",
  "modelo": "Xenova/whisper-base",
  "msProceso": 10564,
  "audioDescartado": true
}
```

**2. Guardar el texto ya revisado** (ruta sin cambios)

```http
POST /api/pacientes/1/historia
Authorization: Bearer <jwt del médico>
Content-Type: application/json

{ "texto": "El paciente presenta cefalea intensa...", "turnoId": 12, "origen": "dictado" }
```

```json
{
  "ok": true,
  "mensaje": "Evolucion guardada",
  "evolucion": { "id": 14, "texto": "...", "origen": "dictado", "created_at": "..." },
  "evoluciones": [ /* lista cronológica completa, para renderizar sin otra consulta */ ]
}
```

**Errores de audio** — todos responden `400` con un mensaje accionable:

| Caso | Mensaje |
|---|---|
| Sin archivo | `No se recibio ningun audio. Envia el archivo en el campo "audio".` |
| Grabación muda | `No se detecto voz en la grabacion. Revisa que el microfono correcto este seleccionado...` |
| Menos de 0,4 s | `La grabacion es demasiado corta...` |
| Archivo dañado | `El audio esta danado o en un formato no soportado.` |
| Tipo no admitido | `Formato de audio no soportado (application/pdf). Se esperaba webm, ogg, mp4 o wav.` |
| Supera el límite | `La grabacion supera el limite de 20 MB...` |
| Whisper no sacó palabras | `No se pudo reconocer ninguna palabra en la grabacion...` |

## Base de datos (3FN)

| Tabla | Rol |
|---|---|
| `users` | Identidad y credenciales. **Única** fuente de nombre/email/teléfono |
| `especialidades` | Catálogo (elimina la dependencia transitiva en `medicos`) |
| `localidades` | Catálogo (elimina ciudad/provincia repetidas en `consultorios`) |
| `medicos` | Tenant. 1:1 con `users` + configuración de agenda y tarifas |
| `pacientes` | 1:1 con `users` + DNI y fecha de nacimiento |
| `consultorios` | Pertenecen a un médico. Dirección atomizada |
| `horarios` | Plantilla semanal (día 1=Lunes … 7=Domingo) |
| `turnos` | Reservas, con estado y trazabilidad de cancelación |
| `pagos` | Seña o total de cada turno, con los ids de MercadoPago |
| `suscripciones_medicos` | Canon mensual por médico/mes/año |
| `obras_sociales` | Catálogo de coberturas |
| `ausencias_medico` | Días que el médico no atiende, por consultorio |
| `historias_clinicas` | Evoluciones **en texto** (sin audio, por diseño) |

**Decisiones de normalización**

- **1FN:** la dirección se guarda como `calle` / `numero` / `piso_depto` / `localidad_id`, no como un texto libre.
- **2FN:** todas las PK son simples; las claves candidatas van como `UNIQUE` (`uq_medicos_matricula`, `uq_suscripcion_periodo`, …).
- **3FN:** `especialidad` y `localidad` se extrajeron a tablas propias; los datos de contacto viven solo en `users` y se exponen vía la vista `v_medicos`.

**Anti doble-reserva.** `turnos` tiene una columna generada:

```sql
activo_key TINYINT(1) GENERATED ALWAYS AS (IF(estado='cancelado', NULL, 1)) STORED
UNIQUE KEY uq_turno_medico_slot      (medico_id, fecha, hora_inicio, activo_key)
UNIQUE KEY uq_turno_consultorio_slot (consultorio_id, fecha, hora_inicio, activo_key)
```

Un turno cancelado pasa a `activo_key = NULL` y **sale del índice único** (NULL no colisiona en MySQL), con lo que el horario se libera automáticamente sin borrar el registro histórico.

---

## Reglas de negocio implementadas

### No superposición de horarios
`horario.controller.js` valida dos cosas antes de guardar un bloque:

1. **Un médico no puede estar en dos lugares a la vez.** La comprobación corre sobre *todos* sus bloques del día, sin importar el consultorio.
2. **Un consultorio no puede tener dos profesionales en el mismo tramo.**

El criterio es `a.inicio < b.fin AND b.inicio < a.fin`, que detecta solapamiento parcial, total y contenido, y **permite bloques contiguos** (09:00–12:00 seguido de 12:00–15:00 es válido).

### Cálculo de disponibilidad
`utils/disponibilidad.js` arma los turnos libres:

1. Toma los bloques de `horarios` del día de la semana correspondiente.
2. Los parte en slots de `duracion_turno_min`.
3. Descarta los que chocan con turnos vigentes (propios o de otro consultorio del médico).
4. Descarta los que ya pasaron, si la fecha es hoy.

Trabaja con minutos enteros y strings `YYYY-MM-DD` / `HH:MM:SS`, así que no hay corrimientos de zona horaria entre MySQL, Node y el navegador.

**Duración del turno.** Se configura desde `medico/horarios`, en una sección propia con dos cuadros de texto (horas y minutos) que arrancan en `0`.

Validación en tres capas, con los mismos rangos:

| Capa | Qué controla |
|---|---|
| Ingreso (`alCambiarDuracion`) | Tecla por tecla: descarta lo no numérico y rechaza el valor si sale del rango del campo — **horas 0–4**, **minutos 0–60** |
| `express-validator` | Vuelve a validar cada campo por separado, ante pegado o autocompletado |
| Controlador | El **total**, contra el mismo rango del `CHECK ck_medicos_slot`: entre 5 minutos y 4 horas |

Se admiten 60 minutos como equivalente a una hora, así que `0 h 60 min` y `1 h 0 min` dan el mismo resultado. Las combinaciones que se pasan del total (por ejemplo `4 h 60 min` = 300 min) las corta el controlador.

El cambio afecta solo a la disponibilidad que se calcula de ahí en más; los turnos ya reservados conservan su `hora_inicio`/`hora_fin`.

### Flujo de reserva: Día → Consultorio → Horario

`/paciente/reservar/:medicoId` guía al paciente en tres pasos:

1. **Día.** Solo se listan los días con turnos libres en los próximos 30.
2. **Consultorio.** Se resuelven los consultorios en los que el médico atiende ese día. Si hay **uno solo**, se muestra directamente y el paso no pide ninguna decisión; si hay **varios**, aparece un desplegable con nombre, localidad, franja horaria y cantidad de turnos libres de cada uno.
3. **Horario.** Botones con los turnos libres, **filtrados por el consultorio del paso 2**.

Cambiar el día reinicia los pasos 2 y 3. Un consultorio que se quedó sin turnos libres no se ofrece.

Un mismo horario nunca pertenece a dos consultorios, porque la validación de la plantilla semanal ya impide que el médico tenga bloques solapados aunque sean de sedes distintas.

**Horarios pasados** se descartan dos veces: en el backend al calcular los slots, y en el cliente contra la hora actual, por si la pantalla quedó abierta un rato largo.

**El consultorio elegido viaja en la reserva.** `POST /api/turnos` acepta `consultorioId` y verifica que coincida con el del slot; si no, responde 409. Así un turno nunca termina reservado en un consultorio distinto al que el paciente vio, por ejemplo si el médico reorganizó su agenda mientras él elegía.

### Cancelaciones y pacientes reincidentes

**El paciente puede cancelar cualquier turno vigente.** No hay límite de antelación: lo único que lo impide es que el turno ya esté cancelado, realizado, o que su hora haya pasado. La antelación configurada (`CANCELACION_HORAS_RECOMENDADAS`) ya no bloquea — solo avisa que la cancelación es sobre la hora y sugiere llamar al consultorio.

La barrera se reemplazó por **trazabilidad**: cada cancelación queda registrada en el turno (`cancelado_por`, `cancelado_at`, `motivo_cancelacion`) y el médico ve a quién le cancela seguido.

**Registro.** No hay contador desnormalizado: los turnos no se borran al cancelarse, así que el dato se deriva de ellos. Un contador en `pacientes` sería redundante (rompe 3FN) y una fuente de desincronización. Cada turno de la agenda trae:

- `cancelaciones_paciente` — cuántas veces ese paciente canceló **con ese médico**
- `ultima_cancelacion_paciente` — la fecha de la última

El alcance es **por médico a propósito**: un profesional no ve la conducta del paciente con otros tenants. Solo se cuentan las cancelaciones hechas por el paciente; las del médico o el admin no son responsabilidad suya.

**Marcado en rojo.** Superado el umbral (`CANCELACIONES_ALERTA`, por defecto *más de 2*), el turno se pinta con `bg-rose-500/10` — rojo al 10% sobre blanco — tanto en la grilla semanal como en la tabla. La opacidad baja es deliberada: el texto conserva contraste **WCAG AA** (verificado: ≥ 4.5:1 para la hora, el nombre y el contador), mientras que un rojo opaco lo volvería ilegible.

El turno marcado muestra además un contador clicable que abre el **historial completo** (fechas, antelación de cada cancelación y motivo) y deja el teléfono del paciente a mano como enlace `tel:`, para que el médico decida si sostiene el turno o se comunica.

Los turnos ya cancelados no se marcan: la alerta sirve para los que siguen en pie.

**Transparencia hacia el paciente.** En "Mis turnos" ve su propio total, y antes de confirmar una cancelación se le informa cuántas lleva con ese profesional y que quedan registradas.

### Reserva concurrente
`Turno.reservar()` corre en una transacción con `SELECT ... FOR UPDATE` sobre los turnos del médico en esa fecha. Si dos pacientes intentan el mismo slot, el segundo recibe un **409** con un mensaje claro. Aun si el `FOR UPDATE` no alcanzara, el índice único lo rechaza.

### Aislamiento multi-tenant
El middleware `resolverTenant` resuelve el médico **desde el token**, nunca desde el body, y lo deja en `req.medico`. Todos los modelos del tenant reciben `medico_id` en el `WHERE`, así que un profesional no puede leer ni modificar recursos de otro aunque conozca los ids.

### CRUD de médicos y eliminación definitiva

El panel del admin tiene alta, edición, suspensión y borrado. **Suspender y eliminar son cosas distintas a propósito:**

| | Suspender | Eliminar |
|---|---|---|
| Reversible | Sí | **No** |
| Sale de la búsqueda | Sí | Sí |
| Pierde el acceso | Sí | Sí |
| Turnos, pagos, historial | Se conservan | **Se borran** |

**Orden de borrado.** `Medico.eliminarDefinitivo()` borra en orden explícito dentro de una transacción, sin apoyarse en los `ON DELETE CASCADE`:

```
pagos → turnos → horarios → consultorios → suscripciones → medicos → users
```

El motivo es concreto: `turnos.consultorio_id` es `ON DELETE RESTRICT`, e InnoDB no garantiza el orden entre cascadas hermanas. Borrar `medicos` podía intentar eliminar un consultorio que todavía tenía turnos apuntándole y fallar con `ER_ROW_IS_REFERENCED_2`. Los **pacientes no se tocan**: son de la plataforma, no del tenant.

**Confirmación.** El `DELETE` exige que el body repita el email del profesional (`confirmacion`). No es burocracia: un `DELETE` con el id equivocado destruye el historial de otro médico sin vuelta atrás. La UI consulta primero `/:id/impacto-eliminacion` y muestra el alcance real —cuántos turnos, pagos, consultorios, cuántos turnos futuros vigentes y cuánto dinero acreditado se pierde— antes de habilitar el botón. La operación queda además en el log del servidor con el admin que la ejecutó.

### Suscripciones
Suspender a un médico lo saca de la búsqueda pública y le bloquea el login. `exigirTenantActivo` le impide además modificar su agenda. Registrar el pago del período — manual desde el panel del admin, o vía webhook de MercadoPago — lo **rehabilita automáticamente**.

---

## API

`POST` públicos marcados con 🌐; el resto requiere `Authorization: Bearer <token>`.

### `/api/auth`
| Método | Ruta | Descripción |
|---|---|---|
| POST 🌐 | `/registro` | Alta de médico o paciente |
| POST 🌐 | `/login` | Devuelve JWT (rate limit: 10/15min) |
| GET | `/perfil` | Usuario + perfil de su rol |
| PUT | `/perfil` | Actualiza datos de contacto |
| PUT | `/password` | Cambio de contraseña |

### `/api/medicos`
| Método | Ruta | Rol |
|---|---|---|
| GET 🌐 | `/` | Búsqueda pública (solo activos) |
| GET 🌐 | `/:id/disponibilidad` | Calendario de slots libres |
| GET | `/admin/todos` | admin — listado + estado de suscripción |
| POST | `/` | admin — alta de profesional |
| PUT | `/:id` | admin — editar datos y, opcionalmente, resetear contraseña |
| PATCH | `/:id/estado` | admin — suspender / habilitar (reversible) |
| GET | `/:id/impacto-eliminacion` | admin — qué se perdería al eliminarlo |
| DELETE | `/:id` | admin — **eliminación definitiva** (exige confirmación) |
| GET·PUT | `/mi/perfil` | médico — configuración de agenda y tarifas |
| PATCH | `/mi/duracion-turno` | médico — duración del slot, en horas + minutos |
| GET·PUT·DELETE | `/mi/mercadopago` | médico — conectar / desconectar su cuenta de cobro |

### `/api/consultorios` · `/api/horarios`
CRUD completo del tenant (`GET /`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id`).

### `/api/turnos`
| Método | Ruta | Rol |
|---|---|---|
| POST | `/` | paciente — reservar (`medicoId`, `fecha`, `horaInicio`, `consultorioId?`) |
| GET | `/mis-turnos` | paciente |
| GET | `/agenda` | médico — agenda por rango de fechas |
| GET | `/mis-pacientes` | médico |
| PATCH | `/:id/estado` | médico — confirmado / completado / ausente |
| PATCH | `/:id/cancelar` | paciente, médico o admin — sin límite de antelación |
| GET | `/pacientes/:id/cancelaciones` | médico — registro de cancelaciones de un paciente |

### `/api/pagos` · `/api/suscripciones`
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/pagos/preferencia` | Crea la preferencia de MercadoPago (seña o total) |
| POST 🌐 | `/pagos/webhook` | Notificación de MercadoPago |
| GET | `/pagos/recibidos` | médico — pagos acreditados |
| GET | `/suscripciones` | admin — listado con filtros |
| POST | `/suscripciones/generar-periodo` | admin — abre el mes para todos |
| POST | `/suscripciones/suspender-morosos` | admin — suspensión en bloque |
| POST | `/suscripciones/:id/pagar` | médico — link de pago del canon |

---

## MercadoPago

Hay **dos orígenes de credenciales**, porque son dos flujos de dinero distintos:

| Flujo | Credenciales | Destino del dinero |
|---|---|---|
| Turnos (seña o total) | Las **del médico**, cargadas en `/medico/cobros` | La cuenta del profesional |
| Suscripción mensual | `MP_ACCESS_TOKEN` del `.env` | La cuenta de la plataforma |

### Médico sin credenciales → sin pago online

Si el profesional no conectó su cuenta, **no se le ofrece pagar al paciente**:

- La tarjeta del médico en la búsqueda muestra *"Pago: en el consultorio"*.
- El modal de reserva dice cómo se abona y el botón pasa a **"Confirmar reserva"**.
- El turno se crea **`confirmado`** en lugar de `pendiente`: no hay nada que esperar.
- En "Mis turnos" no aparecen los botones de pago, y en lugar de *"Abonado X de Y"* se lee *"A abonar Y en el consultorio"*.
- `POST /api/pagos/preferencia` responde **409** si igual se lo invoca.

La decisión es `mercadopago_configurado && precio_consulta > 0`, y viaja al frontend como `mercadopagoConfigurado` (disponibilidad) y `medico_cobra_online` (cada turno).

### Guardado de las credenciales

El access token se verifica contra `GET /users/me` de MercadoPago **antes** de guardarlo —para no descubrir un error de tipeo recién cuando un paciente intenta pagar— y se almacena cifrado con **AES-256-GCM** ([utils/cripto.js](backend/src/utils/cripto.js)), con clave derivada por `scrypt` de `CRED_SECRET`.

GCM autentica además de cifrar: si el dato fue alterado, el descifrado devuelve `null` en vez de basura. El token **nunca sale por la API**: hacia afuera solo viaja el booleano `mercadopago_configurado` y, para el propio médico, si es de prueba.

### Flujo de cobro

1. El paciente elige seña o total → `POST /api/pagos/preferencia`.
2. Se crea la fila en `pagos` (`pendiente`) y la preferencia **con el token del médico**.
3. El paciente paga y MercadoPago notifica al webhook.
4. El webhook **consulta el pago real contra la API** (no confía en el payload entrante) y actualiza `pagos`. Si se aprueba, el turno pasa a `confirmado`.

El `external_reference` usa el formato `turno:<id>:<tipo>` / `suscripcion:<id>`. Como para consultar un pago hace falta el token del vendedor, la `notification_url` lleva el turno en la query (`?turno=<id>`): con eso el webhook resuelve el profesional y usa **sus** credenciales. Después verifica que el `external_reference` apunte a ese mismo turno, para que una notificación no pueda tocar un turno ajeno.

### Probar sin dinero real

El médico carga sus credenciales **de prueba** (las que empiezan con `TEST-`) en `/medico/cobros`: el checkout es el de sandbox y el flujo se recorre completo. El panel avisa en ámbar que los pagos no son reales.

> No existe un endpoint de "pago simulado" para turnos. Había uno, habilitado cuando la plataforma no tenía credenciales; al pasar el cobro a las credenciales de cada médico ese permiso se volvía peligroso (un paciente podría marcar como aprobado un pago creado con el token real del profesional sin haber pagado). Se eliminó.

Para recibir webhooks en desarrollo hace falta una URL pública (ngrok):

```bash
ngrok http 4000
# copiar la URL en MP_WEBHOOK_URL
```

---

## Seguridad

- **Contraseñas** con bcrypt (coste 12). El login responde el mismo mensaje genérico ante email inexistente o contraseña incorrecta, para no revelar qué cuentas existen.
- **SQL injection:** todas las consultas usan placeholders `?`; no hay concatenación de valores.
- **Validación de entrada** con express-validator en cada endpoint de escritura.
- **Autorización por rol y por tenant** en el servidor. Las guardas del frontend son solo UX.
- **Errores:** únicamente los `ApiError` exponen su mensaje. Cualquier otro error se loguea completo del lado servidor y el cliente recibe un 500 genérico, sin stack traces ni detalles de MySQL.
- **Helmet** (cabeceras de seguridad), **CORS** restringido al dominio del frontend en producción, y **rate limiting** general (200 req/min) y de login.
- El registro público solo permite crear `medico` y `paciente`; el rol `admin` se siembra por seed.

---

## Verificaciones realizadas

- `node --check` sobre los 26 archivos JS del backend — sin errores de sintaxis.
- `npm run build` del frontend — 108 módulos, build correcto.
- Carga de la app Express — **74 endpoints** montados.
- 20 aserciones sobre la lógica de tiempo y solapamiento (bloques contiguos, rangos contenidos, cruce de mes/año, año bisiesto, generación de slots) — todas OK.
- 37 aserciones sobre la duración del turno (control de ingreso por campo, conversión horas+minutos, límites de 5 min / 4 h, formato, impacto en la cantidad de slots) — todas OK.
- 20 aserciones sobre el flujo de reserva (agrupación por consultorio, caso de uno solo vs. varios, filtrado de horarios por consultorio, consultorio sin turnos libres, descarte de horarios pasados, rechazo de consultorio distinto) — todas OK.
- 21 aserciones sobre cobros por médico, contra el módulo de cifrado real: ida y vuelta del token, IV aleatorio, detección de manipulación, largo dentro de `VARCHAR(512)`, y la decisión de pedir pago o confirmar directo — todas OK.
- 22 aserciones sobre cancelaciones: umbral de marcado, cancelación disponible sin límite de antelación, quién suma al contador, y **contraste WCAG del fondo rojo translúcido** calculado sobre los colores reales — todas OK.
- 22 aserciones sobre el CRUD del admin: orden de borrado verificado contra las FK declaradas en el esquema, uso de transacción, que no se toquen datos ajenos al tenant, la puerta de confirmación por email y el orden de las rutas frente a `/:id` — todas OK.
- 44 aserciones sobre el módulo de agendamiento: hash no enumerable (1000 sin colisión, rechazo de ids y de inyección), normalización del WhatsApp, **la restricción del audio verificada sobre el código y el esquema reales** (sin `multer`, sin `multipart`, sin columna de audio, sin `MediaRecorder`/`Blob`/`FormData`), bloqueo de nuevas reservas al cancelar el día, aislamiento de los datos clínicos y cuentas invitadas — todas OK.

Pendiente de ejecutar contra una base real: `npm run db:migrate && npm run db:seed` (requiere la contraseña de MySQL en el `.env`).
