import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseVersion } from '../scripts/release/version.mjs';

test('release bump follows published tags even when package version has not changed', () => {
  assert.equal(releaseVersion('0.1.0', ['v0.1.9', 'v0.1.10-beta'], 'patch'), '0.1.11');
  assert.equal(releaseVersion('0.1.0', ['v0.1.10'], 'minor'), '0.2.0');
  assert.equal(releaseVersion('0.1.0', ['v0.1.10'], 'major'), '1.0.0');
});
test('exact version supports initial releases and beta promotion; malformed input fails', () => {
  assert.equal(releaseVersion('0.1.0', [], 'patch', '0.1.0'), '0.1.0');
  assert.equal(releaseVersion('0.1.0', ['v0.2.0-beta'], 'patch', '0.2.0'), '0.2.0');
  assert.throws(() => releaseVersion('0.1.0', [], 'patch', '0.1.0;echo bad'));
  assert.throws(() => releaseVersion('0.1.0', [], 'unknown'));
});
