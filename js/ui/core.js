// UI plumbing shared by every screen: the app context, store/sync hooks, the hash
// router, overlays (sheets and dialogs that the Android back button closes) and toasts.

import { useEffect, useReducer, useState } from '../vendor/preact-htm.js';

export const ctx = { store: null, sync: null, appUrl: '' };

export function useStore() {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => ctx.store.subscribe(() => force()), []);
  return ctx.store;
}

export function useSyncState() {
  const [state, setState] = useState(ctx.sync.state);
  useEffect(() => ctx.sync.subscribe(setState), []);
  return state;
}

// ------------------------------------------------------------------ router

export function parseHash(hash = location.hash) {
  const raw = hash.replace(/^#/, '');
  if (raw.startsWith('join=')) return { name: 'join', params: { code: raw.slice(5) }, path: raw };
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const q = Object.fromEntries(new URLSearchParams(query));
  const route = (name, params = {}) => ({ name, params: { ...q, ...params }, path });
  switch (parts[0]) {
    case 'card': return route('card', { id: parts[1] });
    case 'add': return route('add');
    case 'edit': return route('edit', { id: parts[1] });
    case 'history': return route('history');
    case 'settings': return route(parts[1] ? `settings/${parts[1]}` : 'settings');
    case 'archive': return route('archive');
    case 'trash': return route('trash');
    default: return route('wallet');
  }
}

const routeListeners = new Set();
let visit = 0;
const emitRoute = () => {
  visit++;
  routeListeners.forEach((fn) => fn());
};
window.addEventListener('hashchange', emitRoute);
window.addEventListener('popstate', emitRoute);

export function useRoute() {
  const [route, setRoute] = useState(() => ({ ...parseHash(), visit }));
  useEffect(() => {
    const on = () => setRoute({ ...parseHash(), visit });
    routeListeners.add(on);
    return () => routeListeners.delete(on);
  }, []);
  return route;
}

const depth = () => history.state?.gwDepth || 0;

// In-app navigation records its depth so "back" can tell whether the previous entry is
// still inside the app (for deep links from an email or calendar it is not).
export function navigate(path, { replace = false } = {}) {
  const hash = `#${path.replace(/^#/, '')}`;
  if (overlays.length) {
    // Navigating from inside a sheet: drop the sheets and reuse the sheet's history
    // entry, so "back" returns to the screen the sheet was opened on.
    const open = overlays.splice(0);
    emitOverlays();
    open.forEach((o) => o.resolve(undefined));
    history.replaceState({ gwDepth: depth() + (replace ? 0 : 1) }, '', hash);
  } else if (replace) {
    history.replaceState({ gwDepth: depth() }, '', hash);
  } else {
    history.pushState({ gwDepth: depth() + 1 }, '', hash);
  }
  window.scrollTo(0, 0);
  emitRoute();
}

// Returns to the root entry (the wallet) instead of stacking another copy of it.
export function goHome() {
  const d = depth();
  if (d > 0 && !overlays.length) history.go(-d);
  else navigate('/', { replace: true });
}

export function goBack(fallback = '/') {
  if (depth() > 0) history.back();
  else navigate(fallback, { replace: true });
}

// ------------------------------------------------------------------ overlays

const overlays = [];
const overlayListeners = new Set();
let overlaySeq = 0;
let pendingPop = null;

const emitOverlays = () => overlayListeners.forEach((fn) => fn([...overlays]));

export function useOverlays() {
  const [list, setList] = useState([...overlays]);
  useEffect(() => {
    overlayListeners.add(setList);
    return () => overlayListeners.delete(setList);
  }, []);
  return list;
}

// Opens a sheet/dialog. `render(close)` returns its content; the promise resolves with
// the value passed to close() once the browser history has settled.
export function openOverlay(render, { kind = 'sheet', dismissible = true } = {}) {
  return new Promise((resolve) => {
    const id = ++overlaySeq;
    overlays.push({ id, render, resolve, kind, dismissible });
    history.pushState({ ...(history.state || {}), gwOverlay: id }, '');
    emitOverlays();
  });
}

// Resolves once the overlay's history entry is gone, so the caller can safely open
// another overlay or navigate right after.
export function closeOverlay(id, value) {
  return new Promise((done) => {
    const idx = overlays.findIndex((o) => o.id === id);
    if (idx < 0) return done();
    const [o] = overlays.splice(idx, 1);
    emitOverlays();
    if (history.state?.gwOverlay === id) {
      pendingPop = () => {
        o.resolve(value);
        done();
      };
      history.back();
    } else {
      o.resolve(value);
      done();
    }
  });
}

window.addEventListener('popstate', (e) => {
  if (pendingPop) {
    const done = pendingPop;
    pendingPop = null;
    done();
    return;
  }
  // Hardware/browser back: close the top overlay instead of leaving the screen.
  const top = overlays[overlays.length - 1];
  if (top && e.state?.gwOverlay !== top.id) {
    overlays.pop();
    emitOverlays();
    top.resolve(undefined);
  }
});

// ------------------------------------------------------------------ toasts

const toasts = [];
const toastListeners = new Set();
let toastSeq = 0;
const emitToasts = () => toastListeners.forEach((fn) => fn([...toasts]));

export function useToasts() {
  const [list, setList] = useState([...toasts]);
  useEffect(() => {
    toastListeners.add(setList);
    return () => toastListeners.delete(setList);
  }, []);
  return list;
}

export function dismissToast(id) {
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) {
    toasts.splice(i, 1);
    emitToasts();
  }
}

export function toast(message, { action, onAction, error = false, duration = 3000 } = {}) {
  const id = ++toastSeq;
  // One toast at a time: a new message replaces the previous one.
  toasts.splice(0, toasts.length, { id, message, action, onAction, error });
  emitToasts();
  setTimeout(() => dismissToast(id), action ? Math.max(duration, 6000) : duration);
  return id;
}

export function toastError(e) {
  toast(e?.message && /[א-ת]/.test(e.message) ? e.message : 'משהו השתבש. נסו שוב.', { error: true });
}
