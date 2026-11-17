// "Paste a message" flow: the user pastes an SMS/email about a gift card, we pre-fill the
// add form. Also receives text shared from other apps (Android share target).

import { html, useState, useEffect, useRef } from '../vendor/preact-htm.js';
import { navigate } from './core.js';
import { Icon, Field, openSheet } from './components.js';
import { parseGiftText } from '../lib/parse-text.js';
import { readClipboard } from '../lib/platform.js';
import { formatMoney } from '../lib/money.js';
import { formatDate } from '../lib/dates.js';
import { TYPES } from '../lib/model.js';

// Hand-off to the add form without putting codes into the URL or browser history.
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

function PasteBody({ close }) {
  const [text, setText] = useState('');
  const ref = useRef();
  useEffect(() => {
    const t = setTimeout(() => ref.current?.focus(), 250);
    return () => clearTimeout(t);
  }, []);
  const parsed = parseGiftText(text);
  const found = parsed.found.filter((k) => FOUND_LABELS[k]);

  async function pasteFromClipboard() {
    const clip = await readClipboard();
    if (clip) setText(clip);
    else ref.current?.focus();
  }

  function proceed() {
    setPrefill({ ...parsed, sourceText: text });
    navigate('/add');
  }

  return html`<div class="form">
    <p class="muted">מדביקים כאן הודעת SMS או מייל של גיפט קארד, זיכוי או קופון, ואנחנו נמלא את הפרטים. בסוף בודקים ומאשרים.</p>
    <${Field} label="ההודעה" id="paste-text">
      <textarea id="paste-text" ref=${ref} rows="6" placeholder="למשל: קיבלת גיפט קארד BuyMe בשווי 200 ₪ ..." value=${text} onInput=${(e) => setText(e.currentTarget.value)}></textarea>
    </${Field}>
    ${!text && html`<button type="button" class="btn outline block" onClick=${pasteFromClipboard}><${Icon} name="clipboard-paste" />הדבקה מהלוח</button>`}
    ${text && html`<div class="panel" style=${{ marginBottom: 0 }}>
      <h3>${found.length ? 'זיהינו' : 'לא זיהינו פרטים, אפשר להמשיך ולמלא ידנית'}</h3>
      ${found.map((k) => html`<div class="prow"><${Icon} name="check" /><span class="v">${FOUND_LABELS[k](parsed)}</span></div>`)}
    </div>`}
    <button type="button" class="btn primary block" disabled=${!text.trim()} onClick=${proceed}>המשך למילוי הפרטים<${Icon} name="chevron-left" /></button>
  </div>`;
}

export function openPasteSheet() {
  return openSheet('הדבקת הודעה', PasteBody);
}

// Android share target: the manifest sends shared text to ./?title=&text=&url=
export function consumeShareTarget() {
  const params = new URLSearchParams(location.search);
  if (!['title', 'text', 'url'].some((k) => params.has(k))) return false;
  const text = [params.get('title'), params.get('text'), params.get('url')].filter(Boolean).join('\n');
  history.replaceState(null, '', location.pathname + '#/add');
  if (text.trim()) setPrefill({ ...parseGiftText(text), sourceText: text });
  return true;
}
