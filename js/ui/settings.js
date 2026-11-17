// Settings: household, sync, reminders, backup, appearance, install help, about.

import { html, useEffect, useState } from '../vendor/preact-htm.js';
import { ctx, useStore, useSyncState, navigate, toast, toastError } from './core.js';
import { Icon, TopBar, MemberAvatar, confirmDialog, openSheet, Segmented } from './components.js';
import { summarize, GROUPS } from '../lib/model.js';
import { buildBackup, parseBackup, restoreBackup, buildCSV, backupFileName } from '../lib/backup.js';
import { buildICS } from '../lib/reminders.js';
import { formatDateTime } from '../lib/dates.js';
import { shareOrDownload, pickFile, applyTheme, isStandalone, isIOS, canPromptInstall, promptInstall, onInstallAvailability, requestPersistentStorage } from '../lib/platform.js';
import { syncStatusText } from './sync-pill.js';
import { openMemberSheet, openWhoSheet } from './members.js';
import { openPairingSheet } from './sync-setup.js';
import { APP_VERSION } from '../version.js';

const link = (path) => (e) => {
  e.preventDefault();
  navigate(path);
};

function InstallHelp() {
  const ios = isIOS();
  return html`<div class="stack">
    ${ios ? html`<ol class="steps">
        <li><div class="stack-sm">פותחים את האפליקציה ב-<b>Safari</b> (לא בתוך וואטסאפ או אינסטגרם).</div></li>
        <li><div class="stack-sm">לוחצים על כפתור <b>השיתוף</b> (ריבוע עם חץ למעלה).</div></li>
        <li><div class="stack-sm">בוחרים <b>הוספה למסך הבית</b> ואז <b>הוספה</b>.</div></li>
      </ol>
      <p class="muted small">חשוב: ב-iPhone אפליקציה שהותקנה שומרת נתונים בנפרד מ-Safari. אחרי ההתקנה פותחים אותה ממסך הבית, ואם צריך מצרפים אותה לארנק עם קוד הצירוף.</p>`
      : html`<ol class="steps">
        <li><div class="stack-sm">פותחים את האפליקציה ב-<b>Chrome</b>.</div></li>
        <li><div class="stack-sm">בתפריט <b>⋮</b> בוחרים <b>התקנת האפליקציה</b> או <b>הוספה למסך הבית</b>.</div></li>
      </ol>`}
  </div>`;
}

export function SettingsScreen() {
  const store = useStore();
  const sync = useSyncState();
  const [installable, setInstallable] = useState(canPromptInstall());
  const [persisted, setPersisted] = useState(null);
  const { members } = store.snapshot();
  const me = members.find((m) => m.id === store.me());
  const settings = store.settings();
  const counts = summarize(store.views()).counts;
  const status = syncStatusText(sync);
  const reminders = store.householdSetting('reminders');

  useEffect(() => onInstallAvailability(setInstallable), []);
  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(false));
  }, []);

  async function exportBackup() {
    try {
      const backup = await buildBackup(store, { includePhotos: true });
      await shareOrDownload(backupFileName('json'), JSON.stringify(backup), 'application/json');
    } catch (e) {
      toastError(e);
    }
  }

  async function importBackup() {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    try {
      const data = parseBackup(await file.text());
      const cards = data.records.filter((r) => r.kind === 'card' && !r.deleted).length;
      if (!await confirmDialog({ title: 'שחזור מגיבוי', text: `בגיבוי ${cards} כרטיסים. הם יתמזגו עם מה שכבר יש כאן; שינויים חדשים יותר לא יידרסו.`, confirmLabel: 'שחזור' })) return;
      const res = await restoreBackup(store, data);
      toast(`שוחזרו ${res.merged} רשומות${res.photos ? ` ו-${res.photos} תמונות` : ''}`);
      ctx.sync.schedule(500);
    } catch (e) {
      toastError(e);
    }
  }

  async function exportCSV() {
    await shareOrDownload(backupFileName('csv'), buildCSV(store.views(), members), 'text/csv');
  }

  async function exportCalendar() {
    const views = store.views().filter((v) => GROUPS.active(v) && v.card.expiry);
    if (!views.length) return toast('אין כרטיסים פעילים עם תאריך תפוגה');
    const res = await shareOrDownload('gift-wallet-expiry.ics', buildICS(views, { appUrl: ctx.appUrl, reminderDays: store.reminderDays() }), 'text/calendar');
    if (res === 'downloaded') toast(`ירד קובץ עם ${views.length} תאריכים. פותחים אותו כדי להוסיף ליומן`);
  }

  async function setTheme(theme) {
    await store.updateSettings({ theme });
    applyTheme(theme);
  }

  async function resetDevice() {
    const synced = ctx.sync.configured();
    // Push what is still waiting first, so "the data stays in sync" is actually true.
    if (synced) await ctx.sync.syncNow();
    const pending = synced && ctx.sync.hasUnsynced();
    const ok = await confirmDialog({
      title: 'למחוק את כל הנתונים מהמכשיר?',
      text: !synced ? 'אין סנכרון, ולכן כל הכרטיסים יימחקו לצמיתות. כדאי לייצא גיבוי קודם.'
        : pending ? 'יש שינויים מהמכשיר הזה שעוד לא הגיעו לסנכרון (אולי אין חיבור), והם יאבדו. כדאי לחכות לחיבור או לייצא גיבוי קודם.'
          : 'הנתונים יישארו בסנכרון ובמכשירים האחרים. אפשר להצטרף שוב עם קוד צירוף.',
      confirmLabel: 'מחיקה מהמכשיר',
      danger: true,
    });
    if (!ok) return;
    await ctx.sync.disconnect();
    await store.wipe();
    navigate('/', { replace: true });
    toast('המכשיר אופס');
  }

  return html`<div>
    <${TopBar} title="הגדרות" />
    <main class="screen">
      <section class="panel">
        <h3>בני הבית</h3>
        ${members.map((m) => html`<button class="prow" key=${m.id} onClick=${() => openMemberSheet(m)}>
          <${MemberAvatar} member=${m} /><span class="v">${m.name}${m.id === me?.id ? ' (אני)' : ''}</span><${Icon} name="pencil" class="chev" />
        </button>`)}
        <button class="prow" onClick=${() => openMemberSheet()}><${Icon} name="user-plus" /><span class="v">הוספה לבני הבית</span></button>
        ${members.length > 1 && html`<button class="prow" onClick=${() => openWhoSheet()}>
          <${Icon} name="smartphone" /><span class="k">במכשיר הזה</span><span class="v">${me?.name || 'לא נבחר'}</span><${Icon} name="chevron-left" class="chev" />
        </button>`}
      </section>

      <section class="panel">
        <h3>סנכרון בין מכשירים</h3>
        <a class="prow" href="#/settings/sync" onClick=${link('/settings/sync')}>
          <${Icon} name=${status.icon} />
          <span class="v">${ctx.sync.configured() ? status.text : 'הגדרת סנכרון עם בן או בת הזוג'}</span>
          ${sync.lastSyncAt && html`<span class="k small">${formatDateTime(sync.lastSyncAt).split(' ')[1]}</span>`}
          <${Icon} name="chevron-left" class="chev" />
        </a>
        ${ctx.sync.configured() && html`<button class="prow" onClick=${() => openPairingSheet()}><${Icon} name="qr-code" /><span class="v">חיבור מכשיר נוסף</span></button>`}
      </section>

      <section class="panel">
        <h3>תזכורות</h3>
        <label class="prow">
          <${Icon} name="clock" /><span class="v">להציג "פג בקרוב" כשנשארו</span>
          <select class="input" style=${{ width: 'auto', minHeight: '40px' }} value=${settings.soonDays} onChange=${(e) => store.updateSettings({ soonDays: Number(e.currentTarget.value) })}>
            ${[14, 30, 45, 60, 90].map((d) => html`<option value=${d}>${d} ימים</option>`)}
          </select>
        </label>
        <button class="prow" onClick=${exportCalendar}><${Icon} name="calendar-plus" /><span class="v">כל תאריכי התפוגה ליומן</span></button>
        <a class="prow" href="#/settings/reminders" onClick=${link('/settings/reminders')}>
          <${Icon} name="mail" /><span class="v">תזכורות במייל</span><span class="k small">${reminders?.enabled ? 'פעיל' : 'כבוי'}</span><${Icon} name="chevron-left" class="chev" />
        </a>
      </section>

      <section class="panel">
        <h3>גיבוי ונתונים</h3>
        <button class="prow" onClick=${exportBackup}><${Icon} name="download" /><span class="v">ייצוא גיבוי (כולל תמונות)</span></button>
        <button class="prow" onClick=${importBackup}><${Icon} name="upload" /><span class="v">שחזור מגיבוי</span></button>
        <button class="prow" onClick=${exportCSV}><${Icon} name="file-spreadsheet" /><span class="v">ייצוא לאקסל (CSV)</span></button>
        <a class="prow" href="#/trash" onClick=${link('/trash')}><${Icon} name="trash" /><span class="v">סל המחזור</span><span class="k small">${counts.trash || ''}</span><${Icon} name="chevron-left" class="chev" /></a>
      </section>

      <section class="panel">
        <h3>תצוגה</h3>
        <div style=${{ padding: '8px 16px 16px' }}>
          <${Segmented} inline label="ערכת צבעים" value=${settings.theme || 'auto'} onChange=${setTheme}
            options=${[{ value: 'auto', label: 'אוטומטי', icon: 'smartphone' }, { value: 'light', label: 'בהיר', icon: 'sun' }, { value: 'dark', label: 'כהה', icon: 'moon' }]} />
        </div>
      </section>

      <section class="panel">
        <h3>התקנה בטלפון</h3>
        ${isStandalone() ? html`<div class="prow"><${Icon} name="check-circle" /><span class="v">האפליקציה מותקנת במכשיר הזה</span></div>`
          : installable ? html`<button class="prow" onClick=${() => promptInstall()}><${Icon} name="smartphone" /><span class="v">התקנת האפליקציה</span></button>`
            : html`<button class="prow" onClick=${() => openSheet('התקנה כאפליקציה', InstallHelp)}><${Icon} name="smartphone" /><span class="v">איך מתקינים במסך הבית</span><${Icon} name="chevron-left" class="chev" /></button>`}
      </section>

      <section class="panel">
        <h3>אודות</h3>
        <div class="prow"><${Icon} name="info" /><span class="v">ארנק מתנות · גרסה ${APP_VERSION}</span></div>
        <button class="prow" onClick=${async () => setPersisted(await requestPersistentStorage())}>
          <${Icon} name="shield-check" /><span class="v">${persisted ? 'הדפדפן לא ימחק את הנתונים אוטומטית' : 'לבקש מהדפדפן לשמור את הנתונים דרך קבע'}</span>
        </button>
        <button class="prow danger" onClick=${resetDevice}><${Icon} name="trash" /><span class="v">מחיקת כל הנתונים מהמכשיר</span></button>
      </section>
    </main>
  </div>`;
}
