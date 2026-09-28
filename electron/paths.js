import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const clean = (value) => typeof value === 'string' ? value.trim() : '';

export function resolveRuntimePaths({ appDataPath, appPath, resourcesPath, isPackaged, env = process.env }) {
  const dataRoot = clean(env.RESTX_APP_DATA_PATH) || path.join(appDataPath, 'RestaurantX POS');
  const sourceOverride = !isPackaged ? clean(env.RESTX_SOURCE_PATH) : '';
  const phpOverride = !isPackaged ? clean(env.RESTX_PHP_PATH) : '';

  return {
    dataRoot,
    databaseRoot: path.join(dataRoot, 'database'),
    databasePath: path.join(dataRoot, 'database', 'database.sqlite'),
    storageRoot: path.join(dataRoot, 'storage'),
    bootstrapCacheRoot: path.join(dataRoot, 'bootstrap-cache'),
    backupsRoot: path.join(dataRoot, 'backups'),
    logsRoot: path.join(dataRoot, 'logs'),
    configPath: path.join(dataRoot, 'terminal.json'),
    brandIconPath: path.join(dataRoot, 'brand-icon'),
    secretPath: path.join(dataRoot, 'secrets', 'sync-token.bin'),
    bootstrapMarker: path.join(dataRoot, 'bootstrap.complete'),
    restxRoot: sourceOverride || (isPackaged
      ? path.join(resourcesPath, 'restx')
      : path.resolve(appPath, '..', 'Rest-X')),
    phpPath: phpOverride || (isPackaged ? path.join(resourcesPath, 'php', 'php.exe') : 'php'),
  };
}

export async function ensureRuntimeDirectories(paths) {
  await Promise.all([
    paths.databaseRoot,
    paths.storageRoot,
    paths.bootstrapCacheRoot,
    paths.backupsRoot,
    paths.logsRoot,
    path.dirname(paths.secretPath),
    path.join(paths.storageRoot, 'app', 'private'),
    path.join(paths.storageRoot, 'app', 'public'),
    path.join(paths.storageRoot, 'framework', 'cache', 'data'),
    path.join(paths.storageRoot, 'framework', 'sessions'),
    path.join(paths.storageRoot, 'framework', 'views'),
    path.join(paths.storageRoot, 'logs'),
  ].map((directory) => mkdir(directory, { recursive: true })));
}
