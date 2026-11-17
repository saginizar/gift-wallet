// History: year totals and the household activity feed, grouped by day.

import { html, useState } from '../vendor/preact-htm.js';
import { useStore, navigate } from './core.js';
import { Icon, TopBar, Empty } from './components.js';
import { insights } from '../lib/model.js';
import { formatMoney } from '../lib/money.js';
import { dayHeading, formatTime } from '../lib/dates.js';
import { describeEvent, eventActor } from '../lib/events.js';

const PAGE = 60;

function totalText(totals) {
  const entries = Object.entries(totals);
  if (!entries.length) return formatMoney(0, 'ILS');
  return entries.map(([c, n]) => formatMoney(n, c)).join(' + ');
}

export function HistoryScreen() {
  const store = useStore();
  const [who, setWho] = useState('all');
  const [limit, setLimit] = useState(PAGE);
  const { events, members, cards } = store.snapshot();
  const year = new Date().getFullYear();
  const stats = insights(store.views(), year);
  const liveCards = new Set(cards.filter((c) => !c.purged).map((c) => c.id));

  const filtered = events.filter((e) => who === 'all' || e.by === who);
  const shown = filtered.slice(0, limit);
  const groups = [];
  for (const e of shown) {
    const heading = dayHeading(e.at);
    if (!groups.length || groups[groups.length - 1].heading !== heading) groups.push({ heading, items: [] });
    groups[groups.length - 1].items.push(e);
  }

  return html`<div>
    <${TopBar} title="היסטוריה" />
    <main class="screen">
      <div class="stats">
        <div class="stat"><div class="k">מומש ב-${year}</div><div class="v num">${totalText(stats.usedThisYear)}</div><div class="s">${stats.usesCount === 1 ? 'מימוש אחד' : `${stats.usesCount} מימושים`}</div></div>
        <div class="stat"><div class="k">נוסף ב-${year}</div><div class="v num">${totalText(stats.addedThisYear)}</div><div class="s">ערך מקורי של כרטיסים</div></div>
        ${Object.keys(stats.lostToExpiry).length > 0 && html`<div class="stat warn wide">
          <div class="k">פג תוקף לפני שמומש</div><div class="v num">${totalText(stats.lostToExpiry)}</div>
          <div class="s">כדאי להוסיף תזכורות ביומן לכרטיסים שפגים בקרוב</div>
        </div>`}
        ${stats.topStores.length > 0 && html`<div class="stat wide">
          <div class="k">איפה מימשנו הכי הרבה השנה</div>
          <div class="s" style=${{ fontSize: '15px', color: 'var(--text)', fontWeight: 600, marginTop: '4px' }}>
            ${stats.topStores.map((s) => `${s.store} ${formatMoney(s.amount, 'ILS')}`).join(' · ')}
          </div>
        </div>`}
      </div>

      ${members.length > 1 && html`<div class="chips">
        <button class=${`chip ${who === 'all' ? 'active' : ''}`} onClick=${() => setWho('all')}>כולם</button>
        ${members.map((m) => html`<button class=${`chip ${who === m.id ? 'active' : ''}`} onClick=${() => setWho(m.id)}>${m.name}</button>`)}
      </div>`}

      ${!groups.length ? html`<${Empty} icon="history" title="עוד אין היסטוריה">כל הוספה, מימוש או עדכון יופיעו כאן, עם מי עשה ומתי.</${Empty}>`
        : groups.map((g) => html`<div key=${g.heading}>
          <div class="feed-day">${g.heading}</div>
          <div class="feed">
            ${g.items.map((e) => {
              const d = describeEvent(e);
              const linkable = e.cardId && liveCards.has(e.cardId);
              const body = html`<div class="ic"><${Icon} name=${d.icon} /></div>
                <div>
                  <div class="title">${d.title}</div>
                  <div class="sub">${[d.detail, eventActor(e, members)].filter(Boolean).join(' · ')}</div>
                </div>
                <div class="time ltr">${formatTime(e.at)}</div>`;
              return linkable
                ? html`<button class="feed-item" key=${e.id} onClick=${() => navigate(`/card/${e.cardId}`)}>${body}</button>`
                : html`<div class="feed-item" key=${e.id}>${body}</div>`;
            })}
          </div>
        </div>`)}
      ${filtered.length > limit && html`<button class="btn block" style=${{ marginTop: '14px' }} onClick=${() => setLimit(limit + PAGE)}>עוד</button>`}
    </main>
  </div>`;
}
