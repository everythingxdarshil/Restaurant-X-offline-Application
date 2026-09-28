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
  const [main, packageJson] = await Promise.all([
    readFile(new URL('../electron/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
  ]);

  assert.equal(packageJson.build.win.icon, 'electron/assets/app-icon.png');
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
  if (process.platform === 'win32') {
    assert.equal(local.runtimeEnvironment().APP_CONFIG_CACHE, '\\\\?\\C:\\data\\cache\\config.php');
    assert.equal(local.runtimeEnvironment().APP_PACKAGES_CACHE, undefined);
  }
});

test('sandbox preload uses CommonJS and terminal setup needs only server and restaurant code', async () => {
  const [main, css, html, setup] = await Promise.all([
    readFile(new URL('../electron/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../electron/setup.css', import.meta.url), 'utf8'),
    readFile(new URL('../electron/setup.html', import.meta.url), 'utf8'),
    readFile(new URL('../electron/setup.js', import.meta.url), 'utf8'),
  ]);

  assert.match(main, /preload\.cjs/);
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  assert.match(html, /id="server-url"/);
  assert.match(html, /id="restaurant-code"/);
  assert.match(html, /Business setup code/);
  assert.doesNotMatch(html, /Restaurant setup code/);
  assert.doesNotMatch(html, /id="login"|id="password"|id="tenant-code"/);
  assert.match(setup, /activateTerminal/);
  assert.match(main, /setupApi\.connect\(payload\.serverUrl\)/);
});

test('bundled profile menu stays clickable and exposes change business', async () => {
  const buildRoot = new URL('../resources/restx/public/build/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', buildRoot), 'utf8'));
  const navigation = Object.values(manifest).find((entry) => entry.name === 'operationsNavigationV2');

  assert.ok(navigation);
  const asset = await readFile(new URL(navigation.file, buildRoot), 'utf8');
  assert.match(asset, /restxDesktop\?\.changeTenant/);
  assert.match(asset, /zIndex:9999/);
  assert.match(asset, /Close profile menu/);
});

test('business setup code activates without a separate tenant code', async () => {
  let requestedUrl;
  let requestedBody;
  const api = new SetupApi(async (url, options) => {
    requestedUrl = url;
    requestedBody = JSON.parse(options.body);
    return { ok: true, status: 201, json: async () => ({ terminal: { tenant_id: 1 } }) };
  });

  api.connect('https://restaurant.example');
  await api.activate(' abcd2345 ', { terminal_uuid: '9ee0f9fb-f79f-4e26-9238-5c2df6b02083' });

  assert.equal(requestedUrl, 'https://restaurant.example/api/v1/desktop/setup/activate');
  assert.equal(requestedBody.code, 'ABCD2345');
  assert.equal(Object.hasOwn(requestedBody, 'tenant'), false);
});

test('normal startup opens local login before showing the window', async () => {
  const [main, css] = await Promise.all([
    readFile(new URL('../electron/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../electron/startup.css', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(main, /once\(['"]ready-to-show/);
  assert.match(main, /await mainWindow\.loadURL\(`\$\{runtimeOrigin\}\/login`\);\s*mainWindow\.show\(\);/);
  assert.match(css, /\.actions\[hidden\]\s*\{\s*display:\s*none;/);
});

test('terminal registration forces initial reference sync before local login', async () => {
  const [main, processManager] = await Promise.all([
    readFile(new URL('../electron/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../electron/process-manager.js', import.meta.url), 'utf8'),
  ]);

  assert.match(main, /showRuntime\(\{ initialSync: true \}\)/);
  assert.match(main, /showRuntime\(\{ initialSync = true \} = \{\}\)/);
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

test('an unknown business code keeps the server error', async () => {
  const api = new SetupApi(async () => ({
    ok: false, status: 404, json: async () => ({ message: 'Business not found.' }),
  }));

  await assert.rejects(
    api.discover('https://restaurant.example', 'wrong-code'),
    /Business not found/,
  );
});
