/**
 * components/TarjetaQR.jsx
 * Tarjeta imprimible con el codigo QR del enlace de agendamiento.
 *
 * ==========================================================================
 * Para que sirve
 * ==========================================================================
 * El profesional la imprime y la deja en el mostrador o la pega en la puerta
 * del consultorio: el paciente escanea con la camara del telefono y entra
 * directo a reservar. Tambien se puede descargar como imagen para mandarla
 * por WhatsApp o subirla a redes.
 *
 * ==========================================================================
 * El QR viene de la BASE DE DATOS
 * ==========================================================================
 * Se genera y se guarda en el servidor al crear el enlace, y el backend
 * verifica en cada consulta que codifique la misma direccion del enlace
 * vigente (`qrVerificado`), regenerandolo solo si dejaron de coincidir.
 *
 * Mostrar el guardado y no uno nuevo calculado aca importa: el profesional
 * puede tener carteles impresos, y lo que se ve en pantalla tiene que ser
 * exactamente el codigo que se emitio.
 *
 * Si el servidor todavia no lo tiene —una base sin migrar, por ejemplo— se
 * genera localmente como respaldo, para que la pantalla no quede rota.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Aviso } from './UI';
import { nombreConTratamiento } from '../utils/tratamiento';

/** Lado del QR en pixeles. Debe coincidir con backend/src/services/qrEnlace.js */
const TAMANO_QR = 720;

export default function TarjetaQR({
  url, profesional, compartible = true, qrGuardado = null, qrVerificado = true,
}) {
  const [imagenQR, setImagenQR] = useState(qrGuardado);
  const [generando, setGenerando] = useState(!qrGuardado);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const tarjetaRef = useRef(null);

  useEffect(() => {
    let cancelado = false;

    // El QR del servidor es el que vale: no se regenera nada.
    if (qrGuardado) {
      setImagenQR(qrGuardado);
      setGenerando(false);
      return undefined;
    }

    (async () => {
      setGenerando(true);
      try {
        // Respaldo local. Import dinamico: la libreria no entra en el bundle
        // principal.
        const QRCode = (await import('qrcode')).default;

        const dataUrl = await QRCode.toDataURL(url, {
          width: TAMANO_QR,
          margin: 2,
          // Correccion de errores ALTA: el QR sigue siendo legible aunque el
          // papel se manche, se arrugue o quede parcialmente tapado.
          errorCorrectionLevel: 'H',
          color: { dark: '#0f172a', light: '#ffffff' },
        });

        if (!cancelado) { setImagenQR(dataUrl); setError(null); }
      } catch (err) {
        if (!cancelado) setError(`No se pudo generar el codigo QR: ${err.message}`);
      } finally {
        if (!cancelado) setGenerando(false);
      }
    })();

    return () => { cancelado = true; };
  }, [url, qrGuardado]);

  const imprimir = () => window.print();

  /** Descarga el QR solo, como PNG. */
  const descargar = useCallback(() => {
    if (!imagenQR) return;
    const a = document.createElement('a');
    a.href = imagenQR;
    a.download = `turnos-${profesional.apellido.toLowerCase()}-qr.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setAviso('Imagen descargada.');
  }, [imagenQR, profesional]);

  /**
   * Compartir nativo (celulares y algunos navegadores de escritorio).
   * Se intenta mandar la imagen; si el dispositivo no admite archivos, se
   * comparte el enlace como texto.
   */
  const compartir = async () => {
    // Lo que se manda al compartir: nombre y especialidad, nada mas.
    const texto = `Reserva tu turno con ${nombreConTratamiento(profesional, { natural: true })} - ${profesional.especialidad}`;

    try {
      if (imagenQR && navigator.canShare) {
        const blob = await (await fetch(imagenQR)).blob();
        const archivo = new File([blob], 'codigo-qr.png', { type: 'image/png' });

        if (navigator.canShare({ files: [archivo] })) {
          await navigator.share({ files: [archivo], title: texto, text: texto });
          return;
        }
      }

      if (navigator.share) {
        await navigator.share({ title: texto, text: texto, url });
        return;
      }

      await navigator.clipboard.writeText(`${texto}: ${url}`);
      setAviso('Tu navegador no permite compartir directamente. Se copio el enlace.');
    } catch (err) {
      // El usuario cancelo el dialogo: no es un error que haya que mostrar.
      if (err?.name !== 'AbortError') setAviso(`No se pudo compartir: ${err.message}`);
    }
  };

  return (
    <div className="card space-y-4">
      <div className="no-imprimir">
        <h2 className="text-sm font-semibold text-slate-900">Codigo QR</h2>
        <p className="text-sm text-slate-600">
          Imprimilo para el mostrador o la sala de espera, o compartilo como imagen.
        </p>
      </div>

      {!compartible && (
        <div className="no-imprimir">
          <Aviso tipo="alerta">
            El enlace todavia apunta a una direccion local, asi que este QR no va a funcionar
            fuera de esta computadora. Resolvelo antes de imprimirlo.
          </Aviso>
        </div>
      )}

      {error && <div className="no-imprimir"><Aviso tipo="error">{error}</Aviso></div>}
      {aviso && (
        <div className="no-imprimir">
          <Aviso tipo="exito" onCerrar={() => setAviso(null)}>{aviso}</Aviso>
        </div>
      )}

      {/* ===================== La tarjeta imprimible ===================== */}
      <div ref={tarjetaRef}
        className="area-impresion mx-auto w-full max-w-sm rounded-xl border-2 border-slate-900 bg-white p-6 text-center">

        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          Turnos online
        </p>

        {/*
          Solo nombre y especialidad: "Dr. Luis Gomez / Tocoginecologia".
          La matricula NO se muestra. Esta tarjeta se imprime, se fotografia y
          se manda por WhatsApp, y el paciente no la necesita para nada: lo
          unico que tiene que reconocer es de quien es el turno.
        */}
        <h3 className="mt-2 text-xl font-bold leading-tight text-slate-900">
          {nombreConTratamiento(profesional, { natural: true })}
        </h3>
        <p className="text-sm font-medium text-slate-700">{profesional.especialidad}</p>

        <div className="my-5 flex items-center justify-center">
          {generando ? (
            <div className="flex h-56 w-56 items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-400">
              Generando...
            </div>
          ) : imagenQR ? (
            <img src={imagenQR} alt={`Codigo QR para reservar turno con ${profesional.apellido}`}
              className="h-56 w-56" />
          ) : (
            <div className="flex h-56 w-56 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400">
              Sin codigo
            </div>
          )}
        </div>

        {/* La leyenda que pidio el consultorio. */}
        <p className="text-lg font-bold leading-snug text-slate-900">
          Escaneá el código para sacar tu turno
        </p>

        <p className="mt-3 break-all text-[10px] leading-tight text-slate-400">
          {url}
        </p>
      </div>

      {/* ------------------------- Acciones ---------------------------- */}
      <div className="no-imprimir flex flex-wrap gap-2">
        <button type="button" className="btn-primario" onClick={imprimir} disabled={!imagenQR}>
          🖨 Imprimir
        </button>
        <button type="button" className="btn-secundario" onClick={descargar} disabled={!imagenQR}>
          Descargar imagen
        </button>
        <button type="button" className="btn-secundario" onClick={compartir} disabled={!imagenQR}>
          Compartir
        </button>
      </div>

      <p className="no-imprimir text-xs text-slate-500">
        Al imprimir sale solo la tarjeta, sin el resto de la pantalla. Si cambias o regeneras
        el enlace, volve a imprimirla: el QR anterior deja de funcionar.
      </p>
    </div>
  );
}
