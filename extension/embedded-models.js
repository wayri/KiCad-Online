/* KiCad 9+ embedded models: base64 Zstandard with bounded frame allocation.
 * Format reference: KiCad common/embedded_files.cpp (ParseEmbedded).
 */
((root) => {
  'use strict';
  const MAX_BYTES = 8 * 1024 * 1024;
  /** Validate before allocating; the fallback avoids TypedArray.from's iterable list. */
  function decodeBase64(base64, {maxBytes = MAX_BYTES, padded = false, host = root} = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_BYTES ||
        typeof base64 !== 'string' || base64.length > 11200000) throw Error('Invalid or oversized model base64.');
    const length = base64.length, padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    if (length % 4 === 1 || (padding || padded) && length % 4 !== 0) throw Error('Invalid model base64 padding.');
    const content = length - padding;
    for (let i = 0; i < content; i++) {
      const c = base64.charCodeAt(i);
      if (!(c >= 65 && c <= 90 || c >= 97 && c <= 122 || c >= 48 && c <= 57 || c === 43 || c === 47)) throw Error('Invalid model base64.');
    }
    const size = Math.floor(length * 3 / 4) - padding;
    if (size > maxBytes) throw Error('Model base64 exceeds its decoded byte limit.');
    const native = host.Uint8Array?.fromBase64;
    if (typeof native === 'function') return native.call(host.Uint8Array, base64);
    const binary = host.atob(base64), bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  // Public-domain MurmurHash3_x64_128, with KiCad's seed and numeric hex order.
  function murmur(bytes, legacy = false) {
    const mask = (1n << 64n) - 1n, c1 = 0x87c37b91114253d5n, c2 = 0x4cf5ad432745937fn;
    const rot = (n, r) => ((n << r) | (n >> (64n - r))) & mask;
    const word = (at, count) => { let n = 0n; for (let i = 0; i < count; i++) n |= BigInt(bytes[at + i] || 0) << BigInt(i * 8); return n; };
    const mix = n => { n ^= n >> 33n; n = n * 0xff51afd7ed558ccdn & mask; n ^= n >> 33n; n = n * 0xc4ceb9fe1a85ec53n & mask; return n ^ n >> 33n; };
    let h1 = 0xabba2345n, h2 = h1;
    const body = bytes.length - bytes.length % 16;
    for (let at = 0; at < body; at += 16) {
      let k1 = word(at, 8), k2 = word(at + 8, 8);
      k1 = rot(k1 * c1 & mask, 31n) * c2 & mask; h1 ^= k1;
      h1 = ((rot(h1, 27n) + h2) * 5n + 0x52dce729n) & mask;
      k2 = rot(k2 * c2 & mask, 33n) * c1 & mask; h2 ^= k2;
      h2 = ((rot(h2, 31n) + h1) * 5n + 0x38495ab5n) & mask;
    }
    // Native addDataV1 rounds the tail length but never hashes that padded
    // block. For 13–15 residual bytes its hashTail(len & 15) therefore skips
    // the tail entirely. Preserve that historical bug for saved checksums.
    const length = legacy ? Math.ceil(bytes.length / 4) * 4 : bytes.length, tail = length % 16;
    if (tail > 8) h2 ^= rot(word(body + 8, tail - 8) * c2 & mask, 33n) * c1 & mask;
    if (tail) h1 ^= rot(word(body, Math.min(8, tail)) * c1 & mask, 31n) * c2 & mask;
    h1 ^= BigInt(length); h2 ^= BigInt(length);
    h1 = (h1 + h2) & mask; h2 = (h2 + h1) & mask;
    h1 = mix(h1); h2 = mix(h2);
    h1 = (h1 + h2) & mask; h2 = (h2 + h1) & mask;
    return h1.toString(16).padStart(16, '0') + h2.toString(16).padStart(16, '0');
  }
  function frameSize(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 6 || view.getUint32(0, true) !== 0xfd2fb528) throw Error('Embedded model is not Zstandard.');
    const flags = bytes[4], single = Boolean(flags & 32), sizeFlag = flags >>> 6;
    if (flags & 24) throw Error('Unsupported Zstandard frame flags.');
    let at = 5;
    if (!single) {
      const descriptor = bytes[at++], exponent = descriptor >>> 3;
      const window = 2 ** (10 + exponent) * (1 + (descriptor & 7) / 8);
      if (window > MAX_BYTES) throw Error('Embedded model window exceeds 8 MiB.');
    }
    const dictionaryBytes = [0, 1, 2, 4][flags & 3];
    if (dictionaryBytes) throw Error('Embedded model requires a Zstandard dictionary.');
    const sizeBytes = sizeFlag ? [0, 2, 4, 8][sizeFlag] : (single ? 1 : 0);
    if (!sizeBytes || at + sizeBytes > bytes.length) throw Error('Embedded model has no bounded content size.');
    let size = 0;
    for (let i = 0; i < sizeBytes; i++) size += bytes[at++] * 2 ** (8 * i);
    if (sizeFlag === 1) size += 256;
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_BYTES) throw Error('Embedded model exceeds 8 MiB.');
    // Accept exactly one complete frame, preventing hidden concatenated frames.
    let last = false;
    while (!last) {
      if (at + 3 > bytes.length) throw Error('Truncated embedded model block.');
      const header = bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16;
      at += 3; last = Boolean(header & 1);
      const type = (header >>> 1) & 3, length = header >>> 3;
      if (type === 3 || length > 131072) throw Error('Invalid embedded model block.');
      at += type === 1 ? 1 : length;
      if (at > bytes.length) throw Error('Truncated embedded model block.');
    }
    if (flags & 4) at += 4;
    if (at !== bytes.length) throw Error('Embedded model has trailing or missing frame data.');
    return size;
  }
  async function decode(asset, decompressor = root.fzstd?.decompress) {
    const base64 = asset?.base64;
    const bytes = decodeBase64(base64, {padded: true});
    if (bytes.length > MAX_BYTES) throw Error('Compressed embedded model exceeds 8 MiB.');
    const size = frameSize(bytes);
    if (typeof decompressor !== 'function') throw Error('Embedded model decoder unavailable.');
    const output = decompressor(bytes, new Uint8Array(size));
    if (!(output instanceof Uint8Array) || output.length !== size) throw Error('Embedded model size mismatch.');
    if (/^[a-f0-9]{64}$/i.test(asset.checksum || '')) {
      const hash = new Uint8Array(await root.crypto.subtle.digest('SHA-256', output));
      const hex = Array.from(hash, value => value.toString(16).padStart(2, '0')).join('');
      if (hex !== asset.checksum.toLowerCase()) throw Error('Embedded model checksum mismatch.');
    } else if (/^[a-f0-9]{32}$/i.test(asset.checksum || '')) {
      const expected = asset.checksum.toLowerCase();
      if (murmur(output) !== expected && murmur(output, true) !== expected) throw Error('Embedded model checksum mismatch.');
    } else {
      throw Error('Embedded model checksum is missing or unsupported.');
    }
    return output;
  }
  root.KiCadEmbeddedModels = {decode, decodeBase64, frameSize, murmur, MAX_BYTES};
  if (typeof module === 'object' && module.exports) module.exports = root.KiCadEmbeddedModels;
})(typeof globalThis === 'object' ? globalThis : this);
