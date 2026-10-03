import { readFile } from 'node:fs/promises';

export async function loadInstallerSetup(filePath) {
  let content;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }

  const [serverUrl = ''] = content.split(/\r?\n/, 1).map((value) => value.trim());
  return serverUrl ? { serverUrl } : null;
}
