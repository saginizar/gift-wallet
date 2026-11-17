// Common Israeli gift card issuers and retailers, used for store autocomplete, for
// recognising the store in a pasted SMS, and for matching Hebrew/English spellings in
// search. Colors only tint the card avatar; any store not listed gets a hashed color.

export const STORES = [
  // Multi-brand gift cards
  { name: 'BuyMe', aliases: ['ביימי', 'באיימי', 'buy me', 'buyme all', 'ביי מי'], color: '#f2416b', kind: 'giftcard' },
  { name: 'תו הזהב', aliases: ['tav hazahav', 'תו זהב', 'tavhazahav'], color: '#c99a2e', kind: 'giftcard' },
  { name: 'Max Gift Card', aliases: ['מקס', 'max', 'מקס גיפט', 'גיפט קארד מקס'], color: '#1f8ef1', kind: 'giftcard' },
  { name: 'ישראכרט גיפט קארד', aliases: ['isracard', 'ישראכרט'], color: '#1c3f94', kind: 'giftcard' },
  { name: 'כאל גיפט קארד', aliases: ['cal', 'כאל'], color: '#00a3e0', kind: 'giftcard' },
  { name: 'DreamCard', aliases: ['דרים קארד', 'דרימקארד', 'dream card'], color: '#7b3fe4', kind: 'giftcard' },
  { name: 'נופשונית', aliases: ['nofshonit'], color: '#0aa58f', kind: 'giftcard' },
  { name: 'כרטיס חבר', aliases: ['hever', 'חבר'], color: '#164b9c', kind: 'giftcard' },
  { name: 'גיפט קארד עזריאלי', aliases: ['azrieli', 'עזריאלי'], color: '#2a2a72', kind: 'giftcard' },
  { name: 'ביג גיפט קארד', aliases: ['big', 'ביג', 'big fashion'], color: '#e4002b', kind: 'giftcard' },
  { name: 'מליסרון גיפט קארד', aliases: ['melisron', 'מליסרון', 'קניוני מליסרון'], color: '#8a1538', kind: 'giftcard' },
  { name: 'Wolt', aliases: ['וולט'], color: '#00a8e8', kind: 'giftcard' },
  { name: 'תן ביס', aliases: ['10bis', 'tenbis', 'תןביס'], color: '#ff8000', kind: 'giftcard' },
  { name: 'סיבוס', aliases: ['cibus', 'pluxee', 'פלקסי'], color: '#2bb673', kind: 'giftcard' },

  // Food and pharma
  { name: 'שופרסל', aliases: ['shufersal', 'שופר סל'], color: '#e30613', kind: 'credit' },
  { name: 'רמי לוי', aliases: ['rami levy', 'רמילוי'], color: '#004c97', kind: 'credit' },
  { name: 'יוחננוף', aliases: ['yochananof'], color: '#e2231a', kind: 'credit' },
  { name: 'אושר עד', aliases: ['osher ad'], color: '#f7a600', kind: 'credit' },
  { name: 'ויקטורי', aliases: ['victory'], color: '#d71920', kind: 'credit' },
  { name: 'קרפור', aliases: ['carrefour', 'יינות ביתן'], color: '#1e5bc6', kind: 'credit' },
  { name: 'סופר-פארם', aliases: ['super-pharm', 'superpharm', 'סופר פארם', 'סופרפארם'], color: '#e3007b', kind: 'credit' },
  { name: 'Be', aliases: ['בי', 'be pharm', 'בי פארם'], color: '#00a0df', kind: 'credit' },
  { name: 'ארומה', aliases: ['aroma'], color: '#8b1d1d', kind: 'voucher' },

  // Fashion
  { name: 'Fox', aliases: ['פוקס', 'fox home', 'פוקס הום'], color: '#e10600', kind: 'credit' },
  { name: 'קסטרו', aliases: ['castro'], color: '#111111', kind: 'credit' },
  { name: 'רנואר', aliases: ['renuar'], color: '#4b3b6b', kind: 'credit' },
  { name: 'גולף', aliases: ['golf', 'golf & co', 'גולף אנד קו', 'golf&co'], color: '#1f7a5c', kind: 'credit' },
  { name: 'הודיס', aliases: ['hoodies'], color: '#333f48', kind: 'credit' },
  { name: 'Terminal X', aliases: ['טרמינל איקס', 'טרמינל x', 'terminalx'], color: '#141414', kind: 'credit' },
  { name: 'Zara', aliases: ['זארה'], color: '#222222', kind: 'credit' },
  { name: 'H&M', aliases: ['hm', 'אייץ אנד אם', 'h and m'], color: '#cc071e', kind: 'credit' },
  { name: 'Mango', aliases: ['מנגו'], color: '#3a3a3a', kind: 'credit' },
  { name: 'Next', aliases: ['נקסט'], color: '#1d1d1b', kind: 'credit' },
  { name: 'American Eagle', aliases: ['אמריקן איגל', 'ae'], color: '#1b365d', kind: 'credit' },
  { name: 'Adidas', aliases: ['אדידס'], color: '#000000', kind: 'credit' },
  { name: 'Nike', aliases: ['נייקי'], color: '#111111', kind: 'credit' },
  { name: 'דלתא', aliases: ['delta'], color: '#00447c', kind: 'credit' },
  { name: 'המשביר לצרכן', aliases: ['hamashbir', 'המשביר', 'משביר'], color: '#c8102e', kind: 'credit' },
  { name: 'דקטלון', aliases: ['decathlon'], color: '#0082c3', kind: 'credit' },

  // Home and electronics
  { name: 'הום סנטר', aliases: ['home center', 'הוםסנטר'], color: '#e5501e', kind: 'credit' },
  { name: 'ACE', aliases: ['אייס', 'ace'], color: '#d40f14', kind: 'credit' },
  { name: 'IKEA', aliases: ['איקאה', 'איקיאה'], color: '#0058a3', kind: 'credit' },
  { name: 'KSP', aliases: ['קיי אס פי', 'ק.ס.פ'], color: '#e4032e', kind: 'credit' },
  { name: 'באג', aliases: ['bug'], color: '#ed1c24', kind: 'credit' },
  { name: 'iDigital', aliases: ['איי דיגיטל', 'idigital'], color: '#333333', kind: 'credit' },
  { name: 'מחסני חשמל', aliases: ['machsanei hashmal'], color: '#f39200', kind: 'credit' },
  { name: 'נעמן', aliases: ['naaman'], color: '#9b1b30', kind: 'credit' },
  { name: 'מקס סטוק', aliases: ['max stock', 'maxstock'], color: '#f5a800', kind: 'credit' },

  // Books, kids, leisure
  { name: 'סטימצקי', aliases: ['steimatzky'], color: '#00539b', kind: 'credit' },
  { name: 'צומת ספרים', aliases: ['tzomet sfarim'], color: '#e30613', kind: 'credit' },
  { name: 'טויס אר אס', aliases: ['toys r us', 'toysrus'], color: '#0071ce', kind: 'credit' },
  { name: 'כפר השעשועים', aliases: ['kfar hashaashuim'], color: '#ff6f00', kind: 'credit' },
  { name: 'שילב', aliases: ['shilav'], color: '#0096d6', kind: 'credit' },
  { name: 'סינמה סיטי', aliases: ['cinema city'], color: '#9e1b32', kind: 'voucher' },
  { name: 'יס פלאנט', aliases: ['yes planet', 'פלאנט'], color: '#00a1e4', kind: 'voucher' },
  { name: 'Amazon', aliases: ['אמזון'], color: '#ff9900', kind: 'giftcard' },
];

const PALETTE = ['#6247ea', '#d9479b', '#0f9d8a', '#e8590c', '#1c7ed6', '#9c36b5', '#2f9e44', '#c2255c', '#5f3dc4', '#f08c00', '#0b7285', '#d6336c'];

// Hebrew vowel points and cantillation marks (U+0591..U+05C7).
const NIQQUD = new RegExp(`[${String.fromCharCode(0x0591)}-${String.fromCharCode(0x05c7)}]`, 'g');

export function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(NIQQUD, '')
    .replace(/["'`׳״]/g, '') // quotes, geresh, gershayim
    .replace(/[ךםןףץ]/g, (c) => ({ ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' })[c])
    .replace(/[\s\-_.&+]+/g, ' ')
    .trim();
}

const compact = (s) => normalizeText(s).replace(/ /g, '');

// Catalog entry whose name or alias matches the given store name exactly.
export function findStore(name) {
  const key = compact(name);
  if (!key) return null;
  return STORES.find((s) => compact(s.name) === key || s.aliases.some((a) => compact(a) === key)) || null;
}

// Autocomplete suggestions: stores already used in this wallet, then the catalog.
// Names (or spellings) that start with the query rank above ones that only contain it.
export function suggestStores(query, knownStores = [], limit = 8) {
  const q = compact(query);
  const seen = new Set();
  const out = [];
  const consider = (name, aliases = []) => {
    const k = compact(name);
    if (!k || seen.has(k)) return;
    const spellings = [name, ...aliases].map(compact);
    const rank = !q ? 1 : spellings.some((s) => s.startsWith(q)) ? 0 : spellings.some((s) => s.includes(q)) ? 1 : -1;
    if (rank < 0) return;
    seen.add(k);
    out.push({ name, rank, i: out.length });
  };
  for (const name of knownStores) consider(name, findStore(name)?.aliases);
  for (const s of STORES) consider(s.name, s.aliases);
  return out.sort((a, b) => a.rank - b.rank || a.i - b.i).slice(0, limit).map((x) => x.name);
}

function hash(s) {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) | 0;
  return Math.abs(h);
}

export function storeColor(name, override) {
  if (override) return override;
  const entry = findStore(name);
  if (entry) return entry.color;
  return PALETTE[hash(compact(name)) % PALETTE.length];
}

// Searchable text for a store: its name plus every known spelling.
export function storeSearchText(name) {
  const entry = findStore(name);
  return [name, ...(entry ? [entry.name, ...entry.aliases] : [])].join(' ');
}

// One or two characters for the avatar circle: initials for multi-word Latin names
// ("Terminal X" -> "TX"), otherwise the first letter.
export function storeInitials(name) {
  const clean = String(name || '').trim();
  if (!clean) return '?';
  const words = clean.split(/\s+/).filter(Boolean);
  if (/^[a-z0-9]/i.test(clean) && words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  return clean[0].toUpperCase();
}

export { PALETTE };
