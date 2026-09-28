import { readFile, writeFile } from 'node:fs/promises';

export async function saveSyncToken(secretPath, token, safeStorage) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows secure storage is unavailable.');
  await writeFile(secretPath, safeStorage.encryptString(token), { mode: 0o600 });
}

export async function loadSyncToken(secretPath, safeStorage) {
  try {
    return safeStorage.decryptString(await readFile(secretPath));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error('Terminal synchronization credential cannot be decrypted.');
  }
}
