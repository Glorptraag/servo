/**
 * A dependency-free, synchronous SHA-256 (FIPS 180-4), so a migration can derive an id from a document's
 * content the same way on every device. Web Crypto's digest is asynchronous, and the schema takes no library.
 */

// The first 32 bits of the fractional parts of the cube roots of the first 64 primes.
const K = Uint32Array.of(
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
);

// The first 32 bits of the fractional parts of the square roots of the first 8 primes.
const INITIAL = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

const word = (words: Uint32Array, index: number): number => words[index] ?? 0;

/** The text as UTF-8 bytes. A lone surrogate becomes U+FFFD, as TextEncoder writes it. */
export const utf8 = (text: string): Uint8Array => {
  const bytes: number[] = [];
  for (const char of text) {
    const point = char.codePointAt(0) ?? 0;
    const code = point >= 0xd800 && point <= 0xdfff ? 0xfffd : point;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return Uint8Array.from(bytes);
};

/** The SHA-256 digest of the bytes: 32 bytes. */
export const sha256 = (message: Uint8Array): Uint8Array => {
  // The message, a 1 bit, zeros, then its length in bits as a 64-bit big-endian number, in 64-byte blocks.
  const blocks = Math.ceil((message.length + 9) / 64);
  const padded = new Uint8Array(blocks * 64);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = message.length * 8;
  view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000));
  view.setUint32(padded.length - 4, bits >>> 0);

  const hash = Uint32Array.from(INITIAL);
  const w = new Uint32Array(64);
  for (let block = 0; block < blocks; block += 1) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(block * 64 + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const early = word(w, i - 15);
      const late = word(w, i - 2);
      const s0 = rotr(early, 7) ^ rotr(early, 18) ^ (early >>> 3);
      const s1 = rotr(late, 17) ^ rotr(late, 19) ^ (late >>> 10);
      // A Uint32Array keeps each sum modulo 2^32.
      w[i] = word(w, i - 16) + s0 + word(w, i - 7) + s1;
    }
    let a = word(hash, 0);
    let b = word(hash, 1);
    let c = word(hash, 2);
    let d = word(hash, 3);
    let e = word(hash, 4);
    let f = word(hash, 5);
    let g = word(hash, 6);
    let h = word(hash, 7);
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choice = (e & f) ^ (~e & g);
      const t1 = (h + s1 + choice + word(K, i) + word(w, i)) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, h].forEach((value, index) => {
      hash[index] = word(hash, index) + value;
    });
  }

  const digest = new Uint8Array(32);
  const out = new DataView(digest.buffer);
  hash.forEach((value, index) => out.setUint32(index * 4, value));
  return digest;
};

/**
 * A UUID derived from text: the first 16 bytes of its SHA-256, with the version and variant bits set as a
 * UUID v4 has them, written in lower-case hex. It passes every check a random UUID v4 passes and, like
 * one, holds no name; unlike one, the same text always gives the same id.
 */
export const derivedUuid = (text: string): string => {
  const bytes = sha256(utf8(text)).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
