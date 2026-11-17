// End-to-end check in a real browser. Two "phones" share one wallet through the emulated
// sync backend; they use different origins (localhost / 127.0.0.1) so their storage is
// separate, as on two devices. Screenshots go to outputs/e2e/.
//
//   npm run dev                                   (in another terminal)
//   npm install --no-save playwright-core && npm run e2e
//
// Uses the installed Edge or Chrome (E2E_BROWSER=<path to browser exe> to choose).

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(process.env.PLAYWRIGHT_FROM || import.meta.url);
const { chromium } = require('playwright-core');

const PORT = process.env.PORT || 8080;
const A_URL = `http://localhost:${PORT}/`;
const B_URL = `http://127.0.0.1:${PORT}/`;
const BACKEND = `http://localhost:${PORT}/mock-gas/exec`;
const OUT = fileURLToPath(new URL('../outputs/e2e/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const candidates = [
  process.env.E2E_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) throw new Error('No Edge/Chrome found; set E2E_BROWSER');

const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' };
const iso = (d) => d.toISOString().slice(0, 10);
const inDays = (n) => iso(new Date(Date.now() + n * 86400000));
const errors = [];
const pages = [];
let current = '';

function watch(page, name) {
  pages.push([name, page]);
  page.on('pageerror', (e) => errors.push(`${name} ${current}: ${e.message}`));
  page.on('console', (m) => {
    // The browser logs failed requests while a test phone is deliberately offline.
    if (m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(`${name} ${current}: ${m.text()}`);
  });
}

const shot = (page, name) => page.waitForTimeout(450).then(() => page.screenshot({ path: `${OUT}${name}.png` }));
const settle = (page) => page.waitForTimeout(350);

async function step(name, fn) {
  current = name;
  const t = Date.now();
  await fn();
  console.log(`  ok  ${name} (${Date.now() - t} ms)`);
}

async function addCard(page, { type, store, amount, expiry, code }) {
  await page.goto(`${page.url().split('#')[0]}#/add`);
  if (type) await page.getByRole('radio', { name: type }).click();
  await page.locator('#f-store').fill(store);
  if (amount) await page.locator('#f-amount').fill(String(amount));
  if (expiry) await page.locator('#f-expiry').fill(expiry);
  if (code) await page.locator('#f-code').fill(code);
  await page.getByRole('button', { name: 'הוספה לארנק' }).click();
  await page.waitForURL(/#\/card\//);
}

async function openCard(page, store) {
  await page.goto(`${page.url().split('#')[0]}#/`);
  await page.locator('.card-item', { hasText: store }).first().click();
  await page.waitForURL(/#\/card\//);
}

const heroBalance = (page) => page.locator('.hero .balance').innerText();

const browser = await chromium.launch({ executablePath, headless: true, timeout: 30000 });
try {
  await fetch(`http://localhost:${PORT}/mock-gas/reset`, { method: 'POST' }).then((r) => assert.equal(r.status, 200, 'start the server with npm run dev'));

  const ctxA = await browser.newContext(phone);
  const a = await ctxA.newPage();
  watch(a, 'A');

  console.log('Phone A');
  await step('onboarding', async () => {
    await a.goto(A_URL);
    await shot(a, '01-welcome');
    await a.getByRole('button', { name: 'מתחילים' }).click();
    await a.locator('#ob-me').fill('שגיא');
    await a.locator('#ob-other').fill('דנה');
    await a.getByRole('button', { name: 'יאללה' }).click();
    await a.getByText('הארנק עוד ריק').waitFor();
    await shot(a, '02-empty');
  });

  await step('add a gift card with store suggestions', async () => {
    await a.goto(`${A_URL}#/add`);
    await a.locator('#f-store').fill('ביי');
    await a.getByRole('button', { name: 'BuyMe' }).click();
    assert.equal(await a.locator('#f-store').inputValue(), 'BuyMe');
    await a.locator('#f-amount').fill('300');
    await a.locator('#f-expiry').fill(inDays(10));
    await a.locator('#f-code').fill('6001234567890123');
    await shot(a, '03-add-form');
    await a.getByRole('button', { name: 'הוספה לארנק' }).click();
    await a.waitForURL(/#\/card\//);
    assert.match(await heroBalance(a), /300/);
    assert.ok(await a.locator('.barcode-preview svg').count(), 'numeric code shows a barcode preview');
    await shot(a, '04-card');
  });

  await step('record a purchase and undo it', async () => {
    await a.getByRole('button', { name: 'מימוש' }).click();
    await a.locator('#tx-amount').fill('120');
    await a.locator('#tx-note').fill('נעליים לילדים');
    await shot(a, '05-use-sheet');
    await a.getByRole('button', { name: 'שמירה' }).click();
    await a.locator('.toast', { hasText: 'נרשם מימוש' }).waitFor();
    assert.match(await heroBalance(a), /180/);
    await a.locator('.toast button', { hasText: 'ביטול' }).click();
    await settle(a);
    assert.match(await heroBalance(a), /300/);
    await a.getByRole('button', { name: 'מימוש' }).click();
    await a.locator('#tx-amount').fill('120');
    await a.getByRole('button', { name: 'שמירה' }).click();
    await a.locator('.toast', { hasText: 'נרשם מימוש' }).waitFor();
    assert.match(await heroBalance(a), /180/);
  });

  await step('over-spending is refused', async () => {
    await a.getByRole('button', { name: 'מימוש' }).click();
    await a.locator('#tx-amount').fill('500');
    await a.getByRole('button', { name: 'שמירה' }).click();
    await a.getByText(/הסכום גבוה מהיתרה/).waitFor();
    await a.keyboard.press('Escape');
    await a.goBack();
    await settle(a);
    assert.equal(await a.locator('.sheet').count(), 0, 'back button closes the sheet');
  });

  await step('edit details, then Back returns to the list', async () => {
    await a.getByRole('button', { name: 'עריכה' }).click();
    await a.getByRole('button', { name: 'פרטים נוספים' }).click();
    await a.locator('#f-title').fill('מתנה מהעבודה');
    await a.getByRole('button', { name: 'שמירה' }).click();
    await a.locator('.hero .type', { hasText: 'מתנה מהעבודה' }).waitFor();
    await a.getByRole('button', { name: 'חזרה' }).click();
    await a.locator('.card-item', { hasText: 'BuyMe' }).waitFor();
    assert.ok(!/#\/card\//.test(a.url()), 'back from the card goes to the list, not to the same card');
    await openCard(a, 'BuyMe');
  });

  await step('cashier view', async () => {
    await a.getByRole('button', { name: 'הצגה בקופה' }).first().click();
    await a.locator('.cashier .barcode svg').waitFor();
    assert.match(await a.locator('.cashier .code').innerText(), /6001234567890123/);
    await shot(a, '06-cashier');
    await a.getByRole('button', { name: 'QR' }).click();
    await a.locator('.cashier .barcode.qr svg').waitFor();
    await a.locator('.cashier').getByRole('button', { name: 'סגירה' }).click();
    await settle(a);
  });

  await step('paste an SMS', async () => {
    await a.goto(`${A_URL}#/`);
    await a.getByRole('button', { name: 'הדבקת הודעה עם שובר' }).click();
    await a.locator('#paste-text').fill('תודה שקנית בפוקס! זיכוי מספר 98765432 על סך 149.90 ש"ח, בתוקף עד 13.11.2028. לבירורים 03-1234567');
    await a.getByText('קוד: 98765432').waitFor();
    await shot(a, '07-paste');
    await a.getByRole('button', { name: /המשך למילוי/ }).click();
    assert.equal(await a.locator('#f-store').inputValue(), 'Fox');
    assert.equal(await a.locator('#f-amount').inputValue(), '149.90');
    assert.equal(await a.locator('#f-expiry').inputValue(), '2028-11-13');
    await shot(a, '08-prefilled');
    await a.getByRole('button', { name: 'הוספה לארנק' }).click();
    await a.waitForURL(/#\/card\//);
  });

  // Text recognition on the browser-rendered fixtures (scripts/make-ocr-fixtures.mjs).
  const FIXTURES = fileURLToPath(new URL('../tests/fixtures/ocr/', import.meta.url));
  const scan = async (file) => {
    await a.goto(`${A_URL}#/`);
    const chooser = a.waitForEvent('filechooser');
    await a.getByRole('button', { name: 'סריקת קבלה או צילום מסך' }).first().click();
    await (await chooser).setFiles(FIXTURES + file);
    await a.getByText('קראנו את הטקסט מהתמונה').waitFor({ timeout: 90000 });
    await a.getByRole('button', { name: /המשך למילוי/ }).click();
    await a.waitForURL(/#\/add/);
    return {
      store: await a.locator('#f-store').inputValue(),
      amount: await a.locator('#f-amount').inputValue(),
      expiry: await a.locator('#f-expiry').inputValue(),
      code: await a.locator('#f-code').inputValue(),
      type: await a.locator('.segmented button.active').first().innerText(),
    };
  };

  await step('scan a photo of a credit-note receipt', async () => {
    const f = await scan('receipt-photo.png');
    assert.deepEqual(f, { store: 'Fox', amount: '189.90', expiry: '2028-11-02', code: '4471209931', type: 'זיכוי' });
    assert.equal(await a.locator('.photos img').count(), 1, 'the scanned image is attached');
    await shot(a, '08b-scanned-receipt');
    // Not saved: the paste step below adds the same Fox credit.
  });

  await step('scan SMS and email screenshots', async () => {
    for (const file of ['sms-light.png', 'sms-dark.png']) {
      assert.deepEqual(await scan(file), { store: 'BuyMe', amount: '250', expiry: '2031-03-15', code: '8820 1145 6673', type: 'כרטיס מתנה' }, file);
    }
    assert.deepEqual(await scan('email.png'), { store: 'שופרסל', amount: '500', expiry: '2030-12-31', code: '6009 1234 5678 9012', type: 'כרטיס מתנה' });
    // A PIN opens "more details" by itself, so the field is already visible.
    assert.equal(await a.locator('#f-pin').inputValue(), '5530');
  });

  await step('more cards: voucher, expired credit', async () => {
    await a.goto(`${A_URL}#/add`);
    await a.getByRole('radio', { name: 'שובר' }).click();
    await a.locator('#f-store').fill('ארומה');
    await a.locator('#f-discount').fill('ארוחת בוקר זוגית');
    await a.locator('#f-expiry').fill(inDays(200));
    await a.getByRole('button', { name: 'הוספה לארנק' }).click();
    await a.waitForURL(/#\/card\//);
    await addCard(a, { type: 'זיכוי', store: 'זארה', amount: 80, expiry: inDays(-5) });
  });

  await step('wallet totals, search and filters', async () => {
    await a.goto(`${A_URL}#/`);
    await settle(a);
    assert.match(await a.locator('.summary .total').innerText(), /329\.90/);
    assert.equal(await a.locator('.card-item').count(), 3);
    await shot(a, '09-wallet');
    await a.locator('.searchbar input').fill('fox');
    await settle(a);
    assert.equal(await a.locator('.card-item').count(), 1);
    await a.locator('.searchbar input').fill('זארה');
    await settle(a);
    assert.equal(await a.locator('.card-item').count(), 1, 'search also finds expired cards');
    await a.locator('.searchbar input').fill('');
    await a.locator('.chip', { hasText: 'פג בקרוב' }).click();
    await settle(a);
    assert.equal(await a.locator('.card-item').count(), 1);
  });

  await step('archive screen', async () => {
    await a.goto(`${A_URL}#/archive`);
    await a.locator('.card-item', { hasText: 'זארה' }).waitFor();
    await shot(a, '10-archive');
  });

  await step('history', async () => {
    await a.goto(`${A_URL}#/history`);
    await a.locator('.feed-item').first().waitFor();
    assert.match(await a.locator('.stats').innerText(), /120/);
    await shot(a, '11-history');
  });

  let pairing;
  await step('connect sync (first device)', async () => {
    await a.goto(`${A_URL}#/settings/sync`);
    await a.locator('#sync-url').fill(BACKEND);
    await shot(a, '12-sync-setup');
    await a.getByRole('button', { name: 'חיבור' }).click();
    await a.locator('.pairing-qr svg').waitFor();
    await shot(a, '13-pairing');
    pairing = await a.evaluate(() => {
      const code = document.querySelector('.code-field')?.textContent;
      return code || null;
    });
    if (!pairing) {
      await a.getByRole('button', { name: 'הצגת קוד הצירוף' }).click();
      pairing = await a.locator('.code-field').innerText();
    }
    assert.match(pairing, /^GW1\./);
    await a.keyboard.press('Escape');
    await a.goBack();
  });

  console.log('Phone B');
  const ctxB = await browser.newContext(phone);
  const b = await ctxB.newPage();
  watch(b, 'B');

  await step('join with the pairing link', async () => {
    await b.goto(`${B_URL}#join=${pairing}`);
    await b.locator('#join-code').waitFor();
    await shot(b, '14-join');
    await b.getByRole('button', { name: 'הצטרפות' }).click();
    await b.getByText('מי משתמש בטלפון הזה?').waitFor();
    await shot(b, '15-who');
    await b.locator('.prow', { hasText: 'דנה' }).click();
    await b.locator('.card-item', { hasText: 'BuyMe' }).waitFor();
    assert.match(await b.locator('.summary .total').innerText(), /329\.90/);
    await shot(b, '16-b-wallet');
  });

  // Waits until a phone has pushed everything, then lets the other one pull.
  const flush = (page) => page.waitForFunction(async () => {
    await window.__gw.sync.syncNow();
    return window.__gw.store.dirtyRecords().length === 0 && window.__gw.sync.state.status === 'idle';
  }, null, { timeout: 15000, polling: 500 });

  await step('purchase on phone B reaches phone A', async () => {
    await openCard(b, 'BuyMe');
    await b.getByRole('button', { name: 'מימוש' }).click();
    await b.locator('#tx-amount').fill('30');
    await b.getByRole('button', { name: 'שמירה' }).click();
    await b.locator('.hero .balance', { hasText: '150' }).waitFor();
    await flush(b);
    await a.goto(`${A_URL}#/`);
    await flush(a);
    await a.locator('.card-item', { hasText: '150' }).waitFor();
    await openCard(a, 'BuyMe');
    assert.match(await heroBalance(a), /150/);
    assert.match(await a.locator('.ledger').innerText(), /דנה/);
    await shot(a, '17-a-sees-b');
  });

  await step('offline purchase on B syncs when back online', async () => {
    await ctxB.setOffline(true);
    await openCard(b, 'BuyMe');
    await b.getByRole('button', { name: 'מימוש' }).click();
    await b.locator('#tx-amount').fill('10');
    await b.getByRole('button', { name: 'שמירה' }).click();
    await b.locator('.hero .balance', { hasText: '140' }).waitFor();
    await b.goto(`${B_URL}#/`);
    await b.evaluate(() => window.__gw.sync.syncNow());
    await b.locator('.sync-pill', { hasText: 'לא מקוון' }).waitFor();
    await shot(b, '18-b-offline');
    await ctxB.setOffline(false);
    await flush(b);
    await b.locator('.sync-pill', { hasText: 'מסונכרן' }).waitFor();
    await flush(a);
    await a.goto(`${A_URL}#/`);
    await a.locator('.card-item', { hasText: '140' }).waitFor();
  });

  await step('photo syncs to the other phone', async () => {
    await openCard(a, 'BuyMe');
    const chooser = a.waitForEvent('filechooser');
    await a.locator('.photos .photo-thumb.add').click();
    await (await chooser).setFiles(fileURLToPath(new URL('../icons/icon-512.png', import.meta.url)));
    await a.locator('.photos img').waitFor();
    await flush(a);
    await flush(b);
    await openCard(b, 'BuyMe');
    await b.locator('.photos img').waitFor({ timeout: 15000 });
    await shot(b, '19-b-photo');
  });

  await step('text shared from another app opens a pre-filled form', async () => {
    const text = encodeURIComponent('קיבלת גיפט קארד BuyMe בשווי 250 ₪ בתוקף עד 01/02/2031 https://buyme.co.il/x/abc');
    await a.goto(`${A_URL}?text=${text}`);
    await a.waitForURL(/#\/add$/);
    assert.equal(await a.locator('#f-store').inputValue(), 'BuyMe');
    assert.equal(await a.locator('#f-amount').inputValue(), '250');
    assert.equal(await a.locator('#f-expiry').inputValue(), '2031-02-01');
    assert.ok(!a.url().includes('?'), 'shared text is removed from the address');
  });

  let backupPath;
  await step('calendar export and backup download', async () => {
    await a.goto(`${A_URL}#/settings`);
    const ics = a.waitForEvent('download');
    await a.getByRole('button', { name: 'כל תאריכי התפוגה ליומן' }).click();
    const icsText = readFileSync(await (await ics).path(), 'utf8');
    assert.match(icsText, /BEGIN:VCALENDAR/);
    assert.equal((icsText.match(/BEGIN:VEVENT/g) || []).length, 3);
    const backup = a.waitForEvent('download');
    await a.getByRole('button', { name: 'ייצוא גיבוי (כולל תמונות)' }).click();
    const dl = await backup;
    backupPath = `${OUT}backup.json`;
    await dl.saveAs(backupPath);
    const data = JSON.parse(readFileSync(backupPath, 'utf8'));
    assert.equal(data.app, 'gift-wallet');
    assert.equal(data.photos.length, 1);
    assert.ok(!JSON.stringify(data).includes(pairing.slice(4, 30)), 'backup does not contain the sync key');
  });

  await step('restore the backup on a third device', async () => {
    const ctxC = await browser.newContext(phone);
    const c = await ctxC.newPage();
    watch(c, 'C');
    await c.goto(`http://[::1]:${PORT}/`);
    await c.getByRole('button', { name: 'מתחילים' }).click();
    await c.locator('#ob-me').fill('בדיקה');
    await c.getByRole('button', { name: 'יאללה' }).click();
    await c.getByText('הארנק עוד ריק').waitFor();
    await c.goto(`http://[::1]:${PORT}/#/settings`);
    const chooser = c.waitForEvent('filechooser');
    await c.getByRole('button', { name: 'שחזור מגיבוי' }).click();
    await (await chooser).setFiles(backupPath);
    await c.getByRole('button', { name: 'שחזור', exact: true }).click();
    await c.locator('.toast', { hasText: 'שוחזרו' }).waitFor();
    await c.goto(`http://[::1]:${PORT}/#/`);
    await c.locator('.card-item', { hasText: 'BuyMe' }).waitFor();
    assert.match(await c.locator('.summary .total').innerText(), /289\.90/);
    await openCard(c, 'BuyMe');
    await c.locator('.photos img').waitFor();
    await ctxC.close();
  });

  await step('dark mode', async () => {
    const dark = await browser.newContext({ ...phone, colorScheme: 'dark' });
    const d = await dark.newPage();
    watch(d, 'dark');
    await d.goto(`${B_URL}#/`);
    await d.getByRole('button', { name: 'מתחילים' }).waitFor();
    await shot(d, '19-dark-welcome');
    await dark.close();
    await b.goto(`${B_URL}#/settings`);
    await b.getByRole('radio', { name: 'כהה' }).click();
    await b.goto(`${B_URL}#/`);
    await shot(b, '20-dark-wallet');
    await openCard(b, 'Fox');
    await shot(b, '21-dark-card');
  });

  assert.deepEqual(errors, [], 'no page errors');
  console.log(`\nAll steps passed. Screenshots: ${OUT}`);
} catch (e) {
  console.error(`\nFAILED at "${current}": ${e.message.split('\n').slice(0, 4).join(' | ')}`);
  for (const [name, page] of pages) {
    const info = await page.evaluate(() => ({
      url: location.hash,
      pill: document.querySelector('.sync-pill')?.textContent,
      cards: [...document.querySelectorAll('.card-item')].map((c) => c.textContent).slice(0, 4),
      toast: document.querySelector('.toast')?.textContent,
    })).catch((err) => err.message);
    console.error(name, JSON.stringify(info));
    await page.screenshot({ path: `${OUT}zz-failure-${name}.png` }).catch(() => {});
  }
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
