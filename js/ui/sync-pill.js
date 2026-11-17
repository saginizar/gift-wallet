// Compact sync status for the top bar. Tapping it syncs now (or opens the sync page).

import { html } from '../vendor/preact-htm.js';
import { ctx, useSyncState, navigate } from './core.js';
import { Icon } from './components.js';

export function syncStatusText(state) {
  if (!ctx.sync.configured()) return { text: 'לא מסונכרן', icon: 'cloud-off', cls: 'off' };
  switch (state.status) {
    case 'syncing': return { text: 'מסנכרן…', icon: 'loader', cls: '', spin: true };
    case 'offline': return { text: 'לא מקוון', icon: 'wifi-off', cls: 'off' };
    case 'error': return { text: 'שגיאת סנכרון', icon: 'alert', cls: 'err' };
    default: return { text: 'מסונכרן', icon: 'cloud', cls: 'ok' };
  }
}

export function SyncPill() {
  const state = useSyncState();
  if (!ctx.sync.configured()) return null;
  const s = syncStatusText(state);
  const onClick = () => (state.status === 'error' ? navigate('/settings/sync') : ctx.sync.syncNow());
  return html`<button class=${`sync-pill ${s.cls}`} onClick=${onClick} aria-label=${`סטטוס סנכרון: ${s.text}`}>
    <${Icon} name=${s.icon} class=${s.spin ? 'spin' : ''} />${s.text}
  </button>`;
}
