import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadTerminalConfig, saveTerminalConfig } from '../electron/terminal-config.js';

test('terminal configuration is written atomically and contains no sync token', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'restx-config-'));
  const configPath = path.join(directory, 'terminal.json');
  const config = {
    server_origin: 'https://restaurant.example', terminal_id: 'terminal-1',
    tenant_id: 1, branch_id: 2, location_id: 3, app_key: 'base64:test',
  };

  try {
    await saveTerminalConfig(configPath, config);
    assert.deepEqual(await loadTerminalConfig(configPath), config);
    assert.equal((await readFile(configPath, 'utf8')).includes('sync_token'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('missing or incomplete terminal configuration starts setup', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'restx-config-'));
  const configPath = path.join(directory, 'terminal.json');

  try {
    assert.equal(await loadTerminalConfig(configPath), null);
    await saveTerminalConfig(configPath, { server_origin: 'https://restaurant.example' });
    assert.equal(await loadTerminalConfig(configPath), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
