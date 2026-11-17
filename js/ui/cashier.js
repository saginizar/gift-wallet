// "At the register" view: a white full-screen page with the barcode (or QR), the code in
// large digits, the PIN on demand and the photo of the slip. Keeps the screen awake.

import { html, useEffect, useState } from '../vendor/preact-htm.js';
import { openOverlay, ctx } from './core.js';
import { Icon } from './components.js';
import { code128Svg, canEncode, barcodeValue } from '../lib/code128.js';
import { qrSvg } from '../lib/qr.js';
import { formatMoney } from '../lib/money.js';
import { keepScreenOn } from '../lib/platform.js';
import { usePhotoUrl } from './photos.js';
import { openTxSheet } from './tx-sheet.js';
import { safeLink } from '../lib/model.js';

export function barcodeSource(card) {
  return barcodeValue(card.barcode || card.code || '');
}

// Which renderings make sense for this card, in order of preference.
export function barcodeModes(card) {
  const value = barcodeSource(card);
  const modes = [];
  const preferred = card.barcodeType;
  if (value && canEncode(value)) modes.push('code128');
  if (value) modes.push('qr');
  if (preferred === 'qr') modes.sort((a) => (a === 'qr' ? -1 : 1));
  if (card.photos?.length) modes.push('photo');
  return modes;
}

export function BarcodeArt({ card, mode }) {
  const value = barcodeSource(card);
  if (mode === 'code128') return html`<div class="barcode" dangerouslySetInnerHTML=${{ __html: code128Svg(value, { height: 100 }) }}></div>`;
  if (mode === 'qr') return html`<div class="barcode qr" dangerouslySetInnerHTML=${{ __html: qrSvg(value, { ecc: 'M', margin: 3 }) }}></div>`;
  return null;
}

function Photo({ id }) {
  const { url, missing } = usePhotoUrl(id);
  if (url) return html`<img class="photo" src=${url} alt="תמונת השובר" />`;
  return html`<div class="hint">${missing ? 'התמונה עוד לא סונכרנה למכשיר הזה' : 'טוען תמונה…'}</div>`;
}

const MODE_LABELS = { code128: 'ברקוד', qr: 'QR', photo: 'תמונה' };

function Cashier({ cardId, close }) {
  const view = ctx.store.view(cardId);
  const card = { ...view.card, link: safeLink(view.card.link) };
  const modes = barcodeModes(card);
  const initial = card.barcodeType === 'none' && card.photos?.length ? 'photo' : modes[0];
  const [mode, setMode] = useState(initial);
  const [pinShown, setPinShown] = useState(false);
  const [photoIdx, setPhotoIdx] = useState(0);

  useEffect(() => {
    let release = () => {};
    keepScreenOn().then((r) => { release = r; });
    return () => release();
  }, []);

  return html`<div class="cashier" role="dialog" aria-modal="true" aria-label="הצגה בקופה">
    <div class="top">
      <div class="store">${card.store}</div>
      <button class="icon-btn" aria-label="סגירה" onClick=${() => close()}><${Icon} name="x" /></button>
    </div>
    <div class="body">
      ${view.balance != null && html`<div class="bal">יתרה<b class="num">${formatMoney(view.balance, card.currency)}</b></div>`}
      ${modes.length > 1 && html`<div class="segmented inline" style=${{ '--n': modes.length, background: '#f1f1f4' }}>
        ${modes.map((m) => html`<button type="button" class=${mode === m ? 'active' : ''} style=${mode === m ? { background: '#fff', color: '#5b45e0' } : { color: '#555' }} onClick=${() => setMode(m)}>${MODE_LABELS[m]}</button>`)}
      </div>`}
      ${mode === 'photo' ? html`<div>
          <${Photo} id=${card.photos[photoIdx % card.photos.length]} />
          ${card.photos.length > 1 && html`<button class="btn sm" style=${{ marginTop: '10px' }} onClick=${() => setPhotoIdx(photoIdx + 1)}>התמונה הבאה</button>`}
        </div>`
        : mode && html`<${BarcodeArt} card=${card} mode=${mode} />`}
      ${card.code && html`<div class="code ltr mono">${card.code}</div>`}
      ${card.pin && html`<div class="pin">קוד סודי: ${pinShown ? html`<b class="ltr mono">${card.pin}</b>` : html`<button onClick=${() => setPinShown(true)}>הצגה</button>`}</div>`}
      ${!card.code && !modes.length && html`<div class="hint">לכרטיס הזה אין קוד או תמונה. אפשר להוסיף אותם בעריכה.</div>`}
      <div class="hint">כדאי להגביר את בהירות המסך לסריקה</div>
    </div>
    <div class="btn-row">
      ${card.link && html`<a class="btn" href=${card.link} target="_blank" rel="noopener noreferrer"><${Icon} name="external-link" />השובר המקורי</a>`}
      ${view.balance != null && view.balance > 0 && html`<button class="btn primary" onClick=${async () => { await close(); openTxSheet(ctx.store.view(cardId), 'use'); }}>
        <${Icon} name="shopping-bag" />רישום מימוש
      </button>`}
    </div>
  </div>`;
}

export function openCashier(cardId) {
  return openOverlay((close) => html`<${Cashier} cardId=${cardId} close=${close} />`, { kind: 'full' });
}
