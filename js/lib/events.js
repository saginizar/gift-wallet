// Turns activity-log records into Hebrew text for the history feed. Phrasing uses nouns
// ("מימוש", "הוספה") so it reads the same whoever did the action.

import { formatMoney } from './money.js';
import { TYPES, FIELD_LABELS, memberName } from './model.js';

const money = (e, n) => (n == null ? '' : formatMoney(n, e.currency));

export function describeEvent(e) {
  const store = e.store || '';
  const type = TYPES[e.cardType]?.label || 'כרטיס';
  switch (e.action) {
    case 'card.create':
      return {
        icon: 'plus',
        title: `הוספת ${type}: ${store}`,
        detail: e.amount != null ? `סכום ${money(e, e.amount)}${e.balanceAfter != null && e.balanceAfter !== e.amount ? `, יתרה ${money(e, e.balanceAfter)}` : ''}` : '',
      };
    case 'card.update':
      return {
        icon: 'pencil',
        title: `עדכון פרטים: ${store}`,
        detail: (e.fields || []).map((f) => FIELD_LABELS[f] || f).join(', '),
      };
    case 'card.archive':
      return { icon: 'archive', title: `העברה לארכיון: ${store}`, detail: '' };
    case 'card.unarchive':
      return { icon: 'archive-restore', title: `החזרה מהארכיון: ${store}`, detail: '' };
    case 'card.delete':
      return { icon: 'trash', title: `מחיקה: ${store}`, detail: '' };
    case 'card.restore':
      return { icon: 'undo', title: `שחזור מהסל: ${store}`, detail: '' };
    case 'tx.use':
      return {
        icon: 'shopping-bag',
        title: `מימוש ${money(e, e.amount)} · ${store}`,
        detail: [e.balanceAfter != null ? `נשארו ${money(e, e.balanceAfter)}` : '', e.note].filter(Boolean).join(' · '),
      };
    case 'tx.load':
      return {
        icon: 'circle-plus',
        title: `טעינה ${money(e, e.amount)} · ${store}`,
        detail: [e.balanceAfter != null ? `יתרה ${money(e, e.balanceAfter)}` : '', e.note].filter(Boolean).join(' · '),
      };
    case 'tx.adjust':
      return { icon: 'scale', title: `עדכון יתרה ל-${money(e, e.balanceAfter)} · ${store}`, detail: e.note || '' };
    case 'tx.redeem':
      return { icon: 'check', title: `סימון כמומש · ${store}`, detail: e.note || '' };
    case 'tx.delete':
      return { icon: 'undo', title: `ביטול פעולה · ${store}`, detail: txLabel(e) };
    case 'member.add':
      return { icon: 'user-plus', title: `הוספה לבני הבית: ${e.memberName}`, detail: '' };
    case 'member.rename':
      return { icon: 'user', title: `שינוי שם: ${e.memberName}`, detail: e.previousName ? `במקום ${e.previousName}` : '' };
    default:
      return { icon: 'dot', title: e.action, detail: '' };
  }
}

function txLabel(e) {
  switch (e.txType) {
    case 'use': return `מימוש ${money(e, e.amount)}`;
    case 'load': return `טעינה ${money(e, e.amount)}`;
    case 'adjust': return 'עדכון יתרה';
    case 'redeem': return 'סימון כמומש';
    default: return '';
  }
}

export function eventActor(e, members) {
  return e.by ? memberName(members, e.by) : '';
}

// Hebrew description of a ledger transaction for the card's own history list.
export function describeTx(tx, currency) {
  const m = (n) => formatMoney(n, currency);
  switch (tx.type) {
    case 'use': return { icon: 'shopping-bag', title: `מימוש ${m(tx.amount)}`, sign: -1 };
    case 'load': return { icon: 'circle-plus', title: `טעינה ${m(tx.amount)}`, sign: 1 };
    case 'adjust': return { icon: 'scale', title: tx.delta >= 0 ? `תיקון יתרה +${m(Math.abs(tx.delta))}` : `תיקון יתרה −${m(Math.abs(tx.delta))}`, sign: Math.sign(tx.delta) };
    case 'redeem': return { icon: 'check', title: 'סומן כמומש', sign: 0 };
    default: return { icon: 'dot', title: tx.type, sign: 0 };
  }
}
