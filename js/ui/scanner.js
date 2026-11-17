// Live barcode/QR scanner (where the browser has BarcodeDetector, i.e. Android Chrome).

import { html, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { Banner, openSheet } from './components.js';
import { createDetector } from '../lib/image.js';
import { vibrate } from '../lib/platform.js';

function ScannerBody({ close }) {
  const video = useRef();
  const [error, setError] = useState('');
  useEffect(() => {
    let stream = null;
    let timer = null;
    let stopped = false;
    (async () => {
      try {
        const detector = await createDetector();
        if (!detector) throw new Error('no detector');
        const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stopped) {
          // The sheet was closed while the permission prompt was open.
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = media;
        video.current.srcObject = stream;
        await video.current.play();
        const tick = async () => {
          if (stopped) return;
          try {
            const found = await detector.detect(video.current);
            if (found.length) {
              vibrate(30);
              close({ value: found[0].rawValue, format: found[0].format });
              return;
            }
          } catch { /* frame not ready yet */ }
          timer = setTimeout(tick, 200);
        };
        tick();
      } catch {
        setError('אין גישה למצלמה. אפשר להקליד את הקוד ידנית.');
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  return html`<div class="scanner stack">
    <video ref=${video} playsinline muted></video>
    ${error ? html`<${Banner} tone="warn" icon="camera">${error}</${Banner}>` : html`<p class="muted center">מכוונים את המצלמה לברקוד או לקוד ה-QR</p>`}
  </div>`;
}

export function openScanner() {
  return openSheet('סריקת ברקוד', ScannerBody);
}
