const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isSuccessful } = require('../probe.cjs');
test('live verification requires every requested media sample, not one success', () => {
  assert.equal(typeof isSuccessful, 'function');
  assert.equal(isSuccessful([{ tracks: [{ media: [{ audio: true }, { error: 'failed' }] }] }], false), false);
});
test('decode verification cannot pass after a decoding error', () => {
  assert.equal(isSuccessful([{ tracks: [{ media: [{ audio: true, error: 'decode failed' }] }] }], true), false);
  assert.equal(isSuccessful([{ tracks: [{ media: [{ audio: true, decoded: true }] }] }], true), true);
});
test('empty catalogs and empty reports are not success', () => {
  assert.equal(isSuccessful([], false), false);
  assert.equal(isSuccessful([{ tracks: [] }], false), false);
});
