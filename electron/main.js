import { app, BrowserWindow, dialog, ipcMain, nativeImage, net, safeStorage, shell } from 'electron';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureRuntimeDirectories, resolveRuntimePaths } from './paths.js';
import { loadInstallerSetup } from './installer-setup.js';
import { archiveTerminalData } from './terminal-reset.js';
import { LocalRuntime } from './process-manager.js';
import { isLocalRuntimeUrl } from './navigation-policy.js';
import { loadSyncToken, saveSyncToken } from './secret-store.js';
import { normalizeServerOrigin, SetupApi } from './setup-api.js';
import { loadTerminalConfig, saveTerminalConfig } from './terminal-config.js';
import { DEFAULT_WINDOW_TITLE, resolveWindowBrand } from './window-brand.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const localPagePrefix = pathToFileURL(`${currentDirectory}${path.sep}`).href;
const setupPageUrl = pathToFileURL(path.join(currentDirectory, 'setup.html')).href;
const applicationIconPath = path.join(currentDirectory, 'assets', 'app-icon.png');
let mainWindow;
let runtime;
let runtimeOrigin;
let paths;
let setupApi;
let setupUserId;
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
  setupUserId = null;
  setWindowTitle(DEFAULT_WINDOW_TITLE);
  mainWindow.setIcon(applicationIconPath);
  await mainWindow.loadFile(path.join(currentDirectory, 'setup.html'));
  mainWindow.show();
}

async function showRuntime({ initialSync = true, initialLogin = null } = {}) {
  const terminal = await loadTerminalConfig(paths.configPath);
  const installerSetup = await loadInstallerSetup(paths.installerSetupPath);
  if (terminal && installerSetup) {
    let requestedServer;
    try {
      requestedServer = normalizeServerOrigin(installerSetup.serverUrl);
    } catch (error) {
      await dialog.showMessageBox({
        type: 'error',
        message: 'Invalid server URL from installer',
        detail: error instanceof Error ? error.message : 'Enter a valid server URL during installation.',
      });
      await writeFile(paths.installerSetupPath, `${terminal.server_origin}\n`, 'utf8');
    }
    if (requestedServer && requestedServer !== normalizeServerOrigin(terminal.server_origin)) {
      const { response } = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['Keep current server', 'Use new server'],
        defaultId: 0,
        cancelId: 0,
        message: 'Change server for this terminal?',
        detail: `Current server: ${terminal.server_origin}\nNew server: ${requestedServer}\n\nUsing the new server archives local terminal data, including unsynced changes. You can restore it from the archive later.`,
      });
      if (response === 1) {
        try {
          await archiveTerminalData(paths, terminal);
          await ensureRuntimeDirectories(paths);
          await writeFile(paths.installerSetupPath, `${requestedServer}\n`, 'utf8');
          await showSetup();
          return;
        } catch (error) {
          await dialog.showMessageBox({
            type: 'error',
            message: 'Unable to change server',
            detail: error instanceof Error ? error.message : 'Unable to archive local terminal data.',
          });
        }
      }
      await writeFile(paths.installerSetupPath, `${terminal.server_origin}\n`, 'utf8');
    }
  }
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
  runtime = new LocalRuntime(paths, terminal, token, sendStatus, initialLogin);
  try {
    runtimeOrigin = await runtime.start({ initialSync });
    if (initialLogin) {
      await mainWindow.loadURL(`${runtimeOrigin}/desktop/initial-login`, {
        extraHeaders: `X-RestX-Initial-Login: ${initialLogin.token}\r\n`,
      });
    } else {
      await mainWindow.loadURL(`${runtimeOrigin}/login`);
    }
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
  const initialLogin = setupUserId ? {
    userId: setupUserId,
    token: randomBytes(32).toString('hex'),
    expiresAt: Math.floor(Date.now() / 1000) + 300,
  } : null;
  setupUserId = null;
  setTimeout(() => void showRuntime({ initialSync: true, initialLogin }), 100);
  return { terminal };
}

function registerIpc() {
  const requireSetupPage = (event) => {
    if (event.senderFrame.url !== setupPageUrl) throw new Error('Terminal setup is available only from the setup screen.');
  };
  const setupScopes = async () => ({ scopes: await setupApi.scopes() });
  ipcMain.handle('runtime:restart', async () => {
    await runtime?.stop();
    await showRuntime();
    return true;
  });
  ipcMain.handle('runtime:open-logs', () => shell.openPath(paths.logsRoot));
  ipcMain.handle('setup:initialize', async (event) => {
    requireSetupPage(event);
    const installerSetup = await loadInstallerSetup(paths.installerSetupPath);
    const terminal = await loadTerminalConfig(paths.configPath);
    const serverUrl = installerSetup?.serverUrl || terminal?.server_origin;
    if (!serverUrl) throw new Error('Server URL is missing. Reinstall Offline POS and enter the server URL during installation.');
    const result = await setupApi.discover(serverUrl);
    const branding = result.tenant?.branding ?? result.branding;
    if (branding) applyWindowBrand({
      siteName: branding.site_name || result.tenant?.name,
      iconUrl: branding.icon_url,
      logoUrl: branding.logo_url,
      serverOrigin: setupApi.origin,
    });
    return { tenant: result.tenant, branding: result.branding };
  });
  ipcMain.handle('setup:login', async (event, payload) => {
    requireSetupPage(event);
    if (!setupApi.origin) throw new Error('Server connection is not initialized.');
    const result = await setupApi.login(payload.login, payload.password);
    if (result.requires_two_factor) return { requiresTwoFactor: true };
    setupUserId = result.user?.id ?? null;
    return setupScopes();
  });
  ipcMain.handle('setup:verify-two-factor', async (event, code) => {
    requireSetupPage(event);
    const result = await setupApi.verifyTwoFactor(code);
    setupUserId = result.user?.id ?? null;
    return setupScopes();
  });
  ipcMain.handle('setup:register', async (event, payload) => {
    requireSetupPage(event);
    const scopes = await setupApi.scopes();
    const branch = scopes.branches.find(({ id }) => id === payload.branchId);
    if (!branch) throw new Error('Select an available branch.');
    return completeTerminalRegistration(await setupApi.register({
      terminal_uuid: randomUUID(),
      name: `${branch.name} POS`,
      branch_id: branch.id,
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
