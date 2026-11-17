// Entry point: opens local storage, starts the sync engine and renders the app.

import { html, render } from './vendor/preact-htm.js';
import { createIDBStorage } from './lib/db.js';
import { createStore } from './lib/store.js';
import { createSync } from './lib/sync.js';
import { applyTheme, registerServiceWorker, requestPersistentStorage } from './lib/platform.js';
import { ctx, toast } from './ui/core.js';
import { consumeShareTarget } from './ui/paste.js';
import { App } from './ui/app.js';

const root = document.getElementById('app');

function fatal(message) {
  root.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'boot';
  box.innerHTML = '<div class="center" style="padding:24px"><h2 style="margin-bottom:8px">לא הצלחנו לפתוח את הארנק</h2><p class="muted"></p></div>';
  box.querySelector('p').textContent = message;
  root.appendChild(box);
}

async function start() {
  if (!('indexedDB' in window)) {
    fatal('הדפדפן הזה לא תומך בשמירת נתונים. נסו Chrome או Safari, לא במצב גלישה בסתר.');
    return;
  }
  const store = createStore({ storage: createIDBStorage() });
  try {
    await store.load();
  } catch (e) {
    fatal('הדפדפן חסם את שמירת הנתונים (אולי מצב גלישה בסתר).');
    return;
  }

  const appUrl = location.origin + location.pathname.replace(/index\.html$/, '');
  const sync = createSync({ store, isOnline: () => navigator.onLine, appUrl });
  Object.assign(ctx, { store, sync, appUrl });
  // The end-to-end test drives sync directly when the app runs on this computer.
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') window.__gw = ctx;

  applyTheme(store.settings().theme || 'auto');
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme(store.settings().theme || 'auto'));

  consumeShareTarget();
  render(html`<${App} />`, root);

  // Local changes sync shortly after they happen; we also sync when the app comes back
  // to the foreground, when the network returns, and every 30 seconds while open.
  store.subscribe(({ local }) => {
    if (local) sync.schedule();
  });
  window.addEventListener('online', () => sync.syncNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync.syncNow();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') sync.syncNow();
  }, 30000);
  sync.syncNow();

  registerServiceWorker((activate) => {
    toast('יש גרסה חדשה של האפליקציה', { action: 'עדכון', onAction: activate, duration: 15000 });
  });
  if (store.snapshot().cards.length) requestPersistentStorage();
}

start();
