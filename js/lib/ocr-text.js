// Turns OCR word boxes back into a line of text in reading order. Pure, so it is unit
// tested in Node.
//
// Tesseract reports words with their position but its own text order is unreliable when
// Hebrew, numbers and Latin mix on one line. On a right-to-left line the words read
// right to left, numbers included ("קוד שובר: 8820 1145 6673" shows 8820 rightmost),
// except that consecutive Latin words keep their left-to-right order ("BUYME ALL").

const HEB = /[\u05d0-\u05ea]/;
const LATIN = /[A-Za-z]/;

export function orderLine(words) {
  const list = words.filter((w) => w.text && w.text.trim());
  if (!list.length) return '';
  const rtl = list.some((w) => HEB.test(w.text));
  const visual = [...list].sort((a, b) => a.x0 - b.x0); // left to right
  if (!rtl) return visual.map((w) => w.text).join(' ');

  const out = [];
  let run = [];
  const flush = () => {
    out.push(...run.reverse());
    run = [];
  };
  for (const w of [...visual].reverse()) { // right to left
    if (LATIN.test(w.text) && !HEB.test(w.text)) run.push(w.text);
    else {
      flush();
      out.push(w.text);
    }
  }
  flush();
  return out.join(' ');
}
