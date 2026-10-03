import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadInstallerSetup } from '../electron/installer-setup.js';

test('installer server URL remains available across launches', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'offline-pos-installer-'));
  const filePath = path.join(directory, 'pending-installer-setup.txt');

  try {
    await writeFile(filePath, 'https://restaurant.example\r\n');
    assert.deepEqual(await loadInstallerSetup(filePath), {
      serverUrl: 'https://restaurant.example',
    });
    assert.deepEqual(await loadInstallerSetup(filePath), {
      serverUrl: 'https://restaurant.example',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
