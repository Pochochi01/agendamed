/**
 * pages/Home.jsx
 * Landing publica. Si el usuario ya tiene sesion, ofrece entrar a su panel.
 */
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { inicioSegunRol } from '../components/RutaProtegida';

export default function Home() {
  const { autenticado, rol, usuario } = useAuth();

  return (
    <div className="min-h-screen bg-white">
      {/* ------------------------------ Navbar ---------------------------- */}
      <header className="border-b border-slate-200">
        <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🩺</span>
            <span className="text-lg font-bold text-slate-900">AgendaMed</span>
          </div>
          <div className="flex items-center gap-3">
            {autenticado ? (
              <Link to={inicioSegunRol(rol)} className="btn-primario btn-sm">
                Ir a mi panel
              </Link>
            ) : (
              <>
                <Link to="/login" className="btn-secundario btn-sm">Ingresar</Link>
                <Link to="/registro" className="btn-primario btn-sm">Crear cuenta</Link>
              </>
            )}
          </div>
        </nav>
      </header>

      {/* ------------------------------- Hero ----------------------------- */}
      <section className="bg-gradient-to-b from-marca-50 to-white">
        <div className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Turnos medicos online,<br />sin llamados ni esperas
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-600">
            Reserva con el especialista que necesitas, abona la sena o el total por MercadoPago
            y gestiona tus turnos desde donde estes.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to={autenticado ? inicioSegunRol(rol) : '/registro'} className="btn-primario px-6 py-3">
              {autenticado ? `Continuar como ${usuario?.nombre}` : 'Reservar un turno'}
            </Link>
            <Link to="/registro" className="btn-secundario px-6 py-3">
              Soy profesional
            </Link>
          </div>
        </div>
      </section>

      {/* --------------------------- Caracteristicas ---------------------- */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-8 md:grid-cols-3">
          {[
            {
              icono: '📅',
              titulo: 'Disponibilidad real',
              texto: 'El calendario se arma con los horarios de cada profesional y descuenta los turnos ya tomados.',
            },
            {
              icono: '💳',
              titulo: 'Pago con MercadoPago',
              texto: 'Abona la sena para confirmar el turno o el total por adelantado, con la seguridad de MercadoPago.',
            },
            {
              icono: '🏥',
              titulo: 'Varios consultorios',
              texto: 'Cada profesional administra sus consultorios y el sistema evita superposiciones entre ellos.',
            },
          ].map((f) => (
            <div key={f.titulo} className="text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-marca-50 text-2xl">
                {f.icono}
              </div>
              <h3 className="mt-4 font-semibold text-slate-900">{f.titulo}</h3>
              <p className="mt-2 text-sm text-slate-600">{f.texto}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-slate-200 py-8">
        <p className="text-center text-sm text-slate-500">
          AgendaMed - Sistema multi-tenant de agenda medica
        </p>
      </footer>
    </div>
  );
}
