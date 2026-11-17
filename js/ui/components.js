// Small shared components.

import { html, useState } from '../vendor/preact-htm.js';
import { ICONS } from './icons.js';
import { closeOverlay, openOverlay, useOverlays, useToasts, dismissToast } from './core.js';
import { storeColor, storeInitials } from '../lib/catalog.js';
import { formatMoney } from '../lib/money.js';
import { expiryLabel, formatDate } from '../lib/dates.js';

export function Icon({ name, size = 20, class: cls = '', label }) {
  return html`<svg class=${`svg-icon ${cls}`} width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden=${label ? undefined : 'true'} aria-label=${label} role=${label ? 'img' : undefined} dangerouslySetInnerHTML=${{ __html: ICONS[name] || '' }}></svg>`;
}

// Darkens a hex color toward black by `amount` (0..1).
export function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.round(c * (1 - amount));
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export const cardGradient = (card) => {
  const c = storeColor(card.store, card.color);
  return `linear-gradient(135deg, ${c}, ${shade(c, 0.35)})`;
};

export function StoreAvatar({ card, size }) {
  return html`<div class=${`avatar ${size || ''}`} style=${{ background: cardGradient(card) }} aria-hidden="true">${storeInitials(card.store)}</div>`;
}

export function MemberAvatar({ member, size = 'sm' }) {
  if (!member) return null;
  return html`<span class=${`avatar ${size}`} style=${{ background: member.color || '#6247ea' }} title=${member.name}>${(member.name || '?')[0]}</span>`;
}

export function Money({ amount, currency }) {
  return html`<span class="num">${formatMoney(amount, currency)}</span>`;
}

export function ExpiryBadge({ view }) {
  const { daysLeft, status, urgent } = view;
  if (status === 'used') return html`<span class="badge"><${Icon} name="check" />נוצל</span>`;
  if (status === 'archived') return html`<span class="badge"><${Icon} name="archive" />בארכיון</span>`;
  if (daysLeft == null) return html`<span class="badge">ללא תוקף</span>`;
  const cls = status === 'expired' ? 'urgent' : urgent ? 'urgent' : status === 'expiring' ? 'soon' : '';
  return html`<span class=${`badge ${cls}`} title=${`בתוקף עד ${formatDate(view.card.expiry)}`}>
    ${(urgent || status === 'expired') && html`<${Icon} name="clock" />`}${expiryLabel(daysLeft)}
  </span>`;
}

export function Field({ label, hint, error, children, id }) {
  return html`<div class=${`field ${error ? 'invalid' : ''}`}>
    ${label && html`<label for=${id}>${label}</label>`}
    ${children}
    ${error ? html`<div class="error" role="alert">${error}</div>` : hint && html`<div class="hint">${hint}</div>`}
  </div>`;
}

export function Segmented({ options, value, onChange, inline = false, label }) {
  return html`<div class=${`segmented ${inline ? 'inline' : ''}`} style=${{ '--n': options.length }} role="radiogroup" aria-label=${label}>
    ${options.map((o) => html`<button type="button" role="radio" aria-checked=${value === o.value} class=${value === o.value ? 'active' : ''} onClick=${() => onChange(o.value)}>
      ${o.icon && html`<${Icon} name=${o.icon} />`}<span>${o.label}</span>
    </button>`)}
  </div>`;
}

export function Empty({ icon = 'gift', title, children, actions }) {
  return html`<div class="empty">
    <div class="art"><${Icon} name=${icon} size=${44} /></div>
    <h2>${title}</h2>
    <div>${children}</div>
    ${actions && html`<div class="actions">${actions}</div>`}
  </div>`;
}

export function Banner({ icon = 'info', tone = '', title, children, onClose, action }) {
  return html`<div class=${`banner ${tone}`} role=${tone === 'danger' ? 'alert' : 'status'}>
    <${Icon} name=${icon} />
    <div class="grow">
      ${title && html`<b class="title">${title}</b>`}
      ${children}
      ${action && html`<div><button class="link-btn" onClick=${action.onClick}>${action.label}</button></div>`}
    </div>
    ${onClose && html`<button class="close" aria-label="סגירה" onClick=${onClose}><${Icon} name="x" size=${18} /></button>`}
  </div>`;
}

export function TopBar({ title, sub, back, actions, small }) {
  return html`<header class="topbar">
    ${back && html`<button class="icon-btn" aria-label="חזרה" onClick=${back}><${Icon} name="arrow-right" /></button>`}
    <h1 class=${small || back ? 'sm' : ''}>${title}${sub && html`<div class="sub">${sub}</div>`}</h1>
    ${actions}
  </header>`;
}

// ------------------------------------------------------------------ overlay hosts

export function SheetFrame({ title, onClose, children }) {
  return html`<div class="sheet" role="dialog" aria-modal="true" aria-label=${title} onClick=${(e) => e.stopPropagation()}>
    <div class="grabber"></div>
    ${title && html`<div class="sheet-head">
      <h2>${title}</h2>
      <button class="icon-btn soft" aria-label="סגירה" onClick=${onClose}><${Icon} name="x" /></button>
    </div>`}
    ${children}
  </div>`;
}

export function OverlayHost() {
  const list = useOverlays();
  return list.map((o) => {
    const close = (value) => closeOverlay(o.id, value);
    const content = o.render(close);
    if (o.kind === 'full') return html`<div key=${o.id}>${content}</div>`;
    return html`<div key=${o.id} class=${`overlay ${o.kind === 'dialog' ? 'center' : ''}`} onClick=${() => o.dismissible && close(undefined)}>
      ${content}
    </div>`;
  });
}

export function ToastHost() {
  const list = useToasts();
  return html`<div class="toast-host" aria-live="polite">
    ${list.map((t) => html`<div key=${t.id} class=${`toast ${t.error ? 'error' : ''}`}>
      <div class="grow">${t.message}</div>
      ${t.action && html`<button onClick=${() => { dismissToast(t.id); t.onAction?.(); }}>${t.action}</button>`}
    </div>`)}
  </div>`;
}

export function openSheet(title, Body, props = {}) {
  return openOverlay((close) => html`<${SheetFrame} title=${title} onClose=${() => close(undefined)}>
    <${Body} ...${props} close=${close} />
  </${SheetFrame}>`);
}

function ConfirmBody({ title, text, confirmLabel, cancelLabel, danger, close }) {
  return html`<div class="dialog" role="alertdialog" aria-modal="true" aria-label=${title} onClick=${(e) => e.stopPropagation()}>
    <h2>${title}</h2>
    ${text && html`<p>${text}</p>`}
    <div class="btn-row">
      <button class="btn" onClick=${() => close(false)}>${cancelLabel || 'ביטול'}</button>
      <button class=${`btn ${danger ? 'danger' : 'primary'}`} onClick=${() => close(true)}>${confirmLabel || 'אישור'}</button>
    </div>
  </div>`;
}

export function confirmDialog(opts) {
  return openOverlay((close) => html`<${ConfirmBody} ...${opts} close=${close} />`, { kind: 'dialog' }).then((v) => v === true);
}

// Reveals a secret value (PIN) on tap.
export function Secret({ value, class: cls = '' }) {
  const [shown, setShown] = useState(false);
  return html`<span class=${cls}>
    <span class="ltr mono">${shown ? value : '•'.repeat(Math.min(Math.max(value.length, 4), 8))}</span>
    <button class="icon-btn" aria-label=${shown ? 'הסתרה' : 'הצגה'} onClick=${() => setShown(!shown)}><${Icon} name=${shown ? 'eye-off' : 'eye'} /></button>
  </span>`;
}
