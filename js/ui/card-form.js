// Add / edit form. The short path is type, store, amount, expiry, code; everything else
// sits under "more details".

import { html, useState, useRef } from '../vendor/preact-htm.js';
import { ctx, useStore, navigate, goBack, toast, toastError } from './core.js';
import { Icon, Field, Segmented, TopBar, Banner, Empty } from './components.js';
import { TYPES, TYPE_ORDER, validateCard, knownStores, SHARED_OWNER, LIMITS, CARD_FIELDS, cleanCard } from '../lib/model.js';
import { suggestStores, findStore, PALETTE } from '../lib/catalog.js';
import { parseAmount, amountInputValue, CURRENCIES } from '../lib/money.js';
import { todayISO, addYears, formatDate, isISODate, daysBetween, expiryLabel } from '../lib/dates.js';
import { compressImage, canDetectBarcodes, detectInImage } from '../lib/image.js';
import { readClipboard } from '../lib/platform.js';
import { pickPhoto } from './photos.js';
import { takePrefill } from './paste.js';
import { openScanner } from './scanner.js';

export const TYPE_ICONS = { giftcard: 'gift', credit: 'receipt', voucher: 'ticket', coupon: 'badge-percent' };

const EMPTY = {
  type: 'giftcard', store: '', title: '', initialAmount: '', currency: 'ILS', expiry: '', code: '', pin: '',
  barcode: '', barcodeType: 'none', link: '', usableAt: '', owner: SHARED_OWNER, notes: '', receivedAt: '',
  discount: '', color: null, openingBalance: '',
};

const PREFILL_FIELDS = ['type', 'store', 'currency', 'expiry', 'code', 'pin', 'link', 'discount'];

function initialForm(card, prefill) {
  if (card) {
    return { ...EMPTY, ...card, initialAmount: amountInputValue(card.initialAmount), expiry: card.expiry || '', receivedAt: card.receivedAt || '', openingBalance: '' };
  }
  const form = { ...EMPTY };
  if (prefill) {
    for (const k of PREFILL_FIELDS) if (prefill[k]) form[k] = prefill[k];
    if (prefill.initialAmount != null) form.initialAmount = amountInputValue(prefill.initialAmount);
    // Nothing recognised: keep the original message so no detail is lost.
    if (!prefill.found?.length && prefill.sourceText) form.notes = prefill.sourceText.trim().slice(0, LIMITS.notes);
  }
  if (NUMERIC_CODE.test(form.code)) form.barcodeType = 'code128';
  return form;
}

const EXPIRY_PICKS = [[1, 'שנה'], [2, 'שנתיים'], [3, '3 שנים'], [5, '5 שנים']];
const NUMERIC_CODE = /^\d[\d\s-]{5,}$/;

export function CardForm({ id }) {
  const store = useStore();
  const editing = id ? store.view(id)?.card : null;
  const [prefill] = useState(() => (id ? null : takePrefill()));
  const [form, setForm] = useState(() => initialForm(editing, prefill));
  // What the card looked like when the form opened; an edit saves only what changed
  // since, so a photo or edit synced in from the other phone meanwhile is kept.
  const [original] = useState(() => (editing ? cleanCard(editing) : null));
  const [errors, setErrors] = useState({});
  const [more, setMore] = useState(() => !!(editing && (editing.pin || editing.title || editing.link || editing.usableAt || editing.notes)) || !!prefill?.pin || !!prefill?.link);
  const [partial, setPartial] = useState(false);
  const [typeTouched, setTypeTouched] = useState(!!editing || !!prefill?.type);
  const [barcodeTouched, setBarcodeTouched] = useState(!!editing);
  const [storeFocus, setStoreFocus] = useState(false);
  const [photos, setPhotos] = useState(() => (prefill?.photo
    ? [{ ...prefill.photo, url: URL.createObjectURL(new Blob([prefill.photo.bytes], { type: prefill.photo.mime })) }]
    : []));
  const [busy, setBusy] = useState(false);
  const formRef = useRef();
  const { members, cards } = store.snapshot();

  if (id && !editing) {
    return html`<div><${TopBar} title="עריכה" back=${() => goBack()} /><main class="screen no-tabs"><${Empty} icon="search" title="הכרטיס לא נמצא" /></main></div>`;
  }

  const set = (patch) => {
    setForm((f) => ({ ...f, ...patch }));
    setErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(patch)) delete next[k];
      return next;
    });
  };
  const bind = (key) => ({ value: form[key] ?? '', onInput: (e) => set({ [key]: e.currentTarget.value }) });

  const amountRequired = TYPES[form.type].amountRequired;
  const suggestions = storeFocus || !form.store ? suggestStores(form.store, knownStores(cards), 6).filter((s) => s !== form.store) : [];
  const expiryBase = isISODate(form.receivedAt) ? form.receivedAt : todayISO();

  function chooseStore(name) {
    const entry = findStore(name);
    set({ store: name, ...(!typeTouched && entry?.kind && entry.kind !== 'voucher' ? { type: entry.kind } : {}) });
    setStoreFocus(false);
  }

  async function scanCode() {
    const res = await openScanner();
    if (res?.value) set({ code: res.value, barcode: '', barcodeType: res.format === 'qr_code' ? 'qr' : 'code128' });
  }

  async function pasteCode() {
    const text = await readClipboard();
    if (text) set({ code: text.trim().slice(0, LIMITS.code) });
  }

  async function addPhoto() {
    const file = await pickPhoto();
    if (!file) return;
    try {
      const img = await compressImage(file);
      const url = URL.createObjectURL(new Blob([img.bytes], { type: img.mime }));
      setPhotos((p) => [...p, { ...img, url }]);
      if (!form.code) {
        const found = await detectInImage(img.bytes);
        if (found) {
          set({ code: found.value, barcodeType: found.format === 'qr_code' ? 'qr' : 'code128' });
          toast('מצאנו ברקוד בתמונה ומילאנו את הקוד');
        }
      }
    } catch (e) {
      toastError(e);
    }
  }

  async function save(e) {
    e.preventDefault();
    const data = {
      ...form,
      // A numeric code is almost always printed as a barcode; show it as one unless the
      // user picked otherwise.
      barcodeType: !barcodeTouched && form.barcodeType === 'none' && NUMERIC_CODE.test(form.code.trim()) ? 'code128' : form.barcodeType,
      initialAmount: form.initialAmount === '' ? null : parseAmount(form.initialAmount),
      openingBalance: partial && form.openingBalance !== '' ? parseAmount(form.openingBalance) : null,
    };
    if (form.initialAmount !== '' && data.initialAmount == null) data.initialAmount = NaN;
    const errs = validateCard(data);
    if (Object.keys(errs).length) {
      setErrors(errs);
      if (errs.link || errs.pin) setMore(true);
      setTimeout(() => formRef.current?.querySelector('.invalid input, .invalid select')?.focus(), 0);
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        const next = cleanCard(data);
        const patch = {};
        for (const f of CARD_FIELDS) {
          if (f !== 'photos' && JSON.stringify(next[f]) !== JSON.stringify(original[f])) patch[f] = data[f];
        }
        await store.updateCard(editing.id, patch);
        goBack(`/card/${editing.id}`);
        toast('הפרטים עודכנו');
      } else {
        const card = await store.createCard(data);
        for (const p of photos) await store.addPhoto(card.id, p.bytes, p.mime);
        photos.forEach((p) => URL.revokeObjectURL(p.url));
        navigate(`/card/${card.id}`, { replace: true });
        toast('נוסף לארנק');
      }
    } catch (err) {
      setBusy(false);
      toastError(err);
    }
  }

  const typeOptions = TYPE_ORDER.map((t) => ({ value: t, label: TYPES[t].label, icon: TYPE_ICONS[t] }));
  const prefilled = prefill?.found?.filter((k) => k !== 'found' && k !== 'photo') || [];

  return html`<div>
    <${TopBar} title=${editing ? 'עריכת פרטים' : 'הוספה לארנק'} back=${() => goBack()} />
    <main class="screen no-tabs">
      <form class="form" ref=${formRef} onSubmit=${save} novalidate>
        ${prefill && html`<${Banner} icon="sparkles" title=${prefilled.length ? (prefill.photo ? 'מילאנו מתוך התמונה' : 'מילאנו מתוך ההודעה') : 'לא מצאנו פרטים'}>
          ${prefilled.length ? 'כדאי לעבור על השדות ולוודא שהכול נכון.' : 'אפשר למלא ידנית. הטקסט נשמר בהערות.'}
          ${prefill.photo ? ' התמונה תישמר בכרטיס.' : ''}
        </${Banner}>`}

        <${Segmented} label="סוג" options=${typeOptions} value=${form.type} onChange=${(t) => { setTypeTouched(true); set({ type: t }); }} />

        <${Field} label=${form.type === 'giftcard' ? 'מנפיק או חנות' : 'חנות'} error=${errors.store} id="f-store">
          <input id="f-store" autocomplete="off" maxlength=${LIMITS.store} placeholder=${form.type === 'giftcard' ? 'BuyMe, תו הזהב, שופרסל…' : 'פוקס, זארה, סופר-פארם…'}
            value=${form.store} onInput=${(e) => { set({ store: e.currentTarget.value }); setStoreFocus(true); }}
            onFocus=${() => setStoreFocus(true)} onBlur=${() => setTimeout(() => setStoreFocus(false), 150)} enterkeyhint="next" />
          ${suggestions.length > 0 && html`<div class="suggestions">
            ${suggestions.map((s) => html`<button type="button" onMouseDown=${(e) => e.preventDefault()} onClick=${() => chooseStore(s)}>${s}</button>`)}
          </div>`}
        </${Field}>

        <div class="two-col" style=${{ gridTemplateColumns: '1fr 96px' }}>
          <${Field} label=${amountRequired ? 'סכום' : 'שווי (לא חובה)'} error=${errors.initialAmount} id="f-amount">
            <div class="input-wrap amount-input">
              <input id="f-amount" inputmode="decimal" autocomplete="off" placeholder="0" ...${bind('initialAmount')} />
              <span class="cur">${CURRENCIES[form.currency]?.symbol}</span>
            </div>
          </${Field}>
          <${Field} label="מטבע" id="f-currency">
            <select id="f-currency" value=${form.currency} onChange=${(e) => set({ currency: e.currentTarget.value })}>
              ${Object.entries(CURRENCIES).map(([code, c]) => html`<option value=${code}>${c.symbol} ${c.label}</option>`)}
            </select>
          </${Field}>
        </div>

        ${!editing && form.initialAmount !== '' && html`<div class="stack-sm">
          <label class="check-row"><input type="checkbox" checked=${partial} onChange=${(e) => setPartial(e.currentTarget.checked)} />כבר השתמשנו בחלק מהסכום</label>
          ${partial && html`<${Field} label="היתרה שנשארה" error=${errors.openingBalance} id="f-opening">
            <div class="input-wrap amount-input">
              <input id="f-opening" inputmode="decimal" autocomplete="off" placeholder="0" ...${bind('openingBalance')} />
              <span class="cur">${CURRENCIES[form.currency]?.symbol}</span>
            </div>
          </${Field}>`}
        </div>`}

        ${(form.type === 'coupon' || form.type === 'voucher') && html`<${Field} label=${form.type === 'coupon' ? 'ההטבה' : 'על מה השובר'} hint=${form.type === 'coupon' ? 'למשל: 20% הנחה, 1+1, משלוח חינם' : 'למשל: ארוחת בוקר זוגית'} id="f-discount">
          <input id="f-discount" maxlength=${LIMITS.discount} ...${bind('discount')} />
        </${Field}>`}

        <${Field} label="בתוקף עד" error=${errors.expiry} id="f-expiry"
          hint=${isISODate(form.expiry) ? `${formatDate(form.expiry)} · ${expiryLabel(daysBetween(todayISO(), form.expiry))}` : 'אם אין תאריך תפוגה, משאירים ריק'}>
          <input id="f-expiry" type="date" min="2000-01-01" max="2100-12-31" ...${bind('expiry')} />
          <div class="quick-picks">
            <span class="muted small" style=${{ alignSelf: 'center' }}>בעוד</span>
            ${EXPIRY_PICKS.map(([years, label]) => {
              const value = addYears(expiryBase, years);
              return html`<button type="button" class=${form.expiry === value ? 'active' : ''} onClick=${() => set({ expiry: value })}>${label}</button>`;
            })}
            ${form.expiry && html`<button type="button" onClick=${() => set({ expiry: '' })}>ללא תוקף</button>`}
          </div>
        </${Field}>

        <${Field} label="קוד או מספר כרטיס" hint="מה שמקלידים או סורקים בקופה" id="f-code">
          <div class="input-wrap">
            <input id="f-code" class="ltr" dir="ltr" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength=${LIMITS.code} ...${bind('code')} />
            <div class="adorn">
              ${canDetectBarcodes() && html`<button type="button" class="icon-btn" aria-label="סריקת ברקוד" onClick=${scanCode}><${Icon} name="scan-barcode" /></button>`}
              ${!form.code && html`<button type="button" class="icon-btn" aria-label="הדבקה" onClick=${pasteCode}><${Icon} name="clipboard-paste" /></button>`}
            </div>
          </div>
        </${Field}>

        ${!editing && html`<div class="field">
          <span class="label">תמונה של השובר או הקבלה</span>
          <div class="photos" style=${{ padding: 0 }}>
            ${photos.map((p, i) => html`<button type="button" class="photo-thumb" aria-label="הסרת תמונה" onClick=${() => setPhotos(photos.filter((_, j) => j !== i))}><img src=${p.url} alt="" /></button>`)}
            <button type="button" class="photo-thumb add" aria-label="הוספת תמונה" onClick=${addPhoto}><${Icon} name="camera" /></button>
          </div>
        </div>`}

        <button type="button" class=${`disclosure ${more ? 'open' : ''}`} aria-expanded=${more} onClick=${() => setMore(!more)}>
          <${Icon} name="chevron-down" />פרטים נוספים
        </button>

        ${more && html`<div class="form">
          <${Field} label="כותרת" hint="למשל: מתנה מהעבודה לחג" id="f-title">
            <input id="f-title" maxlength=${LIMITS.title} ...${bind('title')} />
          </${Field}>
          <${Field} label="קוד סודי / PIN" error=${errors.pin} id="f-pin">
            <input id="f-pin" class="ltr" dir="ltr" inputmode="numeric" autocomplete="off" maxlength=${LIMITS.pin} ...${bind('pin')} />
          </${Field}>
          <${Field} label="קישור לשובר" error=${errors.link} hint="הקישור מה-SMS או מהמייל, אם יש" id="f-link">
            <input id="f-link" class="ltr" dir="ltr" type="url" inputmode="url" autocomplete="off" placeholder="https://" ...${bind('link')} />
          </${Field}>
          ${form.type === 'giftcard' && html`<${Field} label="איפה אפשר לממש" hint="לכרטיסים שעובדים בכמה רשתות" id="f-usable">
            <input id="f-usable" maxlength=${LIMITS.usableAt} placeholder="פוקס, קסטרו, אמריקן איגל…" ...${bind('usableAt')} />
          </${Field}>`}
          <${Field} label="הצגה בקופה" id="f-bctype">
            <${Segmented} inline label="הצגה בקופה" value=${form.barcodeType} onChange=${(v) => { setBarcodeTouched(true); set({ barcodeType: v }); }}
              options=${[{ value: 'code128', label: 'ברקוד' }, { value: 'qr', label: 'QR' }, { value: 'none', label: 'רק הקוד' }]} />
          </${Field}>
          ${form.barcodeType !== 'none' && html`<${Field} label="ערך הברקוד" hint="רק אם שונה מהקוד" id="f-barcode">
            <input id="f-barcode" class="ltr" dir="ltr" autocomplete="off" maxlength=${LIMITS.barcode} ...${bind('barcode')} />
          </${Field}>`}
          ${members.length > 0 && html`<${Field} label="של מי" id="f-owner">
            <select id="f-owner" value=${form.owner} onChange=${(e) => set({ owner: e.currentTarget.value })}>
              <option value=${SHARED_OWNER}>משותף</option>
              ${members.map((m) => html`<option value=${m.id}>${m.name}</option>`)}
            </select>
          </${Field}>`}
          <${Field} label="התקבל בתאריך" id="f-received">
            <input id="f-received" type="date" max=${todayISO()} ...${bind('receivedAt')} />
          </${Field}>
          <${Field} label="הערות" id="f-notes">
            <textarea id="f-notes" maxlength=${LIMITS.notes} rows="3" ...${bind('notes')}></textarea>
          </${Field}>
          <div class="field">
            <span class="label">צבע</span>
            <div class="color-dots">
              <button type="button" class=${`auto ${!form.color ? 'active' : ''}`} aria-label="צבע אוטומטי" onClick=${() => set({ color: null })}></button>
              ${PALETTE.map((c) => html`<button type="button" class=${form.color === c ? 'active' : ''} style=${{ background: c }} aria-label=${`צבע ${c}`} onClick=${() => set({ color: c })}></button>`)}
            </div>
          </div>
        </div>`}

        <div class="form-actions">
          <button class="btn primary" disabled=${busy}><${Icon} name="check" />${editing ? 'שמירה' : 'הוספה לארנק'}</button>
        </div>
      </form>
    </main>
  </div>`;
}
