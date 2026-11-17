// Card photos: thumbnails, full-screen viewer, and the add-photo flow (which also looks
// for a barcode in the picture where the browser can detect one).

import { html, useEffect, useState } from '../vendor/preact-htm.js';
import { ctx, openOverlay, toast, toastError } from './core.js';
import { Icon, confirmDialog, openSheet } from './components.js';
import { compressImage, detectInImage } from '../lib/image.js';
import { pickFile, canUseCamera, isIOS } from '../lib/platform.js';
import { ocrSupported, recognizeImage } from '../lib/ocr.js';
import { parseGiftText } from '../lib/parse-text.js';
import { formatMoney } from '../lib/money.js';
import { formatDate } from '../lib/dates.js';

export function usePhotoUrl(id) {
  const [state, setState] = useState({ url: null, missing: false });
  useEffect(() => {
    let url = null;
    let alive = true;
    ctx.sync.fetchPhoto(id).then((img) => {
      if (!alive) return;
      if (!img) return setState({ url: null, missing: true });
      url = URL.createObjectURL(new Blob([img.bytes], { type: img.mime || 'image/jpeg' }));
      setState({ url, missing: false });
    });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);
  return state;
}

export function PhotoThumb({ id, onClick }) {
  const { url, missing } = usePhotoUrl(id);
  return html`<button class="photo-thumb" onClick=${onClick} aria-label="הצגת תמונה">
    ${url ? html`<img src=${url} alt="" />` : html`<${Icon} name=${missing ? 'cloud-off' : 'image'} />`}
  </button>`;
}

function Viewer({ id, close, onDelete }) {
  const { url, missing } = usePhotoUrl(id);
  return html`<div class="viewer" role="dialog" aria-modal="true" aria-label="תמונה">
    <div class="bar">
      <button class="icon-btn" aria-label="סגירה" onClick=${() => close()}><${Icon} name="x" /></button>
      ${onDelete && html`<button class="icon-btn" aria-label="מחיקת התמונה" onClick=${() => close('delete')}><${Icon} name="trash" /></button>`}
    </div>
    ${url ? html`<img src=${url} alt="תמונת הכרטיס" />`
      : html`<div class="center" style=${{ color: '#fff', margin: 'auto' }}>${missing ? 'התמונה עוד לא סונכרנה למכשיר הזה' : 'טוען…'}</div>`}
  </div>`;
}

export async function openPhotoViewer(cardId, photoId, { canDelete = true } = {}) {
  const res = await openOverlay((close) => html`<${Viewer} id=${photoId} close=${close} onDelete=${canDelete} />`, { kind: 'full' });
  if (res === 'delete' && await confirmDialog({ title: 'למחוק את התמונה?', confirmLabel: 'מחיקה', danger: true })) {
    await ctx.store.removePhoto(cardId, photoId).catch(toastError);
    toast('התמונה נמחקה');
  }
}

// "Take a photo" / "from the gallery". On a computer there is only the file dialog.
export function PhotoSourceButtons({ onPick, primary = true }) {
  const main = `btn ${primary ? 'primary' : 'outline'}`;
  if (!canUseCamera()) {
    return html`<button type="button" class=${`${main} block`} onClick=${() => onPick(false)}><${Icon} name="image" />בחירת תמונה</button>`;
  }
  return html`<div class="btn-row">
    <button type="button" class=${main} onClick=${() => onPick(true)}><${Icon} name="camera" />צילום</button>
    <button type="button" class="btn outline" onClick=${() => onPick(false)}><${Icon} name="image" />מהגלריה</button>
  </div>`;
}

function PhotoSourceBody({ close }) {
  // The picker opens inside the tap (iOS requires that); the sheet closes once a photo is
  // chosen, and stays open if the camera or gallery was cancelled.
  const pick = (camera) => pickFile('image/*', { camera }).then((file) => file && close(file));
  return html`<div class="form"><${PhotoSourceButtons} onPick=${pick} /></div>`;
}

// Android's picker for images shows only the gallery, so phones get an explicit choice.
// iOS's own menu already offers the camera, and a computer has only files.
export async function pickPhoto() {
  if (!canUseCamera() || isIOS()) return pickFile('image/*');
  return (await openSheet('הוספת תמונה', PhotoSourceBody)) || null;
}

const FILL_LABELS = {
  initialAmount: 'סכום', expiry: 'תוקף', code: 'קוד', pin: 'קוד סודי', link: 'קישור', discount: 'הטבה',
};

// Details read from the photo that the card does not have yet. Existing values are never
// overwritten: the user typed them, or already confirmed them.
function missingDetails(card, parsed) {
  const patch = {};
  if (parsed.initialAmount != null && card.initialAmount == null) {
    patch.initialAmount = parsed.initialAmount;
    if (parsed.currency) patch.currency = parsed.currency;
  }
  for (const f of ['expiry', 'code', 'pin', 'link', 'discount']) if (parsed[f] && !card[f]) patch[f] = parsed[f];
  return patch;
}

// Picks a photo, stores it on the card, then reads it: a detected barcode, or text with
// details the card is missing, is offered to the user before anything is changed.
export async function addPhotoFlow(cardId) {
  const file = await pickPhoto();
  if (!file) return;
  try {
    const img = await compressImage(file);
    await ctx.store.addPhoto(cardId, img.bytes, img.mime);
    toast('התמונה נשמרה');
    const card = ctx.store.view(cardId)?.card;
    if (!card) return;
    if (!card.code) {
      const found = await detectInImage(img.bytes);
      if (found && await confirmDialog({ title: 'מצאנו ברקוד בתמונה', text: `לשמור את ${found.value} כקוד של הכרטיס?`, confirmLabel: 'שמירה' })) {
        await ctx.store.updateCard(cardId, { code: found.value, barcode: found.value, barcodeType: found.format === 'qr_code' ? 'qr' : 'code128' });
      }
    }
    if (!ocrSupported()) return;
    const { text } = await recognizeImage(file);
    const current = ctx.store.view(cardId)?.card;
    if (!current) return;
    const patch = missingDetails(current, parseGiftText(text));
    const keys = Object.keys(patch).filter((k) => FILL_LABELS[k]);
    if (!keys.length) return;
    const summary = keys.map((k) => `${FILL_LABELS[k]}: ${k === 'initialAmount' ? formatMoney(patch[k], patch.currency || current.currency) : k === 'expiry' ? formatDate(patch[k]) : k === 'pin' ? '••••' : patch[k]}`).join('\n');
    if (await confirmDialog({ title: 'קראנו פרטים מהתמונה', text: `להוסיף לכרטיס?\n${summary}`, confirmLabel: 'הוספה' })) {
      await ctx.store.updateCard(cardId, patch);
      toast('הפרטים נוספו לכרטיס');
    }
  } catch (e) {
    toastError(e);
  }
}
