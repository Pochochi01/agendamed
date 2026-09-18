/**
 * layouts/LayoutPanel.jsx
 * Marco comun de los paneles (admin / medico / paciente): barra superior,
 * navegacion lateral responsive y area de contenido.
 *
 * Los items de navegacion los define cada panel y se pasan por props.
 */
import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function LayoutPanel({ titulo, items = [] }) {
  const { usuario, cerrarSesion } = useAuth();
  const navegar = useNavigate();
  const [menuAbierto, setMenuAbierto] = useState(false);

  const salir = () => {
    cerrarSesion();
    navegar('/login', { replace: true });
  };

  const iniciales = `${usuario?.nombre?.[0] || ''}${usuario?.apellido?.[0] || ''}`.toUpperCase();

  // Las clases se escriben completas (nada de `bg-${color}-50`): Tailwind
  // analiza el codigo de forma estatica y no detecta clases interpoladas.
  const claseItem = ({ isActive }) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
      isActive
        ? 'bg-marca-50 text-marca-700'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
    }`;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ------------------------- Barra superior ------------------------- */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setMenuAbierto((v) => !v)}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
              aria-label="Abrir menu">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            <Link to="/" className="flex items-center gap-2">
              <span className="text-2xl">🩺</span>
              <span className="text-lg font-bold text-slate-900">AgendaMed</span>
            </Link>

            <span className="hidden rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 sm:inline">
              {titulo}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight text-slate-900">
                {usuario?.nombre} {usuario?.apellido}
              </p>
              <p className="text-xs capitalize text-slate-500">{usuario?.rol}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-marca-600 text-sm font-semibold text-white">
              {iniciales}
            </div>
            <button type="button" onClick={salir} className="btn-secundario btn-sm">
              Salir
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:px-8">
        {/* --------------------------- Navegacion -------------------------- */}
        <aside className={`${menuAbierto ? 'block' : 'hidden'} lg:block`}>
          <nav className="fixed inset-x-0 bottom-0 top-16 z-20 space-y-1 overflow-y-auto border-r border-slate-200 bg-white p-4 lg:static lg:inset-auto lg:w-56 lg:border-0 lg:bg-transparent lg:p-0">
            {items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={claseItem}
                onClick={() => setMenuAbierto(false)}>
                <span className="text-base">{item.icono}</span>
                <span>{item.texto}</span>
              </NavLink>
            ))}
          </nav>
        </aside>

        {/* --------------------------- Contenido --------------------------- */}
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
