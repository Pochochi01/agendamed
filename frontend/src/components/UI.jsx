/**
 * components/UI.jsx
 * Componentes de presentacion reutilizados por los tres paneles.
 * Sin logica de negocio: solo estado visual.
 */
import { useEffect } from 'react';

/** Spinner centrado para estados de carga. */
export function Cargando({ texto = 'Cargando...', className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-12 text-slate-500 ${className}`}>
      <svg className="h-8 w-8 animate-spin text-marca-600" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor"
          d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
      <span className="text-sm">{texto}</span>
    </div>
  );
}

/** Mensaje de error / exito / info. `tipo`: error | exito | info | alerta */
export function Aviso({ tipo = 'info', children, onCerrar, detalles = [] }) {
  if (!children) return null;

  const estilos = {
    error:  'bg-rose-50 text-rose-800 ring-rose-200',
    exito:  'bg-emerald-50 text-emerald-800 ring-emerald-200',
    alerta: 'bg-amber-50 text-amber-800 ring-amber-200',
    info:   'bg-marca-50 text-marca-800 ring-marca-200',
  };

  return (
    <div className={`animate-aparecer rounded-lg px-4 py-3 text-sm ring-1 ring-inset ${estilos[tipo]}`} role="alert">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{children}</p>
          {detalles.length > 0 && (
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs opacity-90">
              {detalles.map((d, i) => <li key={i}>{d.mensaje || d}</li>)}
            </ul>
          )}
        </div>
        {onCerrar && (
          <button type="button" onClick={onCerrar}
            className="shrink-0 text-lg leading-none opacity-60 hover:opacity-100" aria-label="Cerrar">
            &times;
          </button>
        )}
      </div>
    </div>
  );
}

/** Estado vacio con icono, titulo y accion opcional. */
export function SinDatos({ titulo, descripcion, icono = '📋', accion }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 py-12 text-center">
      <span className="mb-3 text-4xl">{icono}</span>
      <h3 className="text-sm font-semibold text-slate-800">{titulo}</h3>
      {descripcion && <p className="mt-1 max-w-sm text-sm text-slate-500">{descripcion}</p>}
      {accion && <div className="mt-4">{accion}</div>}
    </div>
  );
}

/** Tarjeta de metrica para los dashboards. */
export function Metrica({ titulo, valor, detalle, icono, color = 'marca' }) {
  const colores = {
    marca: 'bg-marca-50 text-marca-700',
    verde: 'bg-emerald-50 text-emerald-700',
    ambar: 'bg-amber-50 text-amber-700',
    rojo: 'bg-rose-50 text-rose-700',
  };

  return (
    <div className="card flex items-center gap-4">
      {icono && (
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-xl ${colores[color]}`}>
          {icono}
        </div>
      )}
      <div className="min-w-0">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-slate-500">{titulo}</p>
        <p className="text-2xl font-semibold text-slate-900">{valor}</p>
        {detalle && <p className="truncate text-xs text-slate-500">{detalle}</p>}
      </div>
    </div>
  );
}

/**
 * Modal accesible: cierra con Escape y bloquea el scroll del body.
 */
export function Modal({ abierto, titulo, onCerrar, children, ancho = 'max-w-lg' }) {
  useEffect(() => {
    if (!abierto) return undefined;
    const alPresionar = (e) => { if (e.key === 'Escape') onCerrar?.(); };
    document.addEventListener('keydown', alPresionar);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', alPresionar);
      document.body.style.overflow = '';
    };
  }, [abierto, onCerrar]);

  if (!abierto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar?.(); }}>
      <div className={`animate-aparecer w-full ${ancho} rounded-t-2xl bg-white shadow-xl sm:rounded-xl`}
        role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">{titulo}</h2>
          <button type="button" onClick={onCerrar}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Cerrar">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/** Campo de formulario con label y mensaje de error. */
export function Campo({ label, error, children, requerido, ayuda }) {
  return (
    <div>
      <label className="label">
        {label} {requerido && <span className="text-rose-500">*</span>}
      </label>
      {children}
      {ayuda && !error && <p className="mt-1 text-xs text-slate-500">{ayuda}</p>}
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}

/** Badge generico (usa las clases definidas en index.css). */
export function Etiqueta({ clase = 'badge-gris', children }) {
  return <span className={clase}>{children}</span>;
}
