// Browser integration: clipboard, sharing, downloads, install prompt, screen wake lock,
// persistent storage and the service worker update flow.

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = () => /android/i.test(navigator.userAgent);
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers that refuse the async clipboard outside a secure context.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

export async function readClipboard() {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

export const canShare = () => typeof navigator.share === 'function';

export async function shareText({ title, text, url }) {
  if (!canShare()) return false;
  try {
    await navigator.share({ title, text, url });
    return true;
  } catch (e) {
    return e?.name === 'AbortError' ? 'cancelled' : false;
  }
}

export function downloadFile(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// Shares a file where the OS supports it (lets iOS hand an .ics to Calendar), else downloads.
export async function shareOrDownload(name, content, type) {
  try {
    const file = new File([content], name, { type });
    if ((isIOS() || isAndroid()) && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    }
  } catch (e) {
    if (e?.name === 'AbortError') return 'cancelled';
  }
  downloadFile(name, content, type);
  return 'downloaded';
}

// Some iOS versions fire `change` only for inputs that are in the document.
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    const done = (file) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => done(input.files?.[0] || null));
    input.addEventListener('cancel', () => done(null));
    document.body.appendChild(input);
    input.click();
  });
}

export async function keepScreenOn() {
  try {
    const lock = await navigator.wakeLock?.request('screen');
    return () => lock?.release().catch(() => {});
  } catch {
    return () => {};
  }
}

export async function requestPersistentStorage() {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) || false;
  } catch {
    return false;
  }
}

// Android/desktop Chrome hand us an install prompt; iOS only installs via the Share menu.
let installEvent = null;
const installListeners = new Set();
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  installListeners.forEach((fn) => fn(true));
});
window.addEventListener('appinstalled', () => {
  installEvent = null;
  installListeners.forEach((fn) => fn(false));
});
export const canPromptInstall = () => !!installEvent;
export function onInstallAvailability(fn) {
  installListeners.add(fn);
  return () => installListeners.delete(fn);
}
export async function promptInstall() {
  if (!installEvent) return false;
  installEvent.prompt();
  const choice = await installEvent.userChoice.catch(() => null);
  installEvent = null;
  installListeners.forEach((fn) => fn(false));
  return choice?.outcome === 'accepted';
}

// Service worker: registers, and reports when a new version is waiting.
export function registerServiceWorker(onUpdate) {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  // Reload only for an update the user accepted. On the very first visit the worker also
  // takes control (clients.claim), and reloading then would throw away what the user typed.
  let updateAccepted = false;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const notify = (worker) => {
      if (worker && navigator.serviceWorker.controller) {
        onUpdate(() => {
          updateAccepted = true;
          worker.postMessage('skip-waiting');
        });
      }
    };
    if (reg.waiting) notify(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') notify(worker);
      });
    });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !updateAccepted) return;
    reloaded = true;
    location.reload();
  });
}

export function applyTheme(pref) {
  try { localStorage.setItem('gw-theme', pref); } catch { /* ignore */ }
  const dark = pref === 'dark' || (pref === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f0e16' : '#f4f3f9');
}

export function vibrate(ms = 12) {
  try { navigator.vibrate?.(ms); } catch { /* ignore */ }
}
