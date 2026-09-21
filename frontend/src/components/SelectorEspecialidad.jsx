/**
 * components/SelectorEspecialidad.jsx
 * Buscador de especialidades con opcion de agregar una nueva.
 *
 * ==========================================================================
 * Por que un buscador y no un <select>
 * ==========================================================================
 * El catalogo crece: con decenas de especialidades, un desplegable obliga a
 * recorrer la lista entera. Aca el profesional escribe parte del nombre y el
 * servidor filtra por coincidencia en CUALQUIER posicion del texto, sin
 * distinguir mayusculas ni tildes: "logia" trae Cardiologia, Dermatologia y
 * Neurologia; "CARDIO" trae Cardiologia.
 *
 * Si no encuentra la suya, puede agregarla desde el mismo lugar. El alta es
 * idempotente en el servidor: si ya existia con otra escritura devuelve la
 * que estaba, para no fragmentar el catalogo en variantes del mismo nombre.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { catalogoApi } from '../api/servicios';

/**
 * @param {Object}   props
 * @param {number|string} props.value       id de la especialidad elegida
 * @param {Function} props.onChange         recibe (id, especialidad)
 * @param {string}   [props.nombreActual]   nombre a mostrar al abrir (modo edicion)
 * @param {boolean}  [props.deshabilitado]
 * @param {string}   [props.error]
 */
export default function SelectorEspecialidad({
  value, onChange, nombreActual = '', deshabilitado = false, error = null,
}) {
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState([]);
  const [abierto, setAbierto] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [creando, setCreando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [errorLocal, setErrorLocal] = useState(null);
  // Lo que se muestra cuando el desplegable esta cerrado.
  const [seleccionada, setSeleccionada] = useState(nombreActual);

  const contenedorRef = useRef(null);

  // Si el padre cambia el nombre (al cargar el perfil), se refleja.
  useEffect(() => { setSeleccionada(nombreActual); }, [nombreActual]);

  /** Busca en el servidor con un respiro, para no pedir por cada tecla. */
  const buscar = useCallback(async (q) => {
    setBuscando(true);
    try {
      setResultados(await catalogoApi.especialidades({ q, limite: 30 }));
      setErrorLocal(null);
    } catch (err) {
      setErrorLocal(err.message);
      setResultados([]);
    } finally {
      setBuscando(false);
    }
  }, []);

  useEffect(() => {
    if (!abierto) return undefined;
    const id = setTimeout(() => buscar(texto), 250);
    return () => clearTimeout(id);
  }, [texto, abierto, buscar]);

  // Cerrar al hacer clic afuera.
  useEffect(() => {
    if (!abierto) return undefined;
    const alClicar = (e) => {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target)) setAbierto(false);
    };
    document.addEventListener('mousedown', alClicar);
    return () => document.removeEventListener('mousedown', alClicar);
  }, [abierto]);

  const elegir = (especialidad) => {
    setSeleccionada(especialidad.nombre);
    setTexto('');
    setAbierto(false);
    setAviso(null);
    onChange(especialidad.id, especialidad);
  };

  /** Agrega la especialidad que el profesional escribio. */
  const agregar = async () => {
    const nombre = texto.trim();
    if (nombre.length < 3) {
      setErrorLocal('El nombre debe tener al menos 3 caracteres');
      return;
    }

    setCreando(true);
    setErrorLocal(null);
    try {
      const respuesta = await catalogoApi.crearEspecialidad(nombre);
      // `creada: false` significa que ya existia con otra escritura.
      setAviso(respuesta.mensaje);
      elegir(respuesta.especialidad);
    } catch (err) {
      setErrorLocal(err.message);
    } finally {
      setCreando(false);
    }
  };

  // Solo se ofrece crear si lo escrito no coincide exactamente con algo ya listado.
  const escrito = texto.trim();
  const hayCoincidenciaExacta = resultados.some(
    (e) => e.nombre.localeCompare(escrito, 'es', { sensitivity: 'base' }) === 0
  );
  const puedeAgregar = escrito.length >= 3 && !hayCoincidenciaExacta && !buscando;

  return (
    <div ref={contenedorRef} className="relative">
      {!abierto ? (
        /* Cerrado: muestra la elegida y abre el buscador al tocarla. */
        <button type="button" disabled={deshabilitado}
          onClick={() => { setAbierto(true); setTexto(''); }}
          className={`input flex items-center justify-between text-left ${
            deshabilitado ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
          } ${error ? 'input-error' : ''}`}>
          <span className={seleccionada ? 'text-slate-900' : 'text-slate-400'}>
            {seleccionada || 'Buscar especialidad...'}
          </span>
          <span className="text-slate-400">▾</span>
        </button>
      ) : (
        <input type="text" autoFocus className="input" value={texto}
          placeholder="Escribi parte del nombre. Ej: cardio, logia, pedia"
          onChange={(e) => { setTexto(e.target.value); setAviso(null); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setAbierto(false);
            if (e.key === 'Enter') { e.preventDefault(); if (puedeAgregar) agregar(); }
          }} />
      )}

      {abierto && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <ul className="max-h-56 overflow-y-auto">
            {buscando && (
              <li className="px-3 py-2 text-sm text-slate-400">Buscando...</li>
            )}

            {!buscando && resultados.length === 0 && (
              <li className="px-3 py-2 text-sm text-slate-500">
                {escrito
                  ? `No hay ninguna que contenga "${escrito}".`
                  : 'Escribi para buscar.'}
              </li>
            )}

            {!buscando && resultados.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => elegir(e)}
                  className={`block w-full px-3 py-2 text-left text-sm hover:bg-marca-50 ${
                    String(e.id) === String(value) ? 'bg-marca-50 font-medium text-marca-700' : 'text-slate-700'
                  }`}>
                  {e.nombre}
                </button>
              </li>
            ))}
          </ul>

          {/* Alta de una especialidad que no esta en el catalogo. */}
          {puedeAgregar && (
            <div className="border-t border-slate-200 bg-slate-50 p-2">
              <button type="button" onClick={agregar} disabled={creando}
                className="btn-secundario btn-sm w-full justify-start">
                {creando ? 'Agregando...' : `+ Agregar "${escrito}"`}
              </button>
              <p className="mt-1 px-1 text-[11px] text-slate-500">
                Se suma al catalogo para todos. Si ya existe escrita distinto, se usa esa.
              </p>
            </div>
          )}

          {errorLocal && (
            <p className="border-t border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {errorLocal}
            </p>
          )}
        </div>
      )}

      {aviso && <p className="mt-1 text-xs text-emerald-600">{aviso}</p>}
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}
