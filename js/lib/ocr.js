// On-device text recognition for receipts, SMS screenshots and emails, using the
// vendored Tesseract.js (Apache-2.0). Nothing leaves the phone: the engine, the Hebrew
// and English models and the image all stay local. The engine (~5 MB) is downloaded the
// first time someone scans, then cached for offline use.
//
// Two passes, because the Hebrew model tends to swallow numbers inside Hebrew lines
// ("189.90" read as "0"):
//   1. the whole image with English+Hebrew, keeping each word's position;
//   2. every word that has digits is read again on its own with a digits-only English model.
// Lines are then rebuilt in reading order from the word positions (see orderLine).

import { orderLine } from './ocr-text.js';

const BASE = new URL('../../', import.meta.url).href;
const OCR_DIR = `${BASE}ocr/`;

let pending = null;

function hasSimd() {
  // Same probe as wasm-feature-detect: a module using a v128 instruction.
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch {
    return false;
  }
}

export const ocrSupported = () => typeof WebAssembly === 'object' && typeof Worker === 'function';

// Starts (once) and returns the two Tesseract workers. `onProgress(0..1, label)` reports
// the first-time download.
export function loadOcr(onProgress = () => {}) {
  if (pending) return pending;
  pending = (async () => {
    const { default: Tesseract } = await import('../vendor/tesseract/tesseract.esm.min.js');
    const corePath = `${OCR_DIR}${hasSimd() ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js'}`;
    const common = {
      workerPath: `${BASE}js/vendor/tesseract/worker.min.js`,
      corePath,
      langPath: OCR_DIR.replace(/\/$/, ''),
      gzip: true,
      cacheMethod: 'write',
      workerBlobURL: false,
    };
    let stage = 0;
    const logger = (m) => {
      if (m.status === 'loading tesseract core') onProgress(0.05 + 0.35 * (m.progress || 0), 'מוריד את מנוע זיהוי הטקסט');
      else if (m.status === 'loading language traineddata') onProgress(0.4 + 0.5 * (m.progress || 0), 'מוריד עברית ואנגלית');
      else if (m.status === 'initializing api') onProgress(0.92 + 0.08 * (m.progress || 0) * (++stage > 1 ? 1 : 0.5), 'מכין');
    };
    onProgress(0.02, 'מכין את זיהוי הטקסט');
    const main = await Tesseract.createWorker(['eng', 'heb'], 1, { ...common, logger });
    // Single column of text of variable size: suits receipts, messages and emails.
    // debug_file keeps the engine's notes ("Estimating resolution as ...") out of the console.
    await main.setParameters({ tessedit_pageseg_mode: '4', preserve_interword_spaces: '0', debug_file: '/dev/null' });
    const digits = await Tesseract.createWorker(['eng'], 1, { ...common, logger });
    await digits.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789.,/-:₪$€', debug_file: '/dev/null' });
    onProgress(1, '');
    return { main, digits };
  })();
  pending.catch(() => { pending = null; });
  return pending;
}

// Direction marks (LRM, RLM, embeddings, isolates) that Tesseract adds around words.
const BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const strip = (s) => String(s || '').replace(BIDI, '');
const HEB = /[\u05d0-\u05ea]/;

// Prepares a photo for OCR: limits the size (speed on phones) and upscales small
// screenshots, since Tesseract reads best with text around 30px tall.
async function prepare(blob) {
  const bitmap = await createImageBitmap(blob);
  const longEdge = Math.max(bitmap.width, bitmap.height);
  const scale = longEdge > 2400 ? 2400 / longEdge : longEdge < 1000 ? Math.min(2, 1400 / longEdge) : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas;
}

function lines(data) {
  const out = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) out.push(l);
  return out;
}

// Re-reads number-like words with the digits-only model; returns how many were fixed.
async function rereadNumbers(digits, canvas, allLines) {
  let fixed = 0;
  for (const line of allLines) {
    for (const w of line.words) {
      const t = strip(w.text);
      // Words read as Hebrew are trusted ("סניף" must not turn into "920"), as are links.
      if (!/\d/.test(t) || HEB.test(t) || (/^https?:|@|\./i.test(t) && /[a-z]{2}/i.test(t))) continue;
      const pad = Math.round((w.bbox.y1 - w.bbox.y0) * 0.3) + 4;
      const rectangle = {
        left: Math.max(0, w.bbox.x0 - pad),
        top: Math.max(0, w.bbox.y0 - pad),
        width: Math.min(canvas.width, w.bbox.x1 + pad) - Math.max(0, w.bbox.x0 - pad),
        height: Math.min(canvas.height, w.bbox.y1 + pad) - Math.max(0, w.bbox.y0 - pad),
      };
      const { data } = await digits.recognize(canvas, { rectangle });
      const r = strip(data.text).trim().replace(/\s+/g, '');
      const moreDigits = r.replace(/\D/g, '').length >= t.replace(/\D/g, '').length;
      if (r && r !== t && moreDigits && data.confidence >= w.confidence - 5 && /\d/.test(r)) {
        w.text = r;
        fixed++;
      }
    }
  }
  return fixed;
}

// Recognises a photo or screenshot. Returns { text, confidence, ms }.
export async function recognizeImage(blob, onProgress = () => {}) {
  const t0 = performance.now();
  const { main, digits } = await loadOcr(onProgress);
  onProgress(1, 'קורא את הטקסט');
  const canvas = await prepare(blob);
  const { data } = await main.recognize(canvas, {}, { text: true, blocks: true });
  const all = lines(data);
  await rereadNumbers(digits, canvas, all);
  const text = all.map((l) => orderLine(l.words.map((w) => ({ text: strip(w.text), x0: w.bbox.x0, x1: w.bbox.x1 })))).filter(Boolean).join('\n');
  return { text, confidence: Math.round(data.confidence || 0), ms: Math.round(performance.now() - t0) };
}
