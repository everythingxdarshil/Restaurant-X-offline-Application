import { app, BrowserWindow, dialog, ipcMain, nativeImage, net, safeStorage, shell } from 'electron';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureRuntimeDirectories, resolveRuntimePaths } from './paths.js';
import { LocalRuntime } from './process-manager.js';
import { isLocalRuntimeUrl } from './navigation-policy.js';
import { loadSyncToken, saveSyncToken } from './secret-store.js';
import { SetupApi } from './setup-api.js';
import { archiveTerminalData } from './terminal-reset.js';
import { loadTerminalConfig, saveTerminalConfig } from './terminal-config.js';
import { DEFAULT_WINDOW_TITLE, resolveWindowBrand } from './window-brand.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const localPagePrefix = pathToFileURL(`${currentDirectory}${path.sep}`).href;
const applicationIconPath = path.join(currentDirectory, 'assets', 'app-icon.png');
let mainWindow;
let runtime;
let runtimeOrigin;
let paths;
let setupApi;
let quitting = false;
let windowTitle = DEFAULT_WINDOW_TITLE;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function sendStatus(status) {
  if (!mainWindow?.isDestroyed()) mainWindow.webContents.send('runtime:status', status);
}

function setWindowTitle(title) {
  windowTitle = title;
  mainWindow?.setTitle(title);
}

function setBrandIcon(buffer) {
  const icon = nativeImage.createFromBuffer(buffer);
  if (icon.isEmpty()) return false;
  mainWindow?.setIcon(icon);
  return true;
}

async function restoreBrandIcon() {
  try { setBrandIcon(await readFile(paths.brandIconPath)); } catch {}
}

async function refreshBrandIcon(logoUrl) {
  if (!logoUrl) return;
  try {
    const response = await net.fetch(logoUrl, { signal: AbortSignal.timeout(5000) });
    const size = Number(response.headers.get('content-length') || 0);
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/') || size > 2_000_000) return;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 2_000_000 || !setBrandIcon(buffer)) return;
    await writeFile(paths.brandIconPath, buffer);
  } catch {}
}

function applyWindowBrand(input) {
  const brand = resolveWindowBrand(input);
  setWindowTitle(brand.title);
  void refreshBrandIcon(brand.logoUrl);
}

async function refreshConfiguredBrand(terminal) {
  try {
    const api = new SetupApi(net.fetch);
    const result = await api.discover(terminal.server_origin, terminal.tenant_code || '', terminal.location_id);
    const branding = result.tenant?.branding;
    if (!branding) return;
    const updated = {
      ...terminal,
      brand_name: branding.site_name || result.tenant.name,
      brand_logo_url: Object.hasOwn(branding, 'logo_url') ? branding.logo_url : terminal.brand_logo_url,
      brand_icon_url: Object.hasOwn(branding, 'icon_url') ? branding.icon_url : terminal.brand_icon_url,
      brand_primary_color: Object.hasOwn(branding, 'primary_color') ? branding.primary_color : terminal.brand_primary_color,
    };
    Object.assign(terminal, updated);
    applyWindowBrand({
      siteName: updated.brand_name,
      iconUrl: updated.brand_icon_url,
      logoUrl: updated.brand_logo_url,
      serverOrigin: updated.server_origin,
    });
    await saveTerminalConfig(paths.configPath, updated);
  } catch {}
}

function createWindow() {
  mainWindow = new BrowserWindow({
    icon: applicationIconPath,
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(currentDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow.setTitle(windowTitle);
  });
  mainWindow.removeMenu();
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    if (isLocalRuntimeUrl(url, runtimeOrigin)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: mainWindow,
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
          },
        },
      };
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const localPage = url.startsWith(localPagePrefix);
    const localRuntime = isLocalRuntimeUrl(url, runtimeOrigin);
    if (!localPage && !localRuntime) event.preventDefault();
  });
}

async function showSetup() {
  setupApi = new SetupApi(net.fetch);
  setWindowTitle(DEFAULT_WINDOW_TITLE);
  mainWindow.setIcon(applicationIconPath);
  await mainWindow.loadFile(path.join(currentDirectory, 'setup.html'));
  mainWindow.show();
}

async function showRuntime({ initialSync = true } = {}) {
  const terminal = await loadTerminalConfig(paths.configPath);
  const token = await loadSyncToken(paths.secretPath, safeStorage);
  if (!terminal || !token) {
    await showSetup();
    return;
  }
  applyWindowBrand({
    siteName: terminal.brand_name || terminal.tenant_name,
    iconUrl: terminal.brand_icon_url,
    logoUrl: terminal.brand_logo_url ?? terminal.tenant_logo_url,
    serverOrigin: terminal.server_origin,
  });
  await restoreBrandIcon();
  if (!terminal.brand_name || !Object.hasOwn(terminal, 'brand_logo_url') || !Object.hasOwn(terminal, 'brand_icon_url') || !terminal.brand_primary_color) {
    await refreshConfiguredBrand(terminal);
  } else {
    void refreshConfiguredBrand(terminal);
  }
  mainWindow.hide();
  await mainWindow.loadFile(path.join(currentDirectory, 'startup.html'));
  runtime = new LocalRuntime(paths, terminal, token, sendStatus);
  try {
    runtimeOrigin = await runtime.start({ initialSync });
    await mainWindow.loadURL(`${runtimeOrigin}/login`);
    mainWindow.show();
  } catch (error) {
    sendStatus({ state: 'failed', message: error instanceof Error ? error.message : 'Local Offline POS service failed.' });
    mainWindow.show();
  }
}

async function completeTerminalRegistration(response) {
  const terminal = response.terminal;
  const branding = { ...(setupApi.tenant?.branding ?? {}), ...(response.branding ?? {}) };
  await saveTerminalConfig(paths.configPath, {
    schema_version: 1,
    server_origin: setupApi.origin,
    terminal_id: terminal.terminal_id,
    terminal_name: terminal.terminal_name,
    tenant_id: terminal.tenant_id,
    tenant_code: terminal.tenant_code,
    tenant_name: terminal.tenant_name,
    brand_name: branding.site_name || terminal.tenant_name,
    brand_logo_url: branding.logo_url ?? null,
    brand_icon_url: branding.icon_url ?? null,
    brand_primary_color: branding.primary_color ?? null,
    branch_id: terminal.branch_id,
    branch_name: terminal.branch_name,
    location_id: terminal.location_id,
    location_name: terminal.location_name,
    app_key: `base64:${randomBytes(32).toString('base64')}`,
  });
  await saveSyncToken(paths.secretPath, response.sync_token, safeStorage);
  setTimeout(() => void showRuntime({ initialSync: true }), 100);
  return { terminal };
}

function registerIpc() {
  ipcMain.handle('runtime:restart', async () => {
    await runtime?.stop();
    await showRuntime();
    return true;
  });
  ipcMain.handle('runtime:open-logs', () => shell.openPath(paths.logsRoot));
  ipcMain.handle('runtime:change-tenant', async () => {
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Change business',
      message: 'Change this terminal to another business?',
      detail: 'Local data for the current business will be archived. Unsynced changes may not exist on the server.',
      buttons: ['Cancel', 'Change business'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (confirmation.response !== 1) return { changed: false };

    const terminal = await loadTerminalConfig(paths.configPath);
    mainWindow.hide();
    try {
      await runtime?.stop();
      await archiveTerminalData(paths, terminal);
    } catch (error) {
      await dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Unable to change business',
        message: 'Offline POS could not archive the current business data.',
        detail: error instanceof Error ? error.message : 'Close other programs using Offline POS data and try again.',
      });
      await showRuntime();
      return { changed: false };
    }
    runtime = null;
    runtimeOrigin = null;
    await ensureRuntimeDirectories(paths);
    await showSetup();
    return { changed: true };
  });
  ipcMain.handle('setup:activate', async (_event, payload) => {
    setupApi.connect(payload.serverUrl);
    return completeTerminalRegistration(await setupApi.activate(payload.code, {
      terminal_uuid: randomUUID(),
      platform: 'windows_pos',
      capabilities: ['orders', 'offline_outbox', 'printing', 'kds'],
      app_version: app.getVersion(),
    }));
  });
}

if (gotLock) {
  app.setAppUserModelId('com.everythingx.restx');
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });
  app.whenReady().then(async () => {
    paths = resolveRuntimePaths({
      appDataPath: app.getPath('appData'),
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      isPackaged: app.isPackaged,
    });
    await ensureRuntimeDirectories(paths);
    registerIpc();
    createWindow();
    await showRuntime();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      void showRuntime();
    }
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (!quitting && runtime?.running) {
      event.preventDefault();
      quitting = true;
      void runtime.stop().finally(() => app.quit());
    }
  });
}
