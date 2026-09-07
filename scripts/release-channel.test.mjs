import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseChannel } from './release-channel.mjs';
test('prereleases cannot replace latest', () => {
  assert.equal(releaseChannel('1.2.3'), 'latest');
  assert.equal(releaseChannel('1.2.3-beta.1'), 'beta');
  assert.equal(releaseChannel('1.2.3-next.0'), 'next');
  assert.throws(() => releaseChannel('1.2.3-rc.1'));
});
