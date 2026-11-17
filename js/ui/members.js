// Household members: add/rename sheet and the "who is using this device" picker.

import { html, useState, useRef, useEffect } from '../vendor/preact-htm.js';
import { ctx, toast, toastError } from './core.js';
import { Icon, Field, MemberAvatar, openSheet } from './components.js';

function NameBody({ member, close }) {
  const [name, setName] = useState(member?.name || '');
  const ref = useRef();
  useEffect(() => {
    const t = setTimeout(() => ref.current?.focus(), 250);
    return () => clearTimeout(t);
  }, []);
  async function save(e) {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    try {
      const result = member ? await ctx.store.renameMember(member.id, clean) : await ctx.store.addMember(clean);
      close(result);
    } catch (err) {
      toastError(err);
    }
  }
  return html`<form class="form" onSubmit=${save}>
    <${Field} label="שם" id="member-name">
      <input id="member-name" ref=${ref} maxlength="30" autocomplete="given-name" value=${name} onInput=${(e) => setName(e.currentTarget.value)} />
    </${Field}>
    <button class="btn primary block" disabled=${!name.trim()}><${Icon} name="check" />שמירה</button>
  </form>`;
}

export function openMemberSheet(member) {
  return openSheet(member ? 'שינוי שם' : 'הוספה לבני הבית', NameBody, { member });
}

function WhoBody({ close, allowAdd = true }) {
  const { members } = ctx.store.snapshot();
  const me = ctx.store.me();
  async function choose(id) {
    await ctx.store.setMe(id);
    close(id);
  }
  async function add() {
    await close();
    const m = await openMemberSheet();
    if (m) {
      await ctx.store.setMe(m.id);
      toast(`שלום ${m.name}`);
    }
  }
  return html`<div class="panel" style=${{ marginBottom: 0 }}>
    ${members.map((m) => html`<button class="prow" onClick=${() => choose(m.id)}>
      <${MemberAvatar} member=${m} /><span class="v">${m.name}</span>${m.id === me && html`<${Icon} name="check" />`}
    </button>`)}
    ${allowAdd && html`<button class="prow" onClick=${add}><${Icon} name="user-plus" /><span class="v">מישהו אחר</span></button>`}
  </div>`;
}

export function openWhoSheet() {
  return openSheet('מי משתמש במכשיר הזה?', WhoBody);
}
