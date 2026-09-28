import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocalRuntimeUrl } from '../electron/navigation-policy.js';

test('print windows are limited to the exact local runtime origin', () => {
  const origin = 'http://127.0.0.1:63835';

  assert.equal(isLocalRuntimeUrl(`${origin}/print/invoice/12`, origin), true);
  assert.equal(isLocalRuntimeUrl('http://127.0.0.1:63836/print/invoice/12', origin), false);
  assert.equal(isLocalRuntimeUrl('https://example.com/print/invoice/12', origin), false);
  assert.equal(isLocalRuntimeUrl('not-a-url', origin), false);
});
