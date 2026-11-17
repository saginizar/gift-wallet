// First run: welcome, names of the household, or joining an existing wallet.

import { html, useState } from '../vendor/preact-htm.js';
import { ctx, useStore, navigate, toast, toastError } from './core.js';
import { Icon, Field, MemberAvatar } from './components.js';
import { JoinForm } from './sync-setup.js';

const FEATURES = [
  ['gift', 'כל הגיפט קארדים, הזיכויים והשוברים במקום אחד'],
  ['clock', 'רואים מה פג בקרוב, ומקבלים תזכורת ביומן'],
  ['scan-barcode', 'ברקוד מוכן להצגה בקופה'],
  ['users', 'משותף לבני הבית, עם היסטוריה של מי מימש מה'],
  ['wifi-off', 'עובד גם בלי אינטרנט. הנתונים נשמרים אצלכם'],
];

function Welcome({ onStart, onJoin }) {
  return html`<div class="welcome">
    <img class="logo" src="icons/icon-192.png" alt="" />
    <div class="stack-sm">
      <h1>ארנק המתנות של הבית</h1>
      <p class="lead">לא לשכוח יותר זיכוי במגירה או גיפט קארד שפג.</p>
    </div>
    <div class="features">
      ${FEATURES.map(([icon, text]) => html`<div class="feature"><span class="ic"><${Icon} name=${icon} /></span>${text}</div>`)}
    </div>
    <div class="bottom">
      <button class="btn primary block" onClick=${onStart}>מתחילים</button>
      <button class="btn block" onClick=${onJoin}><${Icon} name="users" />הצטרפות לארנק שכבר קיים</button>
    </div>
  </div>`;
}

function Names({ onBack }) {
  const [me, setMe] = useState('');
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  async function done(e) {
    e.preventDefault();
    if (!me.trim()) return;
    setBusy(true);
    try {
      const m = await ctx.store.addMember(me);
      if (other.trim()) await ctx.store.addMember(other);
      await ctx.store.setMe(m.id);
      await ctx.store.setKV('onboarded', true);
      navigate('/', { replace: true });
    } catch (err) {
      setBusy(false);
      toastError(err);
    }
  }
  return html`<form class="welcome" onSubmit=${done}>
    <button type="button" class="icon-btn soft" aria-label="חזרה" onClick=${onBack}><${Icon} name="arrow-right" /></button>
    <div class="stack-sm">
      <h1>מי משתמש בארנק?</h1>
      <p class="lead">השמות מופיעים בהיסטוריה, כדי לדעת מי הוסיף ומי מימש.</p>
    </div>
    <${Field} label="איך קוראים לך?" id="ob-me">
      <input id="ob-me" autocomplete="given-name" maxlength="30" value=${me} onInput=${(e) => setMe(e.currentTarget.value)} enterkeyhint="next" />
    </${Field}>
    <${Field} label="ומי עוד בבית? (לא חובה)" hint="אפשר להוסיף גם אחר כך, בהגדרות" id="ob-other">
      <input id="ob-other" maxlength="30" value=${other} onInput=${(e) => setOther(e.currentTarget.value)} enterkeyhint="done" />
    </${Field}>
    <div class="bottom">
      <button class="btn primary block" disabled=${busy || !me.trim()}>יאללה</button>
    </div>
  </form>`;
}

// After joining: pick which household member this device belongs to.
function Who() {
  const store = useStore();
  const { members } = store.snapshot();
  const [name, setName] = useState('');
  async function pick(id) {
    await store.setMe(id);
    await store.setKV('onboarded', true);
    navigate('/', { replace: true });
  }
  async function addSelf(e) {
    e.preventDefault();
    if (!name.trim()) return;
    const m = await store.addMember(name);
    await pick(m.id);
    toast(`שלום ${m.name}`);
  }
  return html`<div class="welcome">
    <div class="stack-sm">
      <h1>מחוברים!</h1>
      <p class="lead">מי משתמש בטלפון הזה?</p>
    </div>
    ${members.length > 0 && html`<div class="panel">
      ${members.map((m) => html`<button class="prow" onClick=${() => pick(m.id)}><${MemberAvatar} member=${m} /><span class="v">${m.name}</span><${Icon} name="chevron-left" class="chev" /></button>`)}
    </div>`}
    <form class="stack" onSubmit=${addSelf}>
      <${Field} label=${members.length ? 'או שם חדש' : 'איך קוראים לך?'} id="ob-name">
        <input id="ob-name" maxlength="30" value=${name} onInput=${(e) => setName(e.currentTarget.value)} />
      </${Field}>
      <button class="btn block" disabled=${!name.trim()}>המשך</button>
    </form>
  </div>`;
}

export function Onboarding({ joinCode = '' }) {
  const [step, setStep] = useState(joinCode ? 'join' : 'welcome');
  if (step === 'names') return html`<${Names} onBack=${() => setStep('welcome')} />`;
  if (step === 'who') return html`<${Who} />`;
  if (step === 'join') {
    return html`<div class="welcome">
      <button type="button" class="icon-btn soft" aria-label="חזרה" onClick=${() => setStep('welcome')}><${Icon} name="arrow-right" /></button>
      <div class="stack-sm">
        <h1>הצטרפות לארנק</h1>
        <p class="lead">מחברים את המכשיר הזה לארנק שכבר פועל בטלפון אחר.</p>
      </div>
      <${JoinForm} initial=${joinCode} onJoined=${() => setStep('who')} />
    </div>`;
  }
  return html`<${Welcome} onStart=${() => setStep('names')} onJoin=${() => setStep('join')} />`;
}

// Opening a pairing link on a device that is already set up.
export function JoinExisting({ code }) {
  const configured = ctx.sync.configured();
  const [done, setDone] = useState(false);
  if (done) return html`<${Who} />`;
  return html`<div class="welcome">
    <div class="stack-sm">
      <h1>הצטרפות לארנק משותף</h1>
      <p class="lead">${configured ? 'המכשיר הזה כבר מחובר לארנק. הצטרפות לארנק אחר תחליף את החיבור הקיים.' : 'הכרטיסים שכבר במכשיר הזה יתמזגו לארנק המשותף.'}</p>
    </div>
    <${JoinForm} initial=${code} onJoined=${() => setDone(true)} />
    <button class="btn ghost block" onClick=${() => navigate('/', { replace: true })}>לא עכשיו</button>
  </div>`;
}
