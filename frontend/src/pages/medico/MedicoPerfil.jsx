/**
 * pages/medico/MedicoPerfil.jsx
 * Datos del profesional: personales, acceso (email y clave) y profesionales.
 *
 * Son TRES formularios separados y no uno solo, a proposito:
 *   - cada bloque se guarda por su cuenta, asi un error de contrasena no
 *     hace perder los cambios de los otros campos;
 *   - cambiar el email exige la contrasena actual y conviene que ese pedido
 *     quede acotado a ese bloque, sin ensuciar el resto;
 *   - van a endpoints distintos (/auth/perfil, /auth/password,
 *     /medicos/mi/perfil), cada uno con sus propias validaciones.
 */
import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { authApi, medicosApi } from '../../api/servicios';
import { useAuth } from '../../context/AuthContext';
import { Aviso, Cargando, Campo } from '../../components/UI';
import SelectorEspecialidad from '../../components/SelectorEspecialidad';
import { GENEROS, tratamiento } from '../../utils/tratamiento';

export default function MedicoPerfil() {
  const { refrescar } = useAuth();

  const [medico, setMedico] = useState(null);
  const [usuario, setUsuario] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [perfilMedico, perfilUsuario] = await Promise.all([
        medicosApi.miPerfil(),
        authApi.perfil(),
      ]);
      setMedico(perfilMedico.medico);
      setUsuario(perfilUsuario.usuario);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  if (cargando) return <Cargando texto="Cargando tu perfil..." />;
  if (!medico || !usuario) {
    return <Aviso tipo="error">{error?.message || 'No se pudo cargar el perfil.'}</Aviso>;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Mi perfil</h1>
        <p className="text-sm text-slate-600">
          Tus datos personales, de acceso y profesionales.
        </p>
      </header>

      {aviso && <Aviso tipo="exito" onCerrar={() => setAviso(null)}>{aviso}</Aviso>}
      {error && (
        <Aviso tipo="error" detalles={error.detalles} onCerrar={() => setError(null)}>
          {error.message}
        </Aviso>
      )}

      <BloqueDatosPersonales usuario={usuario} onGuardado={async (m) => {
        setAviso(m); await cargar(); await refrescar();
      }} />

      <BloqueAcceso usuario={usuario} onGuardado={async (m) => {
        setAviso(m); await cargar(); await refrescar();
      }} />

      <BloqueProfesional medico={medico} onGuardado={async (m) => {
        setAviso(m); await cargar(); await refrescar();
      }} />
    </div>
  );
}

/* ===================================================================== *
 *                        1. Datos personales
 * ===================================================================== */
function BloqueDatosPersonales({ usuario, onGuardado }) {
  const [error, setError] = useState(null);
  const {
    register, handleSubmit, formState: { errors, isDirty, isSubmitting }, reset,
  } = useForm({
    defaultValues: {
      nombre: usuario.nombre || '',
      apellido: usuario.apellido || '',
      telefono: usuario.telefono || '',
    },
  });

  const guardar = async (valores) => {
    setError(null);
    try {
      // Sin `email`: este bloque no lo toca, va en el de acceso.
      const { mensaje } = await authApi.actualizarPerfil({
        nombre: valores.nombre,
        apellido: valores.apellido,
        telefono: valores.telefono || null,
      });
      reset(valores);   // los valores guardados pasan a ser el nuevo "limpio"
      onGuardado(mensaje);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <form onSubmit={handleSubmit(guardar)} className="card space-y-4">
      <h2 className="text-base font-semibold text-slate-900">Datos personales</h2>

      {error && (
        <Aviso tipo="error" detalles={error.detalles} onCerrar={() => setError(null)}>
          {error.message}
        </Aviso>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label="Nombre" requerido error={errors.nombre?.message}>
          <input className="input"
            {...register('nombre', { required: 'El nombre es obligatorio' })} />
        </Campo>
        <Campo label="Apellido" requerido error={errors.apellido?.message}>
          <input className="input"
            {...register('apellido', { required: 'El apellido es obligatorio' })} />
        </Campo>
      </div>

      <Campo label="Telefono" error={errors.telefono?.message}
        ayuda="Tu telefono de contacto interno. No se muestra en la busqueda publica.">
        <input className="input" {...register('telefono')} />
      </Campo>

      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primario" disabled={isSubmitting || !isDirty}>
          {isSubmitting ? 'Guardando...' : 'Guardar datos'}
        </button>
        {!isDirty && <span className="text-xs text-slate-500">Sin cambios para guardar.</span>}
      </div>
    </form>
  );
}

/* ===================================================================== *
 *                    2. Acceso: email y contrasena
 * ===================================================================== */
function BloqueAcceso({ usuario, onGuardado }) {
  const [errorEmail, setErrorEmail] = useState(null);
  const [errorClave, setErrorClave] = useState(null);

  const formEmail = useForm({
    defaultValues: { email: usuario.email || '', passwordActual: '' },
  });
  const formClave = useForm({
    defaultValues: { passwordActual: '', passwordNueva: '', repetir: '' },
  });

  const guardarEmail = async (valores) => {
    setErrorEmail(null);
    try {
      const { mensaje } = await authApi.actualizarPerfil({
        // El endpoint espera el perfil completo; se reenvian los actuales.
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        telefono: usuario.telefono || null,
        email: valores.email,
        passwordActual: valores.passwordActual,
      });
      formEmail.reset({ email: valores.email, passwordActual: '' });
      onGuardado(mensaje);
    } catch (err) {
      setErrorEmail(err);
    }
  };

  const guardarClave = async (valores) => {
    setErrorClave(null);
    if (valores.passwordNueva !== valores.repetir) {
      setErrorClave(new Error('Las contrasenas nuevas no coinciden'));
      return;
    }
    try {
      const { mensaje } = await authApi.cambiarPassword({
        passwordActual: valores.passwordActual,
        passwordNueva: valores.passwordNueva,
      });
      formClave.reset({ passwordActual: '', passwordNueva: '', repetir: '' });
      onGuardado(mensaje);
    } catch (err) {
      setErrorClave(err);
    }
  };

  return (
    <div className="card space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Acceso</h2>
        <p className="text-sm text-slate-600">
          Con estos datos inicias sesion. Cambiarlos pide tu contrasena actual.
        </p>
      </div>

      {/* ------------------------------ Email ------------------------------ */}
      <form onSubmit={formEmail.handleSubmit(guardarEmail)} className="space-y-4">
        <h3 className="text-sm font-medium text-slate-700">Email</h3>

        {errorEmail && (
          <Aviso tipo="error" detalles={errorEmail.detalles} onCerrar={() => setErrorEmail(null)}>
            {errorEmail.message}
          </Aviso>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo label="Email" requerido error={formEmail.formState.errors.email?.message}>
            <input type="email" className="input" autoComplete="email"
              {...formEmail.register('email', {
                required: 'El email es obligatorio',
                pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Email invalido' },
              })} />
          </Campo>
          <Campo label="Contrasena actual" requerido
            error={formEmail.formState.errors.passwordActual?.message}
            ayuda="Confirma que sos vos quien cambia el email.">
            <input type="password" className="input" autoComplete="current-password"
              {...formEmail.register('passwordActual', {
                required: 'Ingresa tu contrasena actual',
              })} />
          </Campo>
        </div>

        <Aviso tipo="alerta">
          Si cambias el email, a partir de ese momento vas a iniciar sesion con el nuevo.
        </Aviso>

        <button type="submit" className="btn-primario"
          disabled={formEmail.formState.isSubmitting || !formEmail.formState.isDirty}>
          {formEmail.formState.isSubmitting ? 'Guardando...' : 'Cambiar email'}
        </button>
      </form>

      {/* ---------------------------- Contrasena --------------------------- */}
      <form onSubmit={formClave.handleSubmit(guardarClave)}
        className="space-y-4 border-t border-slate-200 pt-6">
        <h3 className="text-sm font-medium text-slate-700">Contrasena</h3>

        {errorClave && (
          <Aviso tipo="error" detalles={errorClave.detalles} onCerrar={() => setErrorClave(null)}>
            {errorClave.message}
          </Aviso>
        )}

        <Campo label="Contrasena actual" requerido
          error={formClave.formState.errors.passwordActual?.message}>
          <input type="password" className="input sm:max-w-sm" autoComplete="current-password"
            {...formClave.register('passwordActual', { required: 'Ingresa tu contrasena actual' })} />
        </Campo>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo label="Contrasena nueva" requerido
            error={formClave.formState.errors.passwordNueva?.message}
            ayuda="Minimo 8 caracteres, con letras y numeros.">
            <input type="password" className="input" autoComplete="new-password"
              {...formClave.register('passwordNueva', {
                required: 'Ingresa la contrasena nueva',
                minLength: { value: 8, message: 'Debe tener al menos 8 caracteres' },
                validate: (v) => {
                  if (!/[a-zA-Z]/.test(v)) return 'Debe incluir letras';
                  if (!/\d/.test(v)) return 'Debe incluir numeros';
                  return true;
                },
              })} />
          </Campo>
          <Campo label="Repetir contrasena nueva" requerido
            error={formClave.formState.errors.repetir?.message}>
            <input type="password" className="input" autoComplete="new-password"
              {...formClave.register('repetir', { required: 'Repeti la contrasena' })} />
          </Campo>
        </div>

        <button type="submit" className="btn-primario" disabled={formClave.formState.isSubmitting}>
          {formClave.formState.isSubmitting ? 'Guardando...' : 'Cambiar contrasena'}
        </button>
      </form>
    </div>
  );
}

/* ===================================================================== *
 *                      3. Datos profesionales
 * ===================================================================== */

/**
 * Prefijo fijo de la matricula.
 *
 * El cuadro de texto muestra "MP-" como parte del campo pero FUERA del input:
 * no se puede borrar ni editar, y el profesional solo tipea los numeros. Asi
 * el valor guardado queda siempre con el mismo formato, en lugar de depender
 * de que cada uno lo escriba igual ("MP-2505", "mp-2505", "2505").
 */
const PREFIJO_MATRICULA = 'MP-';

/**
 * Deja solo los digitos de la matricula para mostrarlos en el cuadro.
 *
 * Tolera lo que ya pueda haber guardado: con o sin prefijo, en mayuscula o
 * minuscula, con espacios. Todo lo que no sea un digito se descarta, asi que
 * el valor que se vuelve a guardar siempre es PREFIJO + numeros.
 */
function soloNumeros(matricula) {
  return String(matricula || '').replace(/\D/g, '');
}

/**
 * Lo que se guardo originalmente, menos el prefijo y los digitos.
 *
 * Sirve para avisarle al profesional que su matricula tenia otra forma (por
 * ejemplo "MN-1234", de otra jurisdiccion) y que al guardar va a cambiar.
 * Cambiar el dato sin decirlo seria peor que no poder cambiarlo.
 */
function restoDescartado(matricula) {
  return String(matricula || '')
    .replace(new RegExp(`^\\s*${PREFIJO_MATRICULA}`, 'i'), '')
    .replace(/\d/g, '')
    .trim();
}

function BloqueProfesional({ medico, onGuardado }) {
  const [error, setError] = useState(null);
  const [especialidadId, setEspecialidadId] = useState(medico.especialidad_id);
  const [especialidadNombre, setEspecialidadNombre] = useState(medico.especialidad);
  const [tocado, setTocado] = useState(false);

  const {
    register, handleSubmit, watch, setValue, formState: { errors, isDirty, isSubmitting }, reset,
  } = useForm({
    defaultValues: {
      dni: medico.dni || '',
      genero: medico.genero || '',
      // En el formulario viaja SOLO la parte numerica; el prefijo se agrega
      // al guardar. Ver PREFIJO_MATRICULA.
      matricula: soloNumeros(medico.matricula),
      precioConsulta: medico.precio_consulta ?? '',
      porcentajeSena: medico.porcentaje_sena ?? 30,
    },
  });

  // Para mostrar "Dr." / "Dra." mientras se elige, sin esperar a guardar.
  const generoElegido = watch('genero');

  // La parte numerica de la matricula. El prefijo se agrega al guardar.
  const matriculaNumeros = watch('matricula');

  const elegirEspecialidad = (id, especialidad) => {
    setEspecialidadId(id);
    setEspecialidadNombre(especialidad?.nombre || '');
    setTocado(true);
  };

  const guardar = async (valores) => {
    setError(null);
    if (!especialidadId) {
      setError(new Error('Elegi tu especialidad'));
      return;
    }
    try {
      const { mensaje } = await medicosApi.actualizarMiPerfil({
        especialidadId: Number(especialidadId),
        dni: valores.dni.trim(),
        // Vacio = "prefiero no cargarlo": se manda null y se muestra "Dr/a."
        genero: valores.genero || null,
        matricula: `${PREFIJO_MATRICULA}${valores.matricula}`,
        // La duracion del turno se edita en Horarios, que es donde se usa.
        duracionTurnoMin: Number(medico.duracion_turno_min),
        precioConsulta: Number(valores.precioConsulta || 0),
        porcentajeSena: Number(valores.porcentajeSena),
      });
      reset(valores);
      setTocado(false);
      onGuardado(mensaje);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <form onSubmit={handleSubmit(guardar)} className="card space-y-4">
      <h2 className="text-base font-semibold text-slate-900">Datos profesionales</h2>

      {error && (
        <Aviso tipo="error" detalles={error.detalles} onCerrar={() => setError(null)}>
          {error.message}
        </Aviso>
      )}

      <Campo label="Especialidad" requerido
        ayuda="Escribi parte del nombre para buscarla. Si no esta, podes agregarla.">
        <SelectorEspecialidad
          value={especialidadId}
          nombreActual={especialidadNombre}
          onChange={elegirEspecialidad}
        />
      </Campo>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label="DNI" requerido error={errors.dni?.message}
          ayuda="Te identifica en el sistema. No aparece en tu enlace de turnos.">
          <input className="input" inputMode="numeric" placeholder="30123456"
            {...register('dni', {
              required: 'El DNI es obligatorio',
              pattern: { value: /^[0-9.]{7,20}$/, message: 'Solo numeros, entre 7 y 20 digitos' },
            })} />
        </Campo>
        <Campo label="Genero" error={errors.genero?.message}
          ayuda={`Define como te nombra el sistema: ${generoElegido ? tratamiento(generoElegido) : 'Dr/a.'}`}>
          <select className="input" {...register('genero')}>
            <option value="">Prefiero no indicarlo</option>
            {GENEROS.map((g) => (
              <option key={g.valor} value={g.valor}>{g.etiqueta} ({g.titulo})</option>
            ))}
          </select>
        </Campo>
      </div>

      {restoDescartado(medico.matricula) && (
        <Aviso tipo="alerta">
          Tu matrícula figura como <b>{medico.matricula}</b>, que no sigue el formato{' '}
          <b>{PREFIJO_MATRICULA}número</b>. Si guardás, va a quedar como{' '}
          <b>{PREFIJO_MATRICULA}{soloNumeros(medico.matricula)}</b>. Si no es lo que
          corresponde, avisale al administrador antes de guardar.
        </Aviso>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label="Matricula" requerido error={errors.matricula?.message}
          ayuda={`Cargá solo los números: el prefijo ${PREFIJO_MATRICULA} ya está puesto.`}>
          {/* El prefijo es parte del recuadro pero no del input: no se puede
              seleccionar, borrar ni tabular hasta el. El focus del input pinta
              el borde del contenedor entero para que se vea como un campo. */}
          <div className="flex items-stretch rounded-lg bg-white shadow-sm ring-1 ring-inset ring-slate-300
                          focus-within:ring-2 focus-within:ring-inset focus-within:ring-marca-600">
            <span aria-hidden="true"
              className="flex select-none items-center rounded-l-lg border-r border-slate-200
                         bg-slate-50 px-3 text-sm font-semibold text-slate-500">
              {PREFIJO_MATRICULA}
            </span>
            {/*
              Campo CONTROLADO a proposito. El filtro se aplica en el onChange
              y el estado del formulario nunca llega a contener otra cosa que
              digitos: si alguien pega "MP-2505", queda "2505" y no se guarda
              "MP-MP-2505". Dejarlo sin controlar y limpiar al enviar abriria
              la ventana de ver una cosa en pantalla y guardar otra.
            */}
            <input
              className="block w-full rounded-r-lg border-0 bg-transparent px-3 py-2 text-slate-900
                         placeholder:text-slate-400 focus:outline-none focus:ring-0 sm:text-sm"
              inputMode="numeric"
              autoComplete="off"
              placeholder="12345"
              maxLength={20}
              aria-label={`Numero de matricula, con prefijo ${PREFIJO_MATRICULA}`}
              {...register('matricula', { required: 'Cargá el número de tu matrícula' })}
              value={matriculaNumeros ?? ''}
              onChange={(e) => setValue('matricula', soloNumeros(e.target.value), {
                shouldDirty: true,
                shouldValidate: true,
              })} />
          </div>
        </Campo>
        <Campo label="Precio de la consulta" error={errors.precioConsulta?.message}>
          <input type="number" min="0" step="100" className="input"
            {...register('precioConsulta', { min: { value: 0, message: 'No puede ser negativo' } })} />
        </Campo>
      </div>

      <Campo label="Sena (%)" error={errors.porcentajeSena?.message}
        ayuda="Porcentaje del total que el paciente abona al reservar, si cobras online.">
        <input type="number" min="0" max="100" className="input sm:max-w-[140px]"
          {...register('porcentajeSena', {
            min: { value: 0, message: 'Entre 0 y 100' },
            max: { value: 100, message: 'Entre 0 y 100' },
          })} />
      </Campo>

      <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
        La duracion de los turnos se configura en <b>Horarios</b>, que es donde se arma la agenda.
      </p>

      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primario"
          disabled={isSubmitting || (!isDirty && !tocado)}>
          {isSubmitting ? 'Guardando...' : 'Guardar datos profesionales'}
        </button>
        {!isDirty && !tocado && (
          <span className="text-xs text-slate-500">Sin cambios para guardar.</span>
        )}
      </div>
    </form>
  );
}
