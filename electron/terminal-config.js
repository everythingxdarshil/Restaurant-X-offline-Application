import { readFile, rename, writeFile } from 'node:fs/promises';

export async function loadTerminalConfig(configPath) {
  try {
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    const required = ['server_origin', 'terminal_id', 'tenant_id', 'branch_id', 'location_id', 'app_key'];
    return required.every((key) => config[key]) ? config : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error('Terminal configuration is invalid.');
  }
}

export async function saveTerminalConfig(configPath, config) {
  const temporaryPath = `${configPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, configPath);
}
