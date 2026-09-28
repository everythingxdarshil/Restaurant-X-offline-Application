import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { archiveTerminalData } from '../electron/terminal-reset.js';

test('changing tenant archives the complete local tenant data directory', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'restx-reset-'));
  const dataRoot = path.join(directory, 'RestaurantX POS');
  const configPath = path.join(dataRoot, 'terminal.json');

  try {
    await mkdir(dataRoot, { recursive: true });
    await writeFile(configPath, '{"tenant_id":2}', 'utf8');

    const archivePath = await archiveTerminalData(
      { dataRoot },
      { tenant_name: 'Copper Leaf', terminal_id: 'terminal-1234' },
      new Date('2026-09-25T10:00:00.000Z'),
    );

    assert.equal(await readFile(path.join(archivePath, 'terminal.json'), 'utf8'), '{"tenant_id":2}');
    await access(dataRoot);
    await assert.rejects(access(configPath));
    assert.match(archivePath, /Copper-Leaf-terminal-2026-09-25T10-00-00\.000Z$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
