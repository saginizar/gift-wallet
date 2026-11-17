// Root component: picks the screen for the current route and renders the tab bar,
// the add button and the overlay/toast hosts.

import { html, useEffect, useMemo } from '../vendor/preact-htm.js';
import { ctx, useStore, useRoute, useSyncState, navigate, goHome, toast } from './core.js';
import { Icon, OverlayHost, ToastHost } from './components.js';
import { summarize } from '../lib/model.js';
import { parsePairingCode } from '../lib/sync.js';
import { Wallet } from './wallet.js';
import { CardDetail } from './card-detail.js';
import { CardForm } from './card-form.js';
import { HistoryScreen } from './history.js';
import { SettingsScreen } from './settings.js';
import { SyncScreen, RemindersScreen } from './sync-setup.js';
import { ArchiveScreen, TrashScreen } from './archive.js';
import { Onboarding, JoinExisting } from './onboarding.js';

const TABS = [
  { route: 'wallet', path: '/', label: 'ארנק', icon: 'wallet' },
  { route: 'history', path: '/history', label: 'היסטוריה', icon: 'history' },
  { route: 'settings', path: '/settings', label: 'הגדרות', icon: 'settings' },
];

function TabBar({ active }) {
  const store = useStore();
  const sync = useSyncState();
  const urgent = summarize(store.views()).urgentCount;
  const syncProblem = ctx.sync.configured() && sync.status === 'error';
  return html`<nav class="tabbar" aria-label="ניווט">
    ${TABS.map((t) => html`<a href=${`#${t.path}`} class=${active === t.route ? 'active' : ''} aria-current=${active === t.route ? 'page' : undefined}
        onClick=${(e) => {
          e.preventDefault();
          if (active === t.route) return;
          if (t.route === 'wallet') goHome();
          else navigate(t.path, { replace: active !== 'wallet' });
        }}>
      <${Icon} name=${t.icon} />
      ${t.label}
      ${t.route === 'wallet' && urgent > 0 && html`<span class="dot" aria-label=${`${urgent} פגים השבוע`}>${urgent}</span>`}
      ${t.route === 'settings' && syncProblem && html`<span class="dot" aria-label="בעיית סנכרון">!</span>`}
    </a>`)}
  </nav>`;
}

function Screen({ route }) {
  switch (route.name) {
    case 'card': return html`<${CardDetail} key=${route.params.id} id=${route.params.id} />`;
    case 'add': return html`<${CardForm} key=${`add-${route.visit}`} />`;
    case 'edit': return html`<${CardForm} key=${`edit-${route.params.id}`} id=${route.params.id} />`;
    case 'history': return html`<${HistoryScreen} />`;
    case 'settings': return html`<${SettingsScreen} />`;
    case 'settings/sync': return html`<${SyncScreen} />`;
    case 'settings/reminders': return html`<${RemindersScreen} />`;
    case 'archive': return html`<${ArchiveScreen} />`;
    case 'trash': return html`<${TrashScreen} />`;
    default: return html`<${Wallet} />`;
  }
}

export function App() {
  const store = useStore();
  const route = useRoute();
  // Members alone do not mean this device is set up: right after joining, the household's
  // members have synced in but the user has not yet said which one they are.
  const onboarded = !!store.kv.onboarded || (!!store.kv.me && store.snapshot().members.length > 0);

  // A pairing link for the wallet this device is already on needs no confirmation.
  // Decided once per link: while a join runs, the saved connection starts to match the
  // link and must not cut the join flow short.
  const joinCode = route.name === 'join' ? decodeURIComponent(route.params.code || '') : '';
  const alreadyJoined = useMemo(() => {
    if (!joinCode) return false;
    const cfg = store.kv.sync;
    const parsed = parsePairingCode(joinCode);
    return !!(parsed && cfg && cfg.url === parsed.url && cfg.key === parsed.key);
  }, [joinCode]);
  useEffect(() => {
    if (alreadyJoined) {
      navigate('/', { replace: true });
      toast('המכשיר כבר מחובר לארנק הזה');
    }
  }, [alreadyJoined]);

  let body;
  if (!onboarded) body = html`<${Onboarding} joinCode=${joinCode} />`;
  else if (route.name === 'join' && !alreadyJoined) body = html`<${JoinExisting} code=${joinCode} />`;
  else {
    const tab = TABS.find((t) => t.route === route.name);
    body = html`
      <${Screen} route=${route} />
      ${tab && html`<${TabBar} active=${tab.route} />`}
      ${route.name === 'wallet' && html`<button class="fab" aria-label="הוספת כרטיס" onClick=${() => navigate('/add')}><${Icon} name="plus" /></button>`}`;
  }

  return html`<div class="shell">${body}</div><${OverlayHost} /><${ToastHost} />`;
}
