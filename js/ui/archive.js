// Cards that are no longer live (used, expired, archived) and the recycle bin.

import { html, useState } from '../vendor/preact-htm.js';
import { useStore, goBack, toast, toastError } from './core.js';
import { TopBar, Empty, Segmented, confirmDialog, Icon } from './components.js';
import { filterViews, sortViews } from '../lib/model.js';
import { CardItem } from './wallet.js';

export function ArchiveScreen() {
  const store = useStore();
  const views = store.views();
  const { members } = store.snapshot();
  const counts = {
    used: filterViews(views, { group: 'used' }).length,
    expired: filterViews(views, { group: 'expired' }).length,
    archived: filterViews(views, { group: 'archived' }).length,
  };
  const first = Object.entries(counts).find(([, n]) => n > 0)?.[0] || 'used';
  const [group, setGroup] = useState(first);
  const list = sortViews(filterViews(views, { group }), 'recent');
  const labels = { used: 'נוצלו', expired: 'פג תוקף', archived: 'בארכיון' };
  const options = Object.keys(labels).map((g) => ({ value: g, label: `${labels[g]} (${counts[g]})` }));

  return html`<div>
    <${TopBar} title="לא פעילים" back=${() => goBack()} />
    <main class="screen no-tabs">
      <div style=${{ marginBottom: '14px' }}><${Segmented} inline label="סינון" options=${options} value=${group} onChange=${setGroup} /></div>
      ${group === 'expired' && list.length > 0 && html`<p class="muted small" style=${{ margin: '0 4px 12px' }}>לפעמים חנויות מכבדות זיכוי גם אחרי התאריך. שווה לשאול לפני שמוחקים.</p>`}
      ${list.length ? html`<div class="cards">${list.map((v) => html`<${CardItem} key=${v.id} view=${v} members=${members} />`)}</div>`
        : html`<${Empty} icon="archive" title="אין כאן כלום" />`}
    </main>
  </div>`;
}

export function TrashScreen() {
  const store = useStore();
  const { members } = store.snapshot();
  const list = sortViews(filterViews(store.views(), { group: 'trash' }), 'recent');

  async function empty() {
    if (!await confirmDialog({ title: 'לרוקן את סל המחזור?', text: `${list.length} כרטיסים יימחקו לצמיתות מכל המכשירים.`, confirmLabel: 'מחיקה לצמיתות', danger: true })) return;
    const n = await store.purgeCards(list.map((v) => v.id)).catch(toastError);
    if (n) toast('סל המחזור רוקן');
  }

  return html`<div>
    <${TopBar} title="סל המחזור" back=${() => goBack('/settings')} actions=${list.length > 0 && html`
      <button class="btn sm danger" onClick=${empty}><${Icon} name="trash" />ריקון</button>`} />
    <main class="screen no-tabs">
      ${list.length ? html`<p class="muted small" style=${{ margin: '0 4px 12px' }}>פותחים כרטיס כדי לשחזר אותו.</p>
          <div class="cards">${list.map((v) => html`<${CardItem} key=${v.id} view=${v} members=${members} />`)}</div>`
        : html`<${Empty} icon="trash" title="סל המחזור ריק" />`}
    </main>
  </div>`;
}
