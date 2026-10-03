import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { findAvailablePort, LocalRuntime } from '../electron/process-manager.js';
import { resolveRuntimePaths } from '../electron/paths.js';
import { normalizeServerOrigin, SetupApi } from '../electron/setup-api.js';
import { resolveWindowBrand } from '../electron/window-brand.js';

test('development paths use sibling Rest-X source and system PHP', () => {
  const paths = resolveRuntimePaths({
    appDataPath: 'C:\\Users\\tester\\AppData\\Roaming',
    appPath: 'C:\\Projects\\Rest-X windows application',
    resourcesPath: 'C:\\Program Files\\Rest-X\\resources',
    isPackaged: false,
    env: {},
  });

  assert.equal(paths.restxRoot, path.resolve('C:\\Projects\\Rest-X'));
  assert.equal(paths.phpPath, 'php');
  assert.match(paths.configPath, /RestaurantX POS[\\/]terminal\.json$/);
  assert.match(paths.brandIconPath, /RestaurantX POS[\\/]brand-icon$/);
});

test('window branding uses restaurant name and only safe favicon URLs', () => {
  assert.deepEqual(resolveWindowBrand({
    siteName: ' Copper Leaf ', logoUrl: '/storage/logo.png', serverOrigin: 'https://restaurant.example',
  }), { title: 'Copper Leaf', logoUrl: 'https://restaurant.example/storage/logo.png' });
  assert.equal(resolveWindowBrand({ logoUrl: 'http://example.com/logo.png' }).logoUrl, null);
  assert.equal(resolveWindowBrand({
    iconUrl: '/favicon.png', logoUrl: '/logo.png', serverOrigin: 'https://restaurant.example',
  }).logoUrl, 'https://restaurant.example/favicon.png');
  assert.deepEqual(resolveWindowBrand({}), { title: 'Offline POS', logoUrl: null });
});

test('desktop preserves the discovered restaurant color during registration and refresh', async () => {
  const main = await readFile(new URL('../electron/main.js', import.meta.url), 'utf8');
  assert.match(main, /brand_primary_color: Object\.hasOwn\(branding, 'primary_color'\)/);
  assert.match(main, /const branding = \{ \.\.\.\(setupApi\.tenant\?\.branding \?\? \{\}\), \.\.\.\(response\.branding \?\? \{\}\) \}/);
});

test('Windows package and runtime use the Offline POS application icon', async () => {
  const [main, packageJson, installer] = await Promise.all([
    readFile(new URL('../electron/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../build/installer.nsh', import.meta.url), 'utf8'),
  ]);

  assert.equal(packageJson.build.win.icon, 'electron/assets/app-icon.png');
  assert.equal(packageJson.build.nsis.include, 'build/installer.nsh');
  assert.doesNotMatch(installer, /Business setup code/);
  assert.match(installer, /Application name/);
  assert.match(installer, /This name appears in Windows Search/);
  assert.match(installer, /pending-installer-setup\.txt/);
  assert.ok(installer.indexOf('pending-installer-setup.txt') < installer.indexOf('!macro customInstall'));
  const installerPage = installer.match(/Function BusinessSetupPageCreate([\s\S]*?)FunctionEnd/)?.[1] ?? '';
  assert.match(installerPage, /StrCpy \$InstallerOriginalAppData \$APPDATA\s+SetShellVarContext current/);
  assert.match(installerPage, /FileRead \$0 \$InstallerServerUrl/);
  assert.doesNotMatch(installerPage, /terminal\.json/);
  assert.match(installer, /Function BusinessSetupPageLeave[\s\S]*StrCpy \$InstallerOriginalAppData \$APPDATA\s+SetShellVarContext current\s+CreateDirectory "\$APPDATA\\RestaurantX POS"/);
  assert.match(installer, /FileClose \$0\s+\$\{If\} \$APPDATA != \$InstallerOriginalAppData\s+SetShellVarContext all/);
  assert.doesNotMatch(installer, /\$installMode/);
  assert.match(installer, /ReadRegStr \$InstallerPreviousAppName SHELL_CONTEXT "\$\{INSTALL_REGISTRY_KEY\}" ShortcutName/);
  assert.match(installer, /\$InstallerPreviousAppName != \$InstallerAppName[\s\S]*Delete "\$SMPROGRAMS\\\$InstallerPreviousAppName\.lnk"/);
  assert.match(installer, /WriteRegStr SHELL_CONTEXT "\$\{INSTALL_REGISTRY_KEY\}" ShortcutName "\$InstallerAppName"/);
  assert.doesNotMatch(installer, /\$\{isUpdated\}/);
  assert.match(installer, /!include "MUI2\.nsh"[\s\S]*MUI_HEADER_TEXT "Set up Offline POS"/);
  assert.match(main, /icon: applicationIconPath/);
  assert.match(main, /mainWindow\?\.setIcon\(icon\)/);
  assert.match(main, /mainWindow\.setIcon\(applicationIconPath\)/);
  assert.match(main, /app\.setAppUserModelId\('com\.everythingx\.restx'\)/);
});

test('local runtime can reserve an available TCP port', async () => {
  const port = await findAvailablePort();
  assert.ok(Number.isInteger(port));
  assert.ok(port > 0 && port <= 65535);
});

test('desktop runtime bypasses the web installer marker', async () => {
  const [frontController, bootstrap, viewConfig] = await Promise.all([
    readFile(new URL('../resources/restx/public/index.php', import.meta.url), 'utf8'),
    readFile(new URL('../resources/restx/bootstrap/app.php', import.meta.url), 'utf8'),
    readFile(new URL('../resources/restx/config/view.php', import.meta.url), 'utf8'),
  ]);
  assert.match(frontController, /\$desktopRuntime = getenv\('LOCAL_HUB_MODE'\) === 'hub';/);
  assert.match(frontController, /!\$desktopRuntime && !file_exists\(\$installedMarker\)/);
  assert.match(bootstrap, /\$app->useStoragePath\(\$storagePath\)/);
  assert.match(viewConfig, /realpath\(storage_path\('framework\/views'\)\)/);
});

test('server origin requires HTTPS except for loopback development', () => {
  assert.equal(normalizeServerOrigin('https://restaurant-x.one/'), 'https://restaurant-x.one');
  assert.equal(normalizeServerOrigin('http://127.0.0.1:8000'), 'http://127.0.0.1:8000');
  assert.throws(() => normalizeServerOrigin('http://example.com'), /HTTPS/);
  assert.throws(() => normalizeServerOrigin('https://example.com/path'), /server origin/);
});

test('only an explicitly selected loopback server enables insecure local transport', () => {
  const paths = { bootstrapCacheRoot: 'C:\\data\\cache', databasePath: 'C:\\data\\db.sqlite', storageRoot: 'C:\\data\\storage' };
  const local = new LocalRuntime(paths, {
    server_origin: 'http://127.0.0.1:8000', app_key: 'key', terminal_id: 'id', tenant_id: 1,
    branch_id: 3, branch_name: 'Main Branch', location_id: 2, location_name: 'Main',
  }, 'secret');
  const remote = new LocalRuntime(paths, {
    server_origin: 'https://example.com', app_key: 'key', terminal_id: 'id', tenant_id: 1,
    branch_id: 3, branch_name: 'Main Branch', location_id: 2, location_name: 'Main',
  }, 'secret');

  assert.equal(local.runtimeEnvironment().LOCAL_HUB_ALLOW_INSECURE_LOOPBACK, 'true');
  assert.equal(remote.runtimeEnvironment().LOCAL_HUB_ALLOW_INSECURE_LOOPBACK, 'false');
  assert.equal(local.runtimeEnvironment().LOCAL_HUB_BRANCH_ID, '3');
  assert.equal(local.runtimeEnvironment().LOCAL_HUB_BRANCH_NAME, 'Main Branch');
  const branded = new LocalRuntime(paths, {
    server_origin: 'https://example.com', app_key: 'key', terminal_id: 'id', tenant_id: 1,
    branch_id: 3, location_id: 2, tenant_name: 'Tenant', brand_name: 'Copper Leaf',
    brand_logo_url: 'https://example.com/logo.png',
    brand_icon_url: 'https://example.com/favicon.png',
    brand_primary_color: '#ff6900',
  }, 'secret').runtimeEnvironment();
  assert.equal(branded.LOCAL_HUB_BRAND_NAME, 'Copper Leaf');
  assert.equal(branded.LOCAL_HUB_BRAND_LOGO_URL, 'https://example.com/logo.png');
  assert.equal(branded.LOCAL_HUB_BRAND_ICON_URL, 'https://example.com/favicon.png');
  assert.equal(branded.LOCAL_HUB_BRAND_PRIMARY_COLOR, '#ff6900');
  const initialLogin = new LocalRuntime(paths, {
    server_origin: 'https://example.com', app_key: 'key', terminal_id: 'id', tenant_id: 1,
    branch_id: 3, branch_name: 'Main Branch', location_id: 2, location_name: 'Main',
  }, 'secret', () => {}, { userId: 42, token: 'one-time-token', expiresAt: 1234567890 }).runtimeEnvironment();
  assert.equal(initialLogin.LOCAL_HUB_INITIAL_LOGIN_USER_ID, '42');
  assert.equal(initialLogin.LOCAL_HUB_INITIAL_LOGIN_TOKEN, 'one-time-token');
  assert.equal(initialLogin.LOCAL_HUB_INITIAL_LOGIN_EXPIRES_AT, '1234567890');
  if (process.platform === 'win32') {
    assert.equal(local.runtimeEnvironment().APP_CONFIG_CACHE, '\\\\?\\C:\\data\\cache\\config.php');
    assert.equal(local.runtimeEnvironment().APP_PACKAGES_CACHE, undefined);
  }
});

test('sandbox preload uses CommonJS and terminal setup uses account login', async () => {
  const [main, css, html, setup] = await Promise.all([
    readFile(new URL('../electron/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../electron/setup.css', import.meta.url), 'utf8'),
    readFile(new URL('../electron/setup.html', import.meta.url), 'utf8'),
    readFile(new URL('../electron/setup.js', import.meta.url), 'utf8'),
  ]);

  assert.match(main, /preload\.cjs/);
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  assert.doesNotMatch(html, /id="server-url"/);
  assert.match(html, /id="brand-name"/);
  assert.match(html, /id="login"/);
  assert.match(html, /id="password"/);
  assert.match(html, /id="two-factor-code"/);
  assert.match(html, /id="branch"/);
  assert.doesNotMatch(html, /id="location"/);
  assert.doesNotMatch(html, /Choose location/i);
  assert.doesNotMatch(html, /setup code/i);
  assert.doesNotMatch(html, /owner or branch manager/i);
  assert.match(setup, /loginSetup/);
  assert.match(setup, /initializeSetup/);
  assert.match(setup, /primary_color/);
  assert.match(setup, /applyBranding\(result\.tenant, result\.branding\)/);
  assert.match(setup, /registerTerminal/);
  assert.doesNotMatch(setup, /locationId/);
  assert.doesNotMatch(setup, /locationId/);
  assert.match(main, /setupApi\.discover\(serverUrl\)/);
});

test('setup login can omit tenant when server must resolve a unique account', async () => {
  let requestedBody;
  const api = new SetupApi(async (_url, options) => {
    requestedBody = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ setup_token: 'token' }) };
  });

  api.connect('https://restaurant.example');
  await api.login('owner@example.test', 'password');

  assert.deepEqual(requestedBody, { login: 'owner@example.test', password: 'password' });
});

test('desktop profile menu has no change business action', async () => {
  const buildRoot = new URL('../resources/restx/public/build/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', buildRoot), 'utf8'));
  const navigation = Object.values(manifest).find((entry) => entry.name === 'operationsNavigationV2');
  const preload = await readFile(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  const main = await readFile(new URL('../electron/main.js', import.meta.url), 'utf8');

  assert.ok(navigation);
  const asset = await readFile(new URL(navigation.file, buildRoot), 'utf8');
  assert.doesNotMatch(preload, /changeTenant/);
  assert.doesNotMatch(main, /runtime:change-tenant/);
  assert.match(asset, /zIndex:9999/);
  assert.match(asset, /Close profile menu/);
});

test('runtime opens a one-time initial session or the normal local login before showing the window', async () => {
  const [main, css] = await Promise.all([
    readFile(new URL('../electron/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../electron/startup.css', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(main, /once\(['"]ready-to-show/);
  assert.match(main, /`\$\{runtimeOrigin\}\/desktop\/initial-login`/);
  assert.match(main, /extraHeaders: `X-RestX-Initial-Login: \$\{initialLogin\.token\}\\r\\n`/);
  assert.match(main, /await mainWindow\.loadURL\(`\$\{runtimeOrigin\}\/login`\)/);
  assert.match(main, /mainWindow\.show\(\)/);
  assert.doesNotMatch(main, /desktop\/initial-login\?token=/);
  assert.match(css, /\.actions\[hidden\]\s*\{\s*display:\s*none;/);
});

test('terminal registration forces initial reference sync before local login', async () => {
  const [main, processManager] = await Promise.all([
    readFile(new URL('../electron/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../electron/process-manager.js', import.meta.url), 'utf8'),
  ]);

  assert.match(main, /showRuntime\(\{ initialSync: true, initialLogin \}\)/);
  assert.match(main, /showRuntime\(\{ initialSync = true, initialLogin = null \} = \{\}\)/);
  assert.match(processManager, /start\(\{ initialSync = false \} = \{\}\)/);
  assert.match(processManager, /prepareRuntime\(initialSync\)/);
  assert.match(processManager, /commandOutput\.trim\(\)\.split/);
  assert.match(processManager, /spawn\('taskkill', \['\/pid', String\(child\.pid\), '\/t', '\/f'\]/);
});

test('old servers return an actionable desktop API error', async () => {
  const api = new SetupApi(async () => ({
    ok: false, status: 404, json: async () => ({ message: 'Route not found.' }),
  }));

  await assert.rejects(
    api.discover('https://restaurant.example'),
    /Deploy latest backend first/,
  );
});

test('configured terminals request location branding', async () => {
  let requestedUrl;
  const api = new SetupApi(async (url) => {
    requestedUrl = url;
    return { ok: true, status: 200, json: async () => ({ tenant: { code: 'copper-leaf' } }) };
  });

  await api.discover('https://restaurant.example', 'copper-leaf', 7);
  assert.equal(requestedUrl, 'https://restaurant.example/api/v1/desktop/discovery?tenant=copper-leaf&location_id=7');
});
