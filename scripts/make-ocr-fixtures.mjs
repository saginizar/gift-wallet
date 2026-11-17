// Renders the OCR test images in a real browser, so Hebrew mixed with numbers and Latin
// is laid out by the same bidi rules a phone uses: an SMS screenshot (light and dark), an
// email screenshot, and a slightly rotated, noisy photo of a credit-note receipt.
//   npm install --no-save playwright-core && node scripts/make-ocr-fixtures.mjs
// Output: tests/fixtures/ocr/*.png (committed; the e2e test uploads them).

import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(process.env.PLAYWRIGHT_FROM || import.meta.url);
const { chromium } = require('playwright-core');

const OUT = fileURLToPath(new URL('../tests/fixtures/ocr/', import.meta.url));
const FONT = new URL('../fonts/', import.meta.url).href;
mkdirSync(OUT, { recursive: true });

const browserPath = [
  process.env.E2E_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean).find((p) => existsSync(p));

const base = `
  @font-face { font-family: Heebo; src: url('${FONT}heebo-hebrew.woff2'); unicode-range: U+0590-05FF, U+20AA; }
  @font-face { font-family: Heebo; src: url('${FONT}heebo-latin.woff2'); unicode-range: U+0000-00FF, U+2000-206F; }
  * { box-sizing: border-box; margin: 0; }
  body { font-family: Heebo, Arial, sans-serif; }
`;

const sms = (dark) => `<!doctype html><html dir="rtl" lang="he"><style>${base}
  body { background: ${dark ? '#000' : '#fff'}; color: ${dark ? '#fff' : '#000'}; width: 390px; padding: 18px 14px; font-size: 17px; }
  .bar { display: flex; justify-content: space-between; font-size: 15px; font-weight: 600; direction: ltr; margin-bottom: 18px; }
  .from { text-align: center; font-weight: 700; font-size: 15px; margin-bottom: 4px; }
  .when { text-align: center; color: #8e8e93; font-size: 12px; margin-bottom: 14px; }
  .bubble { background: ${dark ? '#262629' : '#e9e9eb'}; border-radius: 18px; padding: 10px 14px; max-width: 300px; line-height: 1.4; }
  a { color: ${dark ? '#4ea4ff' : '#0a6cff'}; }
</style><body>
  <div class="bar"><span>10:42</span><span>85%</span></div>
  <div class="from">BuyMe</div>
  <div class="when">היום 10:41</div>
  <div class="bubble">היי שגיא, קיבלת מתנה מדנה! גיפט קארד BUYME ALL בשווי 250 ₪.
  לצפייה ומימוש: <a>https://buyme.co.il/g/7Hk2Pq</a>
  קוד שובר: 8820 1145 6673
  בתוקף עד 15/03/2031</div>
</body></html>`;

const email = `<!doctype html><html dir="rtl" lang="he"><style>${base}
  body { background: #fff; width: 420px; padding: 20px; font-size: 16px; color: #202124; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .meta { color: #5f6368; font-size: 13px; margin-bottom: 16px; }
  .box { border: 1px solid #dadce0; border-radius: 10px; padding: 14px; line-height: 1.9; }
  .foot { color: #5f6368; font-size: 13px; margin-top: 16px; }
</style><body>
  <h1>כרטיס המתנה שלך משופרסל</h1>
  <div class="meta">שופרסל &lt;noreply@shufersal.co.il&gt;</div>
  <div>תודה על רכישת כרטיס המתנה. הנה הפרטים:</div>
  <div class="box">
    מספר כרטיס: 6009 1234 5678 9012<br>
    קוד סודי: 5530<br>
    יתרה: 500 ש"ח<br>
    הכרטיס בתוקף עד 31/12/2030
  </div>
  <div class="foot">שירות לקוחות 1-800-60-70-80</div>
</body></html>`;

const receipt = `<!doctype html><html dir="rtl" lang="he"><style>${base}
  body { background: #6b6259; width: 520px; height: 760px; display: grid; place-items: center; }
  .paper { width: 380px; background: #f6f3ec; padding: 26px 24px; transform: rotate(-1.6deg);
    box-shadow: 0 6px 18px rgba(0,0,0,.4); font-size: 17px; line-height: 1.75; color: #222; position: relative; }
  .paper::after { content: ''; position: absolute; inset: 0; opacity: .18; pointer-events: none;
    background-image: radial-gradient(#000 0.6px, transparent 0.8px); background-size: 5px 7px; }
  .c { text-align: center; }
  .big { font-size: 26px; font-weight: 800; }
  .row { display: flex; justify-content: space-between; }
  hr { border: 0; border-top: 1px dashed #888; margin: 8px 0; }
</style><body><div class="paper">
  <div class="c big">FOX</div>
  <div class="c">פוקס סניף קניון עזריאלי</div>
  <hr>
  <div class="c" style="font-weight:700;font-size:20px">תעודת זיכוי</div>
  <div class="row"><span>מספר זיכוי:</span><span>4471209931</span></div>
  <div class="row"><span>תאריך הנפקה:</span><span>02/11/2026</span></div>
  <div class="row"><span>סכום הזיכוי:</span><span>189.90 ₪</span></div>
  <div class="row"><span>בתוקף עד:</span><span>02/11/2028</span></div>
  <hr>
  <div>ניתן לממש בכל סניפי פוקס</div>
  <div>הזיכוי אינו ניתן להמרה בכסף</div>
  <div class="row"><span>קופה 3</span><span>קופאי 117</span></div>
  <div class="c">תודה ולהתראות</div>
</div></body></html>`;

const browser = await chromium.launch({ executablePath: browserPath, headless: true });
const page = await browser.newPage({ deviceScaleFactor: 2 });
for (const [name, htmlText] of [['sms-light', sms(false)], ['sms-dark', sms(true)], ['email', email], ['receipt-photo', receipt]]) {
  await page.setContent(htmlText);
  await page.evaluate(() => document.fonts.ready);
  // Only the body, which is sized like a phone screen (or the receipt photo).
  await page.locator('body').screenshot({ path: `${OUT}${name}.png`, type: 'png' });
  console.log(`${name}.png`);
}
await browser.close();
