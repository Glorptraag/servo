import { describe, expect, it } from 'vitest';
import { derivedUuid, sha256, utf8 } from '../src/migrate/digest.ts';
import { UUID_V4 } from '../src/validate/reader.ts';

const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const digestOf = (text: string): string => hex(sha256(utf8(text)));

// Expected digests: the FIPS 180-2 examples, and Python's hashlib over the same UTF-8 bytes.
describe('sha256 gives the standard digests', () => {
  it.each([
    ['the empty string', '', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['the 448-bit message', 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
    [
      'the 896-bit message',
      'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
      'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1',
    ],
    ['a two-byte character', 'é', '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c'],
    ['a three-byte character', '€', 'c4cc90ed3d26f12d4b08a75140970a7904035c31cbb4515a83f19b9003c00d1d'],
    ['a four-byte character', '\u{1f527}', 'a7b02983d6613af26a7745d3c7e605a7f7e706ab8009ceda82c91de148ff5c09'],
    ['mixed text', 'Robô 🔧 €5', '3a6dcd66baadb2889190a95d080045203157943abb774bbb55301061e928d4dc'],
  ])('%s', (_name, text, expected) => {
    expect(digestOf(text)).toBe(expected);
  });

  it.each([
    [55, '9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318'],
    [56, 'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a'],
    [63, '7d3e74a05d7db15bce4ad9ec0658ea98e3f06eeecf16b4c6fff2da457ddc2f34'],
    [64, 'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb'],
    [119, '31eba51c313a5c08226adf18d4a359cfdfd8d2e816b13f4af952f7ea6584dcfb'],
    [120, '2f3d335432c70b580af0e8e1b3674a7c020d683aa5f73aaaedfdc55af904c21c'],
  ])('pads %i bytes, either side of a block boundary', (length, expected) => {
    expect(digestOf('a'.repeat(length))).toBe(expected);
  });

  it('hashes a million bytes', () => {
    expect(digestOf('a'.repeat(1_000_000))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });
});

describe('utf8', () => {
  it('writes one to four bytes per character', () => {
    expect(hex(utf8('aé€\u{1f527}'))).toBe('61c3a9e282acf09f94a7');
  });

  it('writes a lone surrogate as U+FFFD, as TextEncoder does', () => {
    expect(hex(utf8('\ud800'))).toBe('efbfbd');
    expect(hex(utf8('x\udc00y'))).toBe('78efbfbd79');
  });
});

describe('derivedUuid', () => {
  it('is the first 16 bytes of the digest, with the version 4 and variant bits set', () => {
    // SHA-256('abc') starts ba7816bf 8f01 cfea 4141 40de5dae2223: c → 4 and 4 → 8.
    expect(derivedUuid('abc')).toBe('ba7816bf-8f01-4fea-8141-40de5dae2223');
  });

  it('always passes the UUID v4 check', () => {
    for (let n = 0; n < 500; n += 1) expect(derivedUuid(`text ${n}`)).toMatch(UUID_V4);
  });

  it('gives the same id for the same text, and a different id for different text', () => {
    expect(derivedUuid('Rolling robot')).toBe(derivedUuid('Rolling robot'));
    expect(derivedUuid('Rolling robot')).not.toBe(derivedUuid('Rolling robot '));
    const ids = new Set(Array.from({ length: 500 }, (_, n) => derivedUuid(`text ${n}`)));
    expect(ids.size).toBe(500);
  });
});
