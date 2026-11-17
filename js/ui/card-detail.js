// Card page: the card itself, quick actions, code/PIN/barcode, photos, details and the
// card's own history (with undo for purchases).

import { html } from '../vendor/preact-htm.js';
import { ctx, useStore, navigate, goBack, toast, toastError } from './core.js';
import { Icon, TopBar, MemberAvatar, cardGradient, confirmDialog, openSheet, Secret, Banner, Empty } from './components.js';
import { TYPES, STATUS_LABELS, memberName, SHARED_OWNER, safeLink } from '../lib/model.js';
import { formatMoney } from '../lib/money.js';
import { formatDate, expiryLabel, formatDateTime } from '../lib/dates.js';
import { describeEvent, eventActor } from '../lib/events.js';
import { copyText, shareText, shareOrDownload, canShare } from '../lib/platform.js';
import { buildICS, googleCalendarUrl } from '../lib/reminders.js';
import { openTxSheet } from './tx-sheet.js';
import { openCashier, BarcodeArt, barcodeModes } from './cashier.js';
import { PhotoThumb, openPhotoViewer, addPhotoFlow } from './photos.js';

async function copy(text, what) {
  if (await copyText(text)) toast(`${what} הועתק`);
  else toast('לא הצלחנו להעתיק', { error: true });
}

function expiryText(view) {
  const { card, daysLeft } = view;
  if (!card.expiry) return 'ללא תאריך תפוגה';
  if (daysLeft < 0) return `פג תוקף ב-${formatDate(card.expiry)}`;
  if (daysLeft === 0) return 'בתוקף עד היום';
  return `עד ${formatDate(card.expiry)} · ${expiryLabel(daysLeft)}`;
}

function Hero({ view, members }) {
  const { card } = view;
  const owner = card.owner === SHARED_OWNER ? null : members.find((m) => m.id === card.owner);
  const inactive = view.status !== 'active' && view.status !== 'expiring';
  const tone = view.urgent || view.status === 'expired' ? 'alert' : view.status === 'expiring' ? 'soon' : '';
  return html`<section class=${`hero ${inactive ? 'inactive' : ''}`} style=${{ background: cardGradient(card) }}>
    <div class="top">
      <div>
        <div class="store">${card.store}</div>
        <div class="type">${TYPES[card.type]?.label}${card.title ? ` · ${card.title}` : ''}</div>
      </div>
      ${inactive && html`<span class="status-ribbon">${STATUS_LABELS[view.status]}</span>`}
    </div>
    <div>
      ${view.balance != null
        ? html`<div class="balance num">${formatMoney(view.balance, card.currency)}</div>
            ${view.balance !== card.initialAmount && html`<div class="of">מתוך ${formatMoney(card.initialAmount, card.currency)}</div>`}`
        : html`<div class="balance" style=${{ fontSize: '28px' }}>${card.discount || (view.redeemed ? 'מומש' : TYPES[card.type]?.label)}</div>`}
    </div>
    <div class="bottom">
      <span class=${`tag ${tone}`}><${Icon} name="clock" />${expiryText(view)}</span>
      <span class="tag"><${Icon} name=${owner ? 'user' : 'users'} />${owner ? owner.name : 'משותף'}</span>
    </div>
  </section>`;
}

function shareCard(view) {
  const { card } = view;
  const lines = [
    `${card.store} · ${TYPES[card.type]?.label}${card.title ? ` · ${card.title}` : ''}`,
    view.balance != null ? `יתרה: ${formatMoney(view.balance, card.currency)}` : card.discount,
    card.code && `קוד: ${card.code}`,
    card.pin && `קוד סודי: ${card.pin}`,
    card.expiry && `בתוקף עד ${formatDate(card.expiry)}`,
    card.link,
  ].filter(Boolean);
  const text = lines.join('\n');
  if (canShare()) shareText({ title: card.store, text });
  else copy(text, 'פרטי הכרטיס');
}

function CalendarBody({ view, close }) {
  const leadDays = ctx.store.reminderDays();
  const gcal = googleCalendarUrl(view, { appUrl: ctx.appUrl, leadDays: Math.min(...leadDays.filter((d) => d > 0), 7) });
  async function ics() {
    const content = buildICS([view], { appUrl: ctx.appUrl, reminderDays: leadDays });
    const res = await shareOrDownload(`${view.card.store}-expiry.ics`.replace(/[\\/:*?"<>|\s]+/g, '-'), content, 'text/calendar');
    close();
    if (res === 'downloaded') toast('הקובץ ירד. פותחים אותו כדי להוסיף ליומן');
  }
  return html`<div class="stack">
    <p class="muted">אירוע ביום התפוגה (${formatDate(view.card.expiry)}) עם התראות ${leadDays.map((d) => (d === 1 ? 'יום' : `${d} ימים`)).join(', ')} לפני.</p>
    <a class="btn primary block" href=${gcal} target="_blank" rel="noopener noreferrer" onClick=${() => close()}><${Icon} name="calendar-plus" />יומן Google</a>
    <button class="btn block" onClick=${ics}><${Icon} name="download" />קובץ יומן (iPhone, Outlook)</button>
  </div>`;
}

function MoreBody({ view, close }) {
  const { card } = view;
  const store = ctx.store;
  const run = (fn) => async () => {
    await close();
    fn();
  };
  const hasAmount = view.balance != null;
  return html`<div class="panel" style=${{ marginBottom: 0 }}>
    ${hasAmount && html`<button class="prow" onClick=${run(() => openTxSheet(view, 'adjust'))}><${Icon} name="scale" /><span class="v">עדכון יתרה</span></button>`}
    ${hasAmount && html`<button class="prow" onClick=${run(() => openTxSheet(view, 'load'))}><${Icon} name="circle-plus" /><span class="v">טעינת סכום</span></button>`}
    <button class="prow" onClick=${run(() => navigate(`/edit/${card.id}`))}><${Icon} name="pencil" /><span class="v">עריכת פרטים</span></button>
    ${card.expiry && html`<button class="prow" onClick=${run(() => openSheet('תזכורת ביומן', CalendarBody, { view }))}><${Icon} name="calendar-plus" /><span class="v">תזכורת ביומן</span></button>`}
    <button class="prow" onClick=${run(() => addPhotoFlow(card.id))}><${Icon} name="camera" /><span class="v">הוספת תמונה</span></button>
    <button class="prow" onClick=${run(() => shareCard(view))}><${Icon} name="share" /><span class="v">שיתוף פרטי הכרטיס</span></button>
    <button class="prow" onClick=${run(() => store.setArchived(card.id, !card.archived).then(() => toast(card.archived ? 'הוחזר לארנק' : 'הועבר לארכיון')).catch(toastError))}>
      <${Icon} name=${card.archived ? 'archive-restore' : 'archive'} /><span class="v">${card.archived ? 'החזרה מהארכיון' : 'העברה לארכיון'}</span>
    </button>
    <button class="prow danger" onClick=${run(async () => {
      if (!await confirmDialog({ title: `למחוק את ${card.store}?`, text: 'הכרטיס יעבור לסל המחזור, ואפשר יהיה לשחזר אותו משם.', confirmLabel: 'מחיקה', danger: true })) return;
      await store.deleteCard(card.id).catch(toastError);
      goBack('/');
      toast('הכרטיס נמחק', { action: 'ביטול', onAction: () => store.restoreCard(card.id) });
    })}><${Icon} name="trash" /><span class="v">מחיקה</span></button>
  </div>`;
}

function History({ view, events, members }) {
  const store = ctx.store;
  const txs = new Map(view.ledger.map((l) => [l.tx.id, l.tx]));
  if (!events.length) return null;
  async function undo(e) {
    const tx = txs.get(e.txId);
    if (!tx) return;
    const d = describeEvent(e);
    if (!await confirmDialog({ title: 'לבטל את הפעולה?', text: d.title, confirmLabel: 'ביטול הפעולה', cancelLabel: 'השארה', danger: true })) return;
    await store.deleteTx(tx.id).catch(toastError);
    toast('הפעולה בוטלה');
  }
  return html`<section class="panel ledger">
    <h3>היסטוריה</h3>
    ${events.map((e) => {
      const d = describeEvent(e);
      const undoable = e.action.startsWith('tx.') && e.action !== 'tx.delete' && txs.has(e.txId);
      return html`<div class="item" key=${e.id}>
        <div class="ic"><${Icon} name=${d.icon} /></div>
        <div>
          <div class="title">${d.title.replace(` · ${view.card.store}`, '').replace(`: ${view.card.store}`, '')}</div>
          <div class="sub">${[d.detail, `${eventActor(e, members)} · ${formatDateTime(e.at)}`].filter(Boolean).join(' · ')}</div>
        </div>
        <div class="after">${undoable && html`<button class="undo" onClick=${() => undo(e)}>ביטול</button>`}</div>
      </div>`;
    })}
  </section>`;
}

export function CardDetail({ id }) {
  const store = useStore();
  const view = store.view(id);
  const { members, events } = store.snapshot();

  if (!view || view.card.purged) {
    return html`<div><${TopBar} title="כרטיס" back=${() => goBack()} />
      <main class="screen no-tabs"><${Empty} icon="search" title="הכרטיס לא נמצא">ייתכן שנמחק במכשיר אחר.</${Empty}></main></div>`;
  }

  const card = { ...view.card, link: safeLink(view.card.link) };
  const deleted = view.status === 'deleted';
  const hasAmount = view.balance != null;
  const modes = barcodeModes(card);
  const canCashier = !!(card.code || modes.length);
  const preview = card.barcodeType !== 'none' && modes.includes(card.barcodeType) ? card.barcodeType : null;
  const cardEvents = events.filter((e) => e.cardId === id);
  const creator = memberName(members, card.by);

  async function primary() {
    if (hasAmount) {
      if (view.balance > 0) return openTxSheet(view, 'use');
      return openTxSheet(view, 'adjust');
    }
    const redeem = view.ledger.find((l) => l.tx.type === 'redeem');
    if (redeem) {
      if (await confirmDialog({ title: 'להחזיר לשימוש?', text: 'הסימון "מומש" יבוטל.', confirmLabel: 'החזרה' })) await store.deleteTx(redeem.tx.id);
      return;
    }
    if (await confirmDialog({ title: 'לסמן כמומש?', text: `${card.store}${card.discount ? ` · ${card.discount}` : ''}`, confirmLabel: 'סימון כמומש' })) {
      await store.addTx(id, { type: 'redeem' }).catch(toastError);
      toast('סומן כמומש');
    }
  }

  const primaryLabel = hasAmount ? (view.balance > 0 ? 'מימוש' : 'עדכון יתרה') : view.redeemed ? 'החזרה לשימוש' : 'סימון כמומש';
  const primaryIcon = hasAmount ? (view.balance > 0 ? 'shopping-bag' : 'scale') : view.redeemed ? 'undo' : 'check';

  return html`<div>
    <${TopBar} title=${card.store} back=${() => goBack()} actions=${!deleted && html`
      <button class="icon-btn" aria-label="עריכה" onClick=${() => navigate(`/edit/${id}`)}><${Icon} name="pencil" /></button>`} />
    <main class="screen no-tabs">
      ${deleted && html`<${Banner} tone="warn" icon="trash" title="הכרטיס בסל המחזור" action=${{ label: 'שחזור', onClick: () => store.restoreCard(id).then(() => toast('הכרטיס שוחזר')) }}>
        הוא לא מופיע בארנק ולא נספר ביתרה.
      </${Banner}>`}
      <${Hero} view=${view} members=${members} />

      ${!deleted && html`<div class="quick-actions" style=${{ '--cols': 3 }}>
        <button class="main" onClick=${primary}><${Icon} name=${primaryIcon} />${primaryLabel}</button>
        <button onClick=${() => (canCashier ? openCashier(id) : card.link ? window.open(card.link, '_blank', 'noopener') : navigate(`/edit/${id}`))}>
          <${Icon} name="scan-barcode" />${canCashier ? 'הצגה בקופה' : card.link ? 'פתיחת השובר' : 'הוספת קוד'}
        </button>
        <button onClick=${() => openSheet(card.store, MoreBody, { view })}><${Icon} name="more" />עוד</button>
      </div>`}

      ${(card.code || card.pin || card.link || preview) && html`<section class="panel">
        ${card.code && html`<div class="code-box">
          <div class="grow">
            <div class="label">קוד / מספר כרטיס</div>
            <div class="code ltr mono">${card.code}</div>
          </div>
          <button class="icon-btn soft" aria-label="העתקת הקוד" onClick=${() => copy(card.code, 'הקוד')}><${Icon} name="copy" /></button>
        </div>`}
        ${preview && html`<button class=${`barcode-preview ${preview === 'qr' ? 'qr' : ''}`} onClick=${() => openCashier(id)} aria-label="הצגה בקופה">
          <${BarcodeArt} card=${card} mode=${preview} />
          <div class="hint">הקשה להצגה במסך מלא בקופה</div>
        </button>`}
        ${card.pin && html`<div class="prow">
          <span class="k">קוד סודי</span>
          <${Secret} value=${card.pin} class="v row-flex" />
          <button class="icon-btn" aria-label="העתקת הקוד הסודי" onClick=${() => copy(card.pin, 'הקוד הסודי')}><${Icon} name="copy" /></button>
        </div>`}
        ${card.link && html`<a class="prow" href=${card.link} target="_blank" rel="noopener noreferrer">
          <${Icon} name="external-link" /><span class="v">פתיחת השובר המקורי</span><${Icon} name="chevron-left" class="chev" />
        </a>`}
      </section>`}

      ${(card.photos?.length > 0 || !deleted) && html`<section class="panel">
        <h3>תמונות</h3>
        <div class="photos">
          ${(card.photos || []).map((pid) => html`<${PhotoThumb} key=${pid} id=${pid} onClick=${() => openPhotoViewer(id, pid, { canDelete: !deleted })} />`)}
          ${!deleted && html`<button class="photo-thumb add" aria-label="הוספת תמונה" onClick=${() => addPhotoFlow(id)}><${Icon} name="camera" /></button>`}
        </div>
      </section>`}

      <section class="panel">
        <h3>פרטים</h3>
        ${card.usableAt && html`<div class="prow"><span class="k">איפה לממש</span><span class="v">${card.usableAt}</span></div>`}
        ${card.discount && view.balance != null && html`<div class="prow"><span class="k">הטבה</span><span class="v">${card.discount}</span></div>`}
        ${card.expiry && html`<div class="prow"><span class="k">תוקף</span><span class="v">${formatDate(card.expiry)}</span></div>`}
        ${card.receivedAt && html`<div class="prow"><span class="k">התקבל</span><span class="v">${formatDate(card.receivedAt)}</span></div>`}
        ${hasAmount && view.spent > 0 && html`<div class="prow"><span class="k">מומש עד כה</span><span class="v">${formatMoney(view.spent, card.currency)}</span></div>`}
        ${card.notes && html`<div class="prow"><span class="k">הערות</span><span class="v" style=${{ whiteSpace: 'pre-line', fontWeight: 500 }}>${card.notes}</span></div>`}
        <div class="prow"><span class="k">נוסף</span><span class="v" style=${{ fontWeight: 500 }}>${formatDateTime(card.createdAt)}${creator ? ` · ${creator}` : ''}</span></div>
      </section>

      <${History} view=${view} events=${cardEvents} members=${members} />
    </main>
  </div>`;
}
