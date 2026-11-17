// Wallet: totals, search, filters and the list of live cards.

import { html, useState } from '../vendor/preact-htm.js';
import { ctx, useStore, useSyncState, navigate } from './core.js';
import { Icon, StoreAvatar, Money, ExpiryBadge, Empty, Banner, TopBar, MemberAvatar } from './components.js';
import { filterViews, sortViews, summarize, GROUPS, TYPES, TYPE_ORDER, SORTS, SHARED_OWNER } from '../lib/model.js';
import { formatMoney } from '../lib/money.js';
import { isIOS, isStandalone, canPromptInstall, promptInstall } from '../lib/platform.js';
import { openPasteSheet, openScanSheet } from './paste.js';
import { ocrSupported } from '../lib/ocr.js';
import { SyncPill } from './sync-pill.js';

export function CardItem({ view, members }) {
  const { card } = view;
  const owner = card.owner !== SHARED_OWNER ? members.find((m) => m.id === card.owner) : null;
  const meta = [TYPES[card.type]?.label, card.title, card.discount].filter(Boolean).join(' · ');
  const dim = view.status === 'used' || view.status === 'expired' || view.status === 'archived' || view.status === 'deleted';
  const open = (e) => {
    e.preventDefault();
    navigate(`/card/${card.id}`);
  };
  return html`<a class=${`card-item ${dim ? 'dim' : ''}`} href=${`#/card/${card.id}`} onClick=${open}>
    <${StoreAvatar} card=${card} />
    <div class="main">
      <div class="store ellipsis">${card.store}</div>
      <div class="meta ellipsis">${meta}</div>
    </div>
    <div class="end">
      ${view.balance != null && html`<div class="amount"><${Money} amount=${view.balance} currency=${card.currency} /></div>`}
      <div class="row-flex">
        ${owner && html`<${MemberAvatar} member=${owner} size="xs" />`}
        <${ExpiryBadge} view=${view} />
      </div>
    </div>
  </a>`;
}

function Summary({ summary, onExpiring }) {
  const currencies = Object.keys(summary.totals);
  const main = summary.totals.ILS != null ? 'ILS' : currencies[0] || 'ILS';
  const others = currencies.filter((c) => c !== main);
  return html`<section class="summary" aria-label="סיכום">
    <div class="label">יתרה זמינה בכל הכרטיסים</div>
    <div class="total">
      <span class="num">${formatMoney(summary.totals[main] || 0, main)}</span>
      ${others.map((c) => html`<small class="num">+ ${formatMoney(summary.totals[c], c)}</small>`)}
    </div>
    <div class="pills">
      <span class="pill"><${Icon} name="wallet" />${summary.activeCount === 1 ? 'כרטיס פעיל אחד' : `${summary.activeCount} פעילים`}</span>
      ${summary.expiringCount > 0 && html`<button class=${`pill ${summary.urgentCount ? 'alert' : ''}`} onClick=${onExpiring}>
        <${Icon} name="clock" />${summary.expiringCount === 1 ? 'אחד פג בקרוב' : `${summary.expiringCount} פגים בקרוב`}
      </button>`}
    </div>
  </section>`;
}

function useDismissed(key) {
  const dismissed = ctx.store.kv.dismissed || {};
  return [!!dismissed[key], () => ctx.store.setKV('dismissed', { ...dismissed, [key]: Date.now() })];
}

function Hints({ cardCount }) {
  const sync = useSyncState();
  const [installHidden, hideInstall] = useDismissed('install');
  const [syncHidden, hideSync] = useDismissed('sync-hint');
  const configured = ctx.sync.configured();

  if (configured && sync.status === 'error' && sync.error?.code === 'unauthorized') {
    return html`<${Banner} tone="danger" icon="cloud-off" title="הסנכרון נותק" action=${{ label: 'לפרטים', onClick: () => navigate('/settings/sync') }}>
      המפתח של המכשיר הזה כבר לא מתאים לשרת.
    </${Banner}>`;
  }
  if (!isStandalone() && !installHidden && isIOS()) {
    return html`<${Banner} icon="smartphone" title="כדאי להתקין כאפליקציה" onClose=${hideInstall}>
      ב-Safari: <b>שיתוף</b> ואז <b>הוספה למסך הבית</b>. כך הנתונים נשמרים בבטחה וזמינים גם בלי אינטרנט.
    </${Banner}>`;
  }
  if (!isStandalone() && !installHidden && canPromptInstall()) {
    return html`<${Banner} icon="smartphone" title="התקנה כאפליקציה" onClose=${hideInstall} action=${{ label: 'התקנה', onClick: () => promptInstall() }}>
      פותחים בלחיצה ממסך הבית, וזה עובד גם בלי אינטרנט.
    </${Banner}>`;
  }
  if (!configured && !syncHidden && cardCount >= 2) {
    return html`<${Banner} icon="users" title="לנהל את הארנק יחד?" onClose=${hideSync} action=${{ label: 'הגדרת סנכרון', onClick: () => navigate('/settings/sync') }}>
      חברו את הטלפון של בן או בת הזוג, וכל כרטיס או מימוש יופיעו אצל שניכם.
    </${Banner}>`;
  }
  return null;
}

export function Wallet() {
  const store = useStore();
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState('all');
  const views = store.views();
  const { members } = store.snapshot();
  const sort = store.settings().sort;
  const summary = summarize(views);
  const me = store.me();

  const active = views.filter(GROUPS.active);
  const typeCounts = TYPE_ORDER.map((t) => [t, active.filter((v) => v.card.type === t).length]).filter(([, n]) => n > 0);

  const chips = [{ id: 'all', label: 'הכל', count: active.length }];
  if (summary.expiringCount) chips.push({ id: 'expiring', label: 'פג בקרוב', icon: 'clock', count: summary.expiringCount });
  if (typeCounts.length > 1) for (const [t, n] of typeCounts) chips.push({ id: `type:${t}`, label: TYPES[t].plural, count: n });
  if (members.length > 1) {
    for (const m of members) chips.push({ id: `owner:${m.id}`, label: m.id === me ? 'שלי' : `של ${m.name}` });
    chips.push({ id: `owner:${SHARED_OWNER}`, label: 'משותפים' });
  }

  const filter = { group: 'active', query };
  if (chip === 'expiring') filter.group = 'expiring';
  if (chip.startsWith('type:')) filter.type = chip.slice(5);
  if (chip.startsWith('owner:')) filter.owner = chip.slice(6);
  // A search looks through everything, including used and expired cards.
  if (query.trim()) filter.group = 'all';
  const list = sortViews(filterViews(views, filter), sort);

  const attention = !query && chip === 'all' && sort === 'expiry' ? list.filter((v) => v.status === 'expiring') : [];
  const rest = attention.length ? list.filter((v) => v.status !== 'expiring') : list;
  const totalCards = views.filter(GROUPS.all).length;
  const inactive = summary.counts.used + summary.counts.expired + summary.counts.archived;

  const actions = html`
    <${SyncPill} />
    ${ocrSupported() && html`<button class="icon-btn" aria-label="סריקת קבלה או צילום מסך" onClick=${() => openScanSheet()}><${Icon} name="scan-text" /></button>`}
    <button class="icon-btn" aria-label="הדבקת הודעה עם שובר" onClick=${() => openPasteSheet()}><${Icon} name="clipboard-paste" /></button>`;

  return html`<div>
    <${TopBar} title="הארנק שלנו" actions=${actions} />
    <main class="screen">
      <${Hints} cardCount=${totalCards} />
      ${totalCards === 0 ? html`<${Empty} icon="gift" title="הארנק עוד ריק"
          actions=${html`
            <button class="btn primary block" onClick=${() => navigate('/add')}><${Icon} name="plus" />הוספת כרטיס או זיכוי</button>
            ${ocrSupported() && html`<button class="btn block" onClick=${() => openScanSheet()}><${Icon} name="scan-text" />סריקת קבלה או צילום מסך</button>`}
            <button class="btn block" onClick=${() => openPasteSheet()}><${Icon} name="clipboard-paste" />הדבקת SMS או מייל של שובר</button>`}>
          כאן יופיעו כרטיסי המתנה, הזיכויים והשוברים שלכם, עם היתרה ותאריך התפוגה של כל אחד.
        </${Empty}>`
      : html`
        <${Summary} summary=${summary} onExpiring=${() => setChip('expiring')} />
        <div class="searchbar">
          <${Icon} name="search" />
          <input type="search" placeholder="חיפוש חנות, קוד או הערה" value=${query} onInput=${(e) => setQuery(e.currentTarget.value)} aria-label="חיפוש" enterkeyhint="search" />
          ${query && html`<button aria-label="ניקוי החיפוש" onClick=${() => setQuery('')}><${Icon} name="x" size=${18} /></button>`}
        </div>
        ${!query && chips.length > 1 && html`<div class="chips" role="tablist" aria-label="סינון">
          ${chips.map((c) => html`<button role="tab" aria-selected=${chip === c.id} class=${`chip ${chip === c.id ? 'active' : ''}`} onClick=${() => setChip(c.id)}>
            ${c.icon && html`<${Icon} name=${c.icon} />`}${c.label}${c.count != null && html`<span class="count">${c.count}</span>`}
          </button>`)}
        </div>`}
        ${attention.length > 0 && html`
          <div class="list-head"><h2>דורש תשומת לב</h2></div>
          <div class="cards">${attention.map((v) => html`<${CardItem} key=${v.id} view=${v} members=${members} />`)}</div>`}
        <div class="list-head">
          <h2>${query ? `תוצאות (${list.length})` : attention.length ? 'שאר הכרטיסים' : 'הכרטיסים'}</h2>
          <select aria-label="מיון" value=${sort} onChange=${(e) => store.updateSettings({ sort: e.currentTarget.value })}>
            ${Object.entries(SORTS).map(([k, s]) => html`<option value=${k}>${s.label}</option>`)}
          </select>
        </div>
        ${rest.length ? html`<div class="cards">${rest.map((v) => html`<${CardItem} key=${v.id} view=${v} members=${members} />`)}</div>`
          : !attention.length && html`<${Empty} icon=${query ? 'search' : 'wallet'} title=${query ? 'לא מצאנו' : 'אין כאן כרטיסים פעילים'}>
              ${query ? 'נסו שם אחר של החנות, או חלק מהקוד.' : 'כל הכרטיסים נוצלו, פגו או הועברו לארכיון.'}
            </${Empty}>`}
        ${!query && inactive > 0 && html`<div class="more-link">
          <a href="#/archive" onClick=${(e) => { e.preventDefault(); navigate('/archive'); }}>
            כרטיסים שלא פעילים (${inactive})
          </a>
        </div>`}`}
    </main>
  </div>`;
}
