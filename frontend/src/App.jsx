/**
 * App.jsx
 * Mapa de rutas de la aplicacion.
 *
 * Estructura:
 *   /                      -> landing publica
 *   /login, /registro      -> autenticacion
 *   /admin/*               -> Administrador General
 *   /medico/*              -> panel del profesional (tenant)
 *   /paciente/*            -> panel del paciente
 *
 * Cada bloque privado pasa por <RutaProtegida roles={[...]}> y comparte el
 * marco visual de <LayoutPanel>, que recibe sus items de navegacion.
 */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import RutaProtegida from './components/RutaProtegida';
import LayoutPanel from './layouts/LayoutPanel';

import Home from './pages/Home';
import Login from './pages/auth/Login';
import Registro from './pages/auth/Registro';

import AdminMedicos from './pages/admin/AdminMedicos';
import AdminSuscripciones from './pages/admin/AdminSuscripciones';

import MedicoAgenda from './pages/medico/MedicoAgenda';
import MedicoAgendaDiaria from './pages/medico/MedicoAgendaDiaria';
import MedicoEnlace from './pages/medico/MedicoEnlace';
import MedicoHorarios from './pages/medico/MedicoHorarios';
import MedicoConsultorios from './pages/medico/MedicoConsultorios';
import MedicoCobros from './pages/medico/MedicoCobros';
import MedicoPerfil from './pages/medico/MedicoPerfil';
import MedicoSuscripcion from './pages/medico/MedicoSuscripcion';

import ReservaPorEnlace from './pages/publico/ReservaPorEnlace';
import TurnoPorCodigo from './pages/publico/TurnoPorCodigo';
import BuscarMedicos from './pages/paciente/BuscarMedicos';
import ReservarTurno from './pages/paciente/ReservarTurno';
import MisTurnos from './pages/paciente/MisTurnos';

const NAV_ADMIN = [
  { to: '/admin', texto: 'Medicos', icono: '👨‍⚕️', end: true },
  { to: '/admin/suscripciones', texto: 'Suscripciones', icono: '🧾' },
];

const NAV_MEDICO = [
  { to: '/medico', texto: 'Agenda del dia', icono: '📆', end: true },
  { to: '/medico/semana', texto: 'Vista semanal', icono: '📅' },
  { to: '/medico/enlace', texto: 'Mi enlace', icono: '🔗' },
  { to: '/medico/horarios', texto: 'Horarios', icono: '⏰' },
  { to: '/medico/consultorios', texto: 'Consultorios', icono: '🏥' },
  { to: '/medico/cobros', texto: 'Cobros online', icono: '💰' },
  { to: '/medico/suscripcion', texto: 'Suscripcion', icono: '💳' },
  { to: '/medico/perfil', texto: 'Mi perfil', icono: '👤' },
];

const NAV_PACIENTE = [
  { to: '/paciente', texto: 'Buscar turno', icono: '🔍', end: true },
  { to: '/paciente/turnos', texto: 'Mis turnos', icono: '📋' },
];

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* ----------------------------- Publico ---------------------- */}
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/registro" element={<Registro />} />
          {/*
            Enlace de agendamiento directo. Ruta PUBLICA y sin layout: el
            paciente entra desde WhatsApp sin tener cuenta.
          */}
          <Route path="/reservar/:hash" element={<ReservaPorEnlace />} />
          {/* Acceso del paciente a su turno con el codigo de la reserva: ver y cancelar. */}
          <Route path="/turno/:codigo" element={<TurnoPorCodigo />} />

          {/* ------------------------------ Admin ----------------------- */}
          <Route element={<RutaProtegida roles={['admin']} />}>
            <Route path="/admin" element={<LayoutPanel titulo="Administracion" items={NAV_ADMIN} />}>
              <Route index element={<AdminMedicos />} />
              <Route path="suscripciones" element={<AdminSuscripciones />} />
            </Route>
          </Route>

          {/* ------------------------------ Medico ---------------------- */}
          <Route element={<RutaProtegida roles={['medico']} />}>
            <Route path="/medico" element={<LayoutPanel titulo="Panel profesional" items={NAV_MEDICO} />}>
              {/* La agenda diaria es la vista principal del profesional. */}
              <Route index element={<MedicoAgendaDiaria />} />
              <Route path="semana" element={<MedicoAgenda />} />
              <Route path="enlace" element={<MedicoEnlace />} />
              <Route path="horarios" element={<MedicoHorarios />} />
              <Route path="consultorios" element={<MedicoConsultorios />} />
              <Route path="cobros" element={<MedicoCobros />} />
              <Route path="suscripcion" element={<MedicoSuscripcion />} />
              <Route path="perfil" element={<MedicoPerfil />} />
            </Route>
          </Route>

          {/* ----------------------------- Paciente --------------------- */}
          <Route element={<RutaProtegida roles={['paciente']} />}>
            <Route path="/paciente" element={<LayoutPanel titulo="Mis turnos" items={NAV_PACIENTE} />}>
              <Route index element={<BuscarMedicos />} />
              <Route path="reservar/:medicoId" element={<ReservarTurno />} />
              <Route path="turnos" element={<MisTurnos />} />
              {/* Retorno del checkout de MercadoPago */}
              <Route path="pago/resultado" element={<MisTurnos />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
