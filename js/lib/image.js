// Photos are shrunk on the device before saving: long edge 1600px, JPEG. Keeps storage
// and sync small while a printed barcode stays readable.

export async function compressImage(file, { maxDim = 1600, quality = 0.82 } = {}) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('התמונה לא נטענה'));
      el.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('לא הצלחנו לשמור את התמונה');
    return { bytes: await blob.arrayBuffer(), mime: 'image/jpeg', width: w, height: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Barcode detection is available on Android Chrome (and some desktops), not on iOS.
export const canDetectBarcodes = () => typeof window !== 'undefined' && 'BarcodeDetector' in window;

const FORMATS = ['code_128', 'ean_13', 'ean_8', 'code_39', 'code_93', 'upc_a', 'upc_e', 'itf', 'codabar', 'qr_code', 'data_matrix', 'pdf417', 'aztec'];

export async function createDetector() {
  if (!canDetectBarcodes()) return null;
  let formats = FORMATS;
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats();
    formats = FORMATS.filter((f) => supported.includes(f));
  } catch { /* use the full list */ }
  if (!formats.length) return null;
  return new window.BarcodeDetector({ formats });
}

// Looks for a barcode in a photo the user just attached.
export async function detectInImage(bytes) {
  const detector = await createDetector();
  if (!detector) return null;
  try {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
    const found = await detector.detect(bitmap);
    bitmap.close?.();
    return found[0] ? { value: found[0].rawValue, format: found[0].format } : null;
  } catch {
    return null;
  }
}
