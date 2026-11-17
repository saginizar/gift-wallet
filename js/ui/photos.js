// Card photos: thumbnails, full-screen viewer, and the add-photo flow (which also looks
// for a barcode in the picture where the browser can detect one).

import { html, useEffect, useState } from '../vendor/preact-htm.js';
import { ctx, openOverlay, toast, toastError } from './core.js';
import { Icon, confirmDialog } from './components.js';
import { compressImage, detectInImage } from '../lib/image.js';
import { pickFile } from '../lib/platform.js';

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

// Picks a photo, stores it on the card and offers a detected barcode as the card code.
export async function addPhotoFlow(cardId) {
  const file = await pickFile('image/*');
  if (!file) return;
  try {
    const img = await compressImage(file);
    await ctx.store.addPhoto(cardId, img.bytes, img.mime);
    toast('התמונה נשמרה');
    const card = ctx.store.view(cardId)?.card;
    if (card && !card.code) {
      const found = await detectInImage(img.bytes);
      if (found && await confirmDialog({ title: 'מצאנו ברקוד בתמונה', text: `לשמור את ${found.value} כקוד של הכרטיס?`, confirmLabel: 'שמירה' })) {
        await ctx.store.updateCard(cardId, { code: found.value, barcode: found.value, barcodeType: found.format === 'qr_code' ? 'qr' : 'code128' });
      }
    }
  } catch (e) {
    toastError(e);
  }
}
