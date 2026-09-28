import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const safeName = (value) => String(value || 'tenant')
  .trim()
  .replace(/[^a-z0-9_-]+/gi, '-')
  .replace(/^-+|-+$/g, '') || 'tenant';

export async function archiveTerminalData(paths, terminal, now = new Date()) {
  const archiveRoot = path.join(path.dirname(paths.dataRoot), `${path.basename(paths.dataRoot)} archives`);
  const timestamp = now.toISOString().replaceAll(':', '-');
  const tenant = safeName(terminal?.tenant_name || terminal?.tenant_code || terminal?.tenant_id);
  const terminalId = safeName(terminal?.terminal_id).slice(0, 8).replace(/-+$/g, '');
  const archivePath = path.join(archiveRoot, `${tenant}-${terminalId}-${timestamp}`);

  await mkdir(archiveRoot, { recursive: true });
  await cp(paths.dataRoot, archivePath, { recursive: true, errorOnExist: true });
  try {
    for (const entry of await readdir(paths.dataRoot)) {
      await rm(path.join(paths.dataRoot, entry), {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 200,
      });
    }
  } catch (error) {
    await cp(archivePath, paths.dataRoot, { recursive: true, force: true });
    throw error;
  }

  return archivePath;
}
