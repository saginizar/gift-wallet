// Sheet for recording a purchase (מימוש), a top-up, or correcting the balance.

import { html, useState, useRef, useEffect } from '../vendor/preact-htm.js';
import { ctx, toast, toastError } from './core.js';
import { Icon, Field, openSheet } from './components.js';
import { formatMoney, parseAmount, amountInputValue, CURRENCIES } from '../lib/money.js';
import { todayISO, formatDate } from '../lib/dates.js';
import { vibrate } from '../lib/platform.js';

const TITLES = { use: 'מימוש', load: 'טעינת סכום', adjust: 'עדכון יתרה' };

function TxBody({ view, type, close }) {
  const { card } = view;
  const [amount, setAmount] = useState(type === 'adjust' ? amountInputValue(view.balance) : '');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayISO());
  const [showDate, setShowDate] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef();
  useEffect(() => {
    const t = setTimeout(() => input.current?.focus(), 250);
    return () => clearTimeout(t);
  }, []);

  const n = parseAmount(amount);
  const after = n == null ? null
    : type === 'use' ? view.balance - n
      : type === 'load' ? view.balance + n
        : n;

  async function save(e) {
    e.preventDefault();
    if (n == null || (type !== 'adjust' && n <= 0) || n < 0) return setError('צריך להזין סכום');
    if (type === 'use' && n > view.balance + 0.001) return setError(`הסכום גבוה מהיתרה (${formatMoney(view.balance, card.currency)}). אם היתרה בפועל שונה, עדכנו אותה קודם.`);
    if (type === 'adjust' && Math.abs(n - view.balance) < 0.005) return setError('זו כבר היתרה הנוכחית');
    setBusy(true);
    try {
      const tx = await ctx.store.addTx(card.id, { type, amount: n, balance: n, date, note });
      vibrate();
      close(tx);
      const left = ctx.store.view(card.id)?.balance;
      const msg = type === 'use'
        ? `נרשם מימוש של ${formatMoney(n, card.currency)}. נשארו ${formatMoney(left, card.currency)}`
        : type === 'load' ? `נוספו ${formatMoney(n, card.currency)}` : `היתרה עודכנה ל-${formatMoney(n, card.currency)}`;
      toast(msg, { action: 'ביטול', onAction: () => ctx.store.deleteTx(tx.id).catch(toastError) });
    } catch (err) {
      setBusy(false);
      toastError(err);
    }
  }

  const label = type === 'adjust' ? 'היתרה הנוכחית בכרטיס' : type === 'use' ? 'כמה שילמתם עם הכרטיס?' : 'כמה נטען?';

  return html`<form class="form" onSubmit=${save}>
    <div class="muted">${card.store} · יתרה ${formatMoney(view.balance, card.currency)}</div>
    <${Field} label=${label} error=${error} id="tx-amount">
      <div class="input-wrap amount-input">
        <input id="tx-amount" ref=${input} inputmode="decimal" autocomplete="off" placeholder="0" value=${amount}
          onInput=${(e) => { setAmount(e.currentTarget.value); setError(''); }} />
        <span class="cur">${CURRENCIES[card.currency]?.symbol || '₪'}</span>
      </div>
    </${Field}>
    ${type === 'use' && view.balance > 0 && html`<div class="quick-picks">
      <button type="button" onClick=${() => { setAmount(amountInputValue(view.balance)); setError(''); }}>כל היתרה (${formatMoney(view.balance, card.currency)})</button>
    </div>`}
    ${after != null && n != null && type !== 'adjust' && after >= 0 && html`<div class="muted small">אחרי הפעולה: ${formatMoney(after, card.currency)}</div>`}
    ${type !== 'adjust' && html`<${Field} label="הערה (לא חובה)" id="tx-note">
      <input id="tx-note" maxlength="200" placeholder=${type === 'use' ? 'מה קניתם? למשל: נעליים לילדים' : ''} value=${note} onInput=${(e) => setNote(e.currentTarget.value)} />
    </${Field}>`}
    ${showDate ? html`<${Field} label="תאריך" id="tx-date">
        <input id="tx-date" type="date" value=${date} max=${todayISO()} onInput=${(e) => setDate(e.currentTarget.value || todayISO())} />
      </${Field}>`
      : html`<button type="button" class="disclosure" onClick=${() => setShowDate(true)}><${Icon} name="clock" />היום, ${formatDate(date)}. לשנות תאריך?</button>`}
    <button class="btn primary block" disabled=${busy}><${Icon} name="check" />שמירה</button>
  </form>`;
}

export function openTxSheet(view, type) {
  return openSheet(`${TITLES[type]} · ${view.card.store}`, TxBody, { view, type });
}
