/**
 * Full-screen camera QR scanner for the master's «Веб-доступ» code. Needed on iPhone: an icon
 * added to the home screen has its own storage, so it cannot see a connection made in Safari.
 * The decoder (jsQR) is loaded only when the scanner opens.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Connection } from '../ns/client';
import { parseConnectLink } from '../state/session';

export function QrScanner({ onResult, onClose }: { onResult: (c: Connection) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [message, setMessage] = useState('Наведите камеру на QR-код на телефоне-мастере');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera api');
        const [{ default: jsQR }, media] = await Promise.all([
          import('jsqr'),
          navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }),
        ]);
        stream = media;
        if (stopped || !video.current) return;
        video.current.srcObject = media;
        await video.current.play();

        const tick = () => {
          if (stopped) return;
          const v = video.current;
          if (v && ctx && v.videoWidth > 0) {
            // decode a downscaled frame: fast enough on old phones, plenty for a QR on a screen
            const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
            canvas.width = Math.round(v.videoWidth * scale);
            canvas.height = Math.round(v.videoHeight * scale);
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
            if (code?.data) {
              const c = parseConnectLink(code.data);
              if (c) {
                stopped = true;
                onResult(c);
                return;
              }
              setMessage('Это другой QR-код. Нужен код из «Ещё → Веб-доступ» на мастере');
            }
          }
          timer = window.setTimeout(tick, 180);
        };
        tick();
      } catch {
        if (stopped) return;
        setFailed(true);
        setMessage('Нет доступа к камере. Разрешите камеру для этого сайта или вставьте ссылку вручную.');
      }
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onResult]);

  return (
    <div class="scanner" role="dialog" aria-label="Сканирование QR-кода">
      {!failed && <video ref={video} class="scanner-video" playsInline muted />}
      {!failed && <div class="scanner-frame" />}
      <div class="scanner-bar">
        <div class="scanner-text">{message}</div>
        <button class="btn btn-ghost" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  );
}
