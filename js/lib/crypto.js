// End-to-end encryption for sync. One random 256-bit household key is shared between
// the paired devices; from it HKDF derives an AES-GCM key for the data and a separate
// auth token for the backend. The backend stores only a hash of the token and only
// ciphertext, so the Google Sheet never sees card codes or the key.

const te = new TextEncoder();
const td = new TextDecoder();
const SALT = te.encode('gift-wallet/v1');

export function b64urlEncode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const encodeText = (s) => b64urlEncode(te.encode(s));
export const decodeText = (s) => td.decode(b64urlDecode(s));

export function randomKey() {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

export async function deriveKeys(key) {
  const raw = b64urlDecode(key);
  if (raw.length !== 32) throw new Error('bad_key');
  const base = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey', 'deriveBits']);
  const encKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: SALT, info: te.encode('enc') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const authBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: SALT, info: te.encode('auth') },
    base,
    256,
  );
  return { encKey, auth: b64urlEncode(new Uint8Array(authBits)) };
}

// The record id is bound as associated data, so a blob cannot be replayed under another id.
export async function encryptBytes(key, bytes, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: te.encode(aad) },
    key,
    bytes,
  ));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64urlEncode(out);
}

export async function decryptBytes(key, blob, aad) {
  const data = b64urlDecode(blob);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: data.subarray(0, 12), additionalData: te.encode(aad) },
    key,
    data.subarray(12),
  );
  return new Uint8Array(plain);
}

export const encryptJSON = (key, obj, aad) => encryptBytes(key, te.encode(JSON.stringify(obj)), aad);

export async function decryptJSON(key, blob, aad) {
  return JSON.parse(td.decode(await decryptBytes(key, blob, aad)));
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', te.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
