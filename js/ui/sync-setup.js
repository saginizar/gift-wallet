// Sync setup (first device / join with a code), pairing another device, and the
// opt-in email reminders page.

import { html, useEffect, useState } from '../vendor/preact-htm.js';
import { ctx, useStore, useSyncState, goBack, navigate, toast, toastError } from './core.js';
import { Icon, TopBar, Banner, Field, Segmented, confirmDialog, openSheet } from './components.js';
import { syncMessage, isValidBackendUrl } from '../lib/sync.js';
import { qrSvg } from '../lib/qr.js';
import { copyText, shareText, canShare } from '../lib/platform.js';
import { formatDateTime } from '../lib/dates.js';
import { syncStatusText } from './sync-pill.js';
import { openWhoSheet } from './members.js';

export function pairingLink() {
  const code = ctx.sync.pairingCode();
  return code ? `${ctx.appUrl}#join=${code}` : null;
}

function PairingBody() {
  const url = pairingLink();
  const code = ctx.sync.pairingCode();
  const [showCode, setShowCode] = useState(false);
  async function share() {
    const res = await shareText({ title: 'הצטרפות לארנק המתנות', text: 'הקישור לחיבור לארנק המתנות שלנו:', url });
    if (!res) copy();
  }
  async function copy() {
    if (await copyText(url)) toast('הקישור הועתק');
  }
  return html`<div class="stack">
    <div class="pairing-qr" dangerouslySetInnerHTML=${{ __html: qrSvg(url, { ecc: 'L', margin: 2 }) }}></div>
    <p class="muted center">בטלפון השני: פותחים את המצלמה, מכוונים לקוד ולוחצים על הקישור.</p>
    <div class="btn-row">
      ${canShare() && html`<button class="btn primary" onClick=${share}><${Icon} name="share" />שליחת קישור</button>`}
      <button class="btn" onClick=${copy}><${Icon} name="copy" />העתקת קישור</button>
    </div>
    <${Banner} icon="lock" tone="warn" title="הקישור הוא המפתח לארנק">
      מי שמקבל אותו יכול לראות ולערוך את כל הכרטיסים. שולחים רק לבן או בת הזוג.
    </${Banner}>
    <p class="muted small">ב-iPhone: אם האפליקציה כבר מותקנת במסך הבית, פותחים אותה, בוחרים "יש לי קוד צירוף" ומדביקים את הקוד.</p>
    ${showCode ? html`<div class="code-field">${code}</div>
        <button class="btn sm" onClick=${async () => { if (await copyText(code)) toast('הקוד הועתק'); }}><${Icon} name="copy" />העתקת הקוד</button>`
      : html`<button class="disclosure" onClick=${() => setShowCode(true)}><${Icon} name="key-round" />הצגת קוד הצירוף</button>`}
  </div>`;
}

export function openPairingSheet() {
  return openSheet('חיבור מכשיר נוסף', PairingBody);
}

function CodeBody() {
  const [code, setCode] = useState(null);
  useEffect(() => {
    fetch('backend/Code.gs').then((r) => (r.ok ? r.text() : '')).then(setCode).catch(() => setCode(''));
  }, []);
  return html`<div class="stack">
    <button class="btn primary block" disabled=${!code} onClick=${async () => { if (await copyText(code)) toast('הקוד הועתק'); }}><${Icon} name="copy" />העתקה</button>
    <pre class="code-field" style=${{ maxHeight: '50vh', overflow: 'auto', whiteSpace: 'pre-wrap' }}>${code === null ? 'טוען…' : code || 'לא הצלחנו לטעון את הקוד'}</pre>
  </div>`;
}

async function copyBackendCode() {
  try {
    const res = await fetch('backend/Code.gs', { cache: 'no-cache' });
    if (!res.ok) throw new Error();
    if (await copyText(await res.text())) toast('הקוד הועתק. מדביקים אותו בעורך של Apps Script');
    else openSheet('קוד השרת', CodeBody);
  } catch {
    openSheet('קוד השרת', CodeBody);
  }
}

function FirstDevice() {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function connect(e) {
    e.preventDefault();
    const clean = url.trim();
    if (!isValidBackendUrl(clean)) return setError('צריך להדביק את הכתובת שמתחת ל-Web app URL: היא מתחילה ב-script.google.com ונגמרת במילה exec.');
    setBusy(true);
    setError('');
    try {
      await ctx.sync.connectNew(clean);
      toast('הסנכרון פעיל');
      openPairingSheet();
    } catch (err) {
      setError(syncMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return html`<form class="stack" onSubmit=${connect}>
    <p class="muted">את שלבים 1 עד 3 עושים פעם אחת, במחשב, עם חשבון Google האישי. לוקח כחמש דקות.</p>
    <ol class="steps">
      <li><div class="stack-sm">
        <span>פותחים גיליון חדש: <a href="https://sheets.new" target="_blank" rel="noopener noreferrer"><bdi>sheets.new</bdi></a>, ונותנים לו שם, למשל "ארנק מתנות".</span>
      </div></li>
      <li><div class="stack-sm">
        <span>בתפריט העליון של הגיליון בוחרים <span class="path"><kbd>Extensions</kbd> › <kbd>Apps Script</kbd></span> (בממשק בעברית: <b>תוספים</b>). מוחקים את מה שכתוב בעורך ומדביקים במקומו את קוד השרת:</span>
        <div class="btn-row">
          <button type="button" class="btn sm primary" onClick=${copyBackendCode}><${Icon} name="copy" />העתקת קוד השרת</button>
          <button type="button" class="btn sm" onClick=${() => openSheet('קוד השרת', CodeBody)}>הצגה</button>
        </div>
        <span class="muted small">ושומרים (<bdi>Ctrl+S</bdi>).</span>
      </div></li>
      <li><div class="stack-sm">
        <span>לוחצים <span class="path"><kbd>Deploy</kbd> › <kbd>New deployment</kbd></span>, ובגלגל השיניים שליד "Select type" בוחרים <span class="path"><kbd>Web app</kbd></span>.</span>
        <span>מגדירים <span class="path">Execute as: <b>Me</b></span> ו-<span class="path">Who has access: <b>Anyone</b></span>.</span>
        <span>לוחצים <span class="path"><kbd>Deploy</kbd></span> ומאשרים את ההרשאות. אם מופיע "Google hasn't verified this app", לוחצים <span class="path"><kbd>Advanced</kbd> › <kbd>Go to … (unsafe)</kbd></span>. זה צפוי: זה הסקריפט שלכם, בחשבון שלכם.</span>
      </div></li>
      <li><div class="stack-sm">
        <span>מעתיקים את הכתובת שמתחת ל-<span class="path">Web app URL</span> (היא מסתיימת ב-<span class="path">/exec</span>) ומדביקים כאן. אפשר לשלוח אותה לטלפון בוואטסאפ ולהדביק שם.</span>
        <${Field} error=${error} id="sync-url">
          <input id="sync-url" class="ltr" dir="ltr" inputmode="url" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec" value=${url} onInput=${(e) => { setUrl(e.currentTarget.value); setError(''); }} />
        </${Field}>
        <button class="btn primary block" disabled=${busy || !url.trim()}>${busy ? html`<${Icon} name="loader" class="spin" />מתחבר…` : html`<${Icon} name="cloud" />חיבור`}</button>
      </div></li>
    </ol>
    <${Banner} icon="shield-check" title="מה Google רואה?">
      רק נתונים מוצפנים. המפתח נוצר בטלפון ונשאר במכשירים שלכם, כך שגם בגיליון עצמו אי אפשר לקרוא קודים, סכומים או שמות.
    </${Banner}>
  </form>`;
}

export function JoinForm({ initial = '', onJoined }) {
  const [code, setCode] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function join(e) {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      await ctx.sync.join(code);
      toast('המכשיר מחובר לארנק');
      onJoined?.();
    } catch (err) {
      setError(syncMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return html`<form class="stack" onSubmit=${join}>
    <p class="muted">במכשיר שכבר מחובר: הגדרות ← חיבור מכשיר נוסף. סורקים את הקוד, או מעתיקים את הקישור ומדביקים כאן.</p>
    <${Field} label="קוד או קישור צירוף" error=${error} id="join-code">
      <textarea id="join-code" class="ltr" dir="ltr" rows="3" autocomplete="off" spellcheck="false" value=${code} onInput=${(e) => { setCode(e.currentTarget.value); setError(''); }}></textarea>
    </${Field}>
    <button class="btn primary block" disabled=${busy || !code.trim()}>${busy ? html`<${Icon} name="loader" class="spin" />מתחבר…` : html`<${Icon} name="users" />הצטרפות`}</button>
  </form>`;
}

export function SyncScreen() {
  const store = useStore();
  const state = useSyncState();
  const [mode, setMode] = useState('first');
  const configured = ctx.sync.configured();
  const status = syncStatusText(state);

  async function disconnect() {
    if (!await confirmDialog({ title: 'לנתק את הסנכרון במכשיר הזה?', text: 'הכרטיסים יישארו במכשיר, אבל שינויים כבר לא יעברו בינו לבין המכשירים האחרים.', confirmLabel: 'ניתוק', danger: true })) return;
    await ctx.sync.disconnect();
    toast('הסנכרון נותק');
  }

  if (!configured) {
    return html`<div>
      <${TopBar} title="סנכרון בין מכשירים" back=${() => goBack('/settings')} />
      <main class="screen no-tabs stack">
        <p>הסנכרון שומר עותק מוצפן של הארנק בגיליון Google שלכם, כדי שכל בני הבית יעבדו על אותו ארנק מהטלפונים שלהם.</p>
        <${Segmented} inline label="איך מתחברים" value=${mode} onChange=${setMode}
          options=${[{ value: 'first', label: 'המכשיר הראשון' }, { value: 'join', label: 'יש לי קוד צירוף' }]} />
        ${mode === 'first' ? html`<${FirstDevice} />` : html`<${JoinForm} onJoined=${() => { if (!store.me() || store.snapshot().members.length > 1) openWhoSheet(); }} />`}
      </main>
    </div>`;
  }

  return html`<div>
    <${TopBar} title="סנכרון בין מכשירים" back=${() => goBack('/settings')} />
    <main class="screen no-tabs">
      ${state.status === 'error' && html`<${Banner} tone="danger" icon="alert" title="הסנכרון נכשל">${syncMessage(state.error)}</${Banner}>`}
      ${state.status === 'offline' && html`<${Banner} tone="warn" icon="wifi-off">${syncMessage(state.error)}</${Banner}>`}
      <section class="panel">
        <div class="prow"><${Icon} name=${status.icon} class=${status.spin ? 'spin' : ''} /><span class="v">${status.text}</span>
          <button class="btn sm" disabled=${state.status === 'syncing'} onClick=${() => ctx.sync.syncNow()}><${Icon} name="refresh-cw" />עכשיו</button>
        </div>
        ${state.lastSyncAt && html`<div class="prow"><span class="k">סנכרון אחרון</span><span class="v">${formatDateTime(state.lastSyncAt)}</span></div>`}
        <button class="prow" onClick=${() => openPairingSheet()}><${Icon} name="qr-code" /><span class="v">חיבור מכשיר נוסף</span><${Icon} name="chevron-left" class="chev" /></button>
      </section>
      <${Banner} icon="shield-check" title="פרטיות">
        בגיליון נשמרים רק נתונים מוצפנים. המפתח נמצא רק במכשירים המחוברים.
        ${store.householdSetting('reminders')?.enabled ? ' תזכורות המייל פעילות, ולכן שם החנות והכותרת, הסכום, התוקף ושל מי הכרטיס נשמרים שם גם בגלוי (בלי קודים).' : ''}
      </${Banner}>
      ${state.error?.code === 'unauthorized' && html`<button class="btn block" style=${{ marginBottom: '12px' }} onClick=${async () => { await ctx.sync.disconnect(); setMode('join'); }}>
        <${Icon} name="key-round" />חיבור מחדש עם קוד צירוף
      </button>`}
      <section class="panel">
        <button class="prow danger" onClick=${disconnect}><${Icon} name="cloud-off" /><span class="v">ניתוק המכשיר מהסנכרון</span></button>
      </section>
    </main>
  </div>`;
}

export function RemindersScreen() {
  const store = useStore();
  const rem = store.householdSetting('reminders') || { enabled: false, emails: [] };
  const [emails, setEmails] = useState((rem.emails || []).join(', '));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const days = store.reminderDays();
  const configured = ctx.sync.configured();

  const parseEmails = () => emails.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);

  async function save(enabled) {
    const list = parseEmails();
    if (enabled && (!list.length || list.some((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))) return setError('צריך כתובת מייל תקינה אחת לפחות');
    setError('');
    await store.setHouseholdSetting('reminders', { ...rem, enabled, emails: list.slice(0, 5), days });
    await ctx.sync.syncNow();
    toast(enabled ? 'תזכורות המייל פעילות' : 'תזכורות המייל כבויות');
  }

  async function test() {
    setBusy(true);
    try {
      await ctx.sync.syncNow();
      const res = await ctx.sync.testReminder();
      toast(`נשלח מייל בדיקה ל-${res.sent} כתובות`);
    } catch (e) {
      toast(syncMessage(e), { error: true });
    } finally {
      setBusy(false);
    }
  }

  const toggleDay = (d) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort((a, b) => b - a);
    if (next.length) store.setHouseholdSetting('reminders', { ...rem, days: next });
  };

  return html`<div>
    <${TopBar} title="תזכורות במייל" back=${() => goBack('/settings')} />
    <main class="screen no-tabs stack">
      ${!configured ? html`<${Banner} icon="cloud-off" title="צריך קודם סנכרון" action=${{ label: 'הגדרת סנכרון', onClick: () => navigate('/settings/sync') }}>
          המיילים נשלחים מחשבון Google שלכם דרך שרת הסנכרון, גם כשאף אחד לא פותח את האפליקציה.
        </${Banner}>`
        : html`
        <p>פעם ביום, ב-9:00, נבדוק אם יש כרטיס שעומד לפוג ונשלח מייל עם רשימה.</p>
        <${Field} label="לאן לשלוח" hint="אפשר כמה כתובות, מופרדות בפסיק" error=${error} id="rem-emails">
          <input id="rem-emails" class="ltr" dir="ltr" type="email" inputmode="email" multiple autocomplete="email" value=${emails} onInput=${(e) => setEmails(e.currentTarget.value)} />
        </${Field}>
        <div class="field">
          <span class="label">כמה זמן לפני</span>
          <div class="quick-picks">
            ${[30, 14, 7, 3, 1].map((d) => html`<button type="button" class=${days.includes(d) ? 'active' : ''} onClick=${() => toggleDay(d)}>${d === 1 ? 'יום' : `${d} ימים`}</button>`)}
          </div>
          <span class="hint">וגם בבוקר של יום התפוגה. אותם ימים משמשים גם להתראות ביומן.</span>
        </div>
        ${rem.enabled
          ? html`<div class="btn-row">
              <button class="btn" onClick=${() => save(true)}><${Icon} name="check" />שמירה</button>
              <button class="btn danger" onClick=${() => save(false)}>כיבוי</button>
            </div>
            <button class="btn outline block" disabled=${busy} onClick=${test}><${Icon} name="mail" />שליחת מייל בדיקה</button>`
          : html`<button class="btn primary block" onClick=${() => save(true)}><${Icon} name="bell" />הפעלת תזכורות</button>`}
        <${Banner} icon="info">
          כדי לשלוח מייל, השרת צריך לדעת מה לכתוב בו. לכן כשהתזכורות פעילות, נשמרת בגיליון רשימה גלויה של שם החנות והכותרת, הסכום, התוקף ושל מי הכרטיס. קודים וקודים סודיים לא נשלחים. ההגדרה משותפת לכל בני הבית.
        </${Banner}>`}
    </main>
  </div>`;
}
