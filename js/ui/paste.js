// "Fill from a message" flow: the user scans a photo or screenshot (receipt, credit note,
// SMS, email) or pastes the text, and we pre-fill the add form. The scanned image is kept
// and attached to the new card. Also receives text shared from other apps (Android).

import { html, useState, useEffect, useRef } from '../vendor/preact-htm.js';
import { navigate, toastError } from './core.js';
import { Icon, Field, Banner, openSheet } from './components.js';
import { parseGiftText } from '../lib/parse-text.js';
import { readClipboard, pickFile, canUseCamera } from '../lib/platform.js';
import { formatMoney } from '../lib/money.js';
import { formatDate } from '../lib/dates.js';
import { TYPES } from '../lib/model.js';
import { compressImage } from '../lib/image.js';
import { ocrSupported, recognizeImage } from '../lib/ocr.js';
import { PhotoSourceButtons } from './photos.js';

// Hand-off to the add form without putting codes into the URL or browser history. The
// form takes it when it opens; it is never kept for a later form.
let pending = null;
export function setPrefill(data) { pending = data; }
export function takePrefill() {
  const p = pending;
  pending = null;
  return p;
}

const FOUND_LABELS = {
  store: (r) => `חנות: ${r.store}`,
  type: (r) => `סוג: ${TYPES[r.type]?.label}`,
  initialAmount: (r) => `סכום: ${formatMoney(r.initialAmount, r.currency)}`,
  expiry: (r) => `תוקף: ${formatDate(r.expiry)}`,
  code: (r) => `קוד: ${r.code}`,
  pin: () => 'קוד סודי',
  link: () => 'קישור לשובר',
  discount: (r) => `הטבה: ${r.discount}`,
};

function ScanProgress({ progress, label, preview }) {
  return html`<div class="scan-progress" role="status" aria-live="polite">
    ${preview && html`<img src=${preview} alt="" />`}
    <div class="bar"><span style=${{ width: `${Math.round(progress * 100)}%` }}></span></div>
    <div class="muted small">${label || 'קורא את הטקסט…'}</div>
  </div>`;
}

function PasteBody({ close, startWithScan = false }) {
  const [text, setText] = useState('');
  const [scan, setScan] = useState(null); // { preview, image, progress, label, done, error, ms }
  const ref = useRef();
  const started = useRef(false);

  useEffect(() => {
    // On a phone the user picks camera or gallery in the sheet; a computer has only the
    // file dialog, so it opens straight away.
    if (startWithScan && !canUseCamera() && !started.current) {
      started.current = true;
      scanImage(false);
    } else if (!startWithScan) {
      const t = setTimeout(() => ref.current?.focus(), 250);
      return () => clearTimeout(t);
    }
    return undefined;
  }, []);
  useEffect(() => () => scan?.preview && URL.revokeObjectURL(scan.preview), [scan?.preview]);

  const parsed = parseGiftText(text);
  const found = parsed.found.filter((k) => FOUND_LABELS[k]);

  async function pasteFromClipboard() {
    const clip = await readClipboard();
    if (clip) setText(clip);
    else ref.current?.focus();
  }

  async function scanImage(camera) {
    const file = await pickFile('image/*', { camera });
    if (!file) return;
    const preview = URL.createObjectURL(file);
    setScan({ preview, progress: 0, label: 'מכין' });
    try {
      // The compressed copy is what gets attached to the card; OCR reads the original.
      const [image, result] = await Promise.all([
        compressImage(file),
        recognizeImage(file, (progress, label) => setScan((s) => (s && !s.done ? { ...s, progress, label } : s))),
      ]);
      setText(result.text);
      setScan((s) => ({ ...s, image, done: true, progress: 1, ms: result.ms, confidence: result.confidence }));
    } catch (e) {
      setScan((s) => ({ ...s, done: true, error: true }));
      toastError(e);
    }
  }

  function proceed() {
    setPrefill({ ...parsed, sourceText: text, photo: scan?.image || null });
    navigate('/add');
  }

  const scanning = scan && !scan.done;
  return html`<div class="form">
    ${!scan && html`<p class="muted">מצלמים קבלה או תעודת זיכוי, מעלים צילום מסך של SMS או מייל, או מדביקים את הטקסט. אנחנו נמלא את הפרטים, ובסוף בודקים ומאשרים.</p>`}
    ${ocrSupported() && !scanning && html`<${PhotoSourceButtons} onPick=${scanImage} primary=${!scan} />`}
    ${scanning && html`<${ScanProgress} ...${scan} />`}
    ${scan?.done && !scan.error && html`<${Banner} icon="sparkles" title="קראנו את הטקסט מהתמונה">
      התמונה תישמר בכרטיס. אפשר לתקן את הטקסט למטה אם משהו נקרא לא נכון.
    </${Banner}>`}
    ${scan?.error && html`<${Banner} tone="warn" icon="alert">לא הצלחנו לקרוא את התמונה. אפשר להדביק את הטקסט או למלא ידנית.</${Banner}>`}
    ${!scanning && html`<${Field} label=${scan?.done ? 'הטקסט שזוהה' : 'או הדבקת הטקסט'} id="paste-text">
      <textarea id="paste-text" ref=${ref} rows=${scan?.done ? 8 : 5} placeholder="למשל: קיבלת גיפט קארד BuyMe בשווי 200 ₪ ..." value=${text} onInput=${(e) => setText(e.currentTarget.value)}></textarea>
    </${Field}>`}
    ${!text && !scan && html`<button type="button" class="btn outline block" onClick=${pasteFromClipboard}><${Icon} name="clipboard-paste" />הדבקה מהלוח</button>`}
    ${text && !scanning && html`<div class="panel" style=${{ marginBottom: 0 }}>
      <h3>${found.length ? 'זיהינו' : 'לא זיהינו פרטים, אפשר להמשיך ולמלא ידנית'}</h3>
      ${found.map((k) => html`<div class="prow"><${Icon} name="check" /><span class="v">${FOUND_LABELS[k](parsed)}</span></div>`)}
    </div>`}
    ${!scanning && html`<button type="button" class="btn primary block" disabled=${!text.trim() && !scan?.image} onClick=${proceed}>המשך למילוי הפרטים<${Icon} name="chevron-left" /></button>`}
  </div>`;
}

export function openPasteSheet(opts = {}) {
  return openSheet(opts.startWithScan ? 'סריקת קבלה או הודעה' : 'מילוי מתוך הודעה', PasteBody, opts);
}

export const openScanSheet = () => openPasteSheet({ startWithScan: true });

// Android share target: the manifest sends shared text to ./?title=&text=&url=
export function consumeShareTarget() {
  const params = new URLSearchParams(location.search);
  if (!['title', 'text', 'url'].some((k) => params.has(k))) return false;
  const text = [params.get('title'), params.get('text'), params.get('url')].filter(Boolean).join('\n');
  history.replaceState(null, '', location.pathname + '#/add');
  if (text.trim()) setPrefill({ ...parseGiftText(text), sourceText: text });
  return true;
}
