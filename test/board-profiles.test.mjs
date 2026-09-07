import test from 'node:test';
import assert from 'node:assert/strict';
import { profileForReady } from '../bridge/board-profiles.mjs';
const ready = { type: 'ready', v: 1, board: 'waveshare-1.75-b' };
test('original firmware retains its tested profile without geometry', () => {
  const profile = profileForReady(ready);
  assert.equal(profile.status, 'tested');
  assert.deepEqual(profile.display, { width: 466, height: 466, shape: 'round' });
});
test('profile negotiation rejects unknown boards, protocol and mismatched geometry', () => {
  assert.equal(profileForReady({ ...ready, board: 'another-esp32' }), null);
  assert.equal(profileForReady({ ...ready, v: 2 }), null);
  for (const display of [null, {}, { width: 480, height: 480, shape: 'round' }, { width: 466, height: 466, shape: 'rectangular' }]) {
    assert.equal(profileForReady({ ...ready, display }), null);
  }
  const display = { width: 466, height: 466, shape: 'round' };
  const profile = profileForReady({ ...ready, display });
  profile.display.width = 1;
  assert.equal(profileForReady({ ...ready, display }).display.width, 466);
});
