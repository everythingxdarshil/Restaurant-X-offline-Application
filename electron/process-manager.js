import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, copyFile, open, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

const HOST = '127.0.0.1';
const laravelCachePath = (value) => process.platform === 'win32' && path.isAbsolute(value) ? `\\\\?\\${value}` : value;

export function findAvailablePort(host = HOST) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

export function healthCheck(url, timeoutMs = 1_000) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.once('timeout', () => request.destroy());
    request.once('error', () => resolve(false));
  });
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function stopProcessTree(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    const timeout = setTimeout(resolve, 5_000);
    child.once('close', () => { clearTimeout(timeout); resolve(); });
    if (process.platform === 'win32' && child.pid) {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.once('error', () => child.kill());
    } else {
      child.kill();
    }
  });
}

export async function waitForHealth(url, { attempts = 60, intervalMs = 250 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await healthCheck(url)) return;
    await delay(intervalMs);
  }

  throw new Error(`Local Offline POS server did not become healthy at ${url}.`);
}

export class LocalRuntime {
  constructor(paths, terminal, syncToken, onStatus = () => {}) {
    this.paths = paths;
    this.terminal = terminal;
    this.syncToken = syncToken;
    this.onStatus = onStatus;
    this.processes = [];
    this.origin = null;
    this.logStream = null;
  }

  get running() {
    return this.processes.some((child) => child.exitCode === null && !child.killed);
  }

  async start({ initialSync = false } = {}) {
    if (this.running) return this.origin;

    await this.validateRuntime();
    this.logStream = createWriteStream(path.join(this.paths.logsRoot, 'runtime.log'), { flags: 'a' });
    const logStream = this.logStream;
    logStream.on('error', () => {
      if (this.logStream === logStream) this.logStream = null;
    });
    await this.prepareRuntime(initialSync);
    const port = await findAvailablePort();
    this.origin = `http://${HOST}:${port}`;
    this.onStatus({ state: 'starting', message: 'Starting local Offline POS service…' });

    const child = this.spawnProcess([
      'artisan',
      'serve',
      `--host=${HOST}`,
      `--port=${port}`,
      '--no-reload',
    ], { APP_URL: this.origin });
    child.once('exit', (code) => {
      if (code !== 0 && this.running) {
        this.onStatus({ state: 'failed', message: `Local Offline POS service stopped with code ${code}.` });
      }
    });

    try {
      await Promise.race([
        waitForHealth(`${this.origin}/up`),
        new Promise((_, reject) => {
          child.once('error', reject);
          child.once('exit', (code) => reject(new Error(`Local Offline POS service exited with code ${code}.`)));
        }),
      ]);
    } catch (error) {
      await this.stop();
      throw error;
    }

    this.onStatus({ state: 'ready', message: 'Local Offline POS service is ready.' });
    this.spawnProcess(['artisan', 'schedule:work']);
    this.spawnProcess(['artisan', 'queue:work', 'database', '--sleep=2', '--tries=3', '--timeout=90']);
    return this.origin;
  }

  async restart() {
    await this.stop();
    return this.start();
  }

  async stop() {
    const processes = this.processes.splice(0);
    await Promise.all(processes.map(stopProcessTree));
    const logStream = this.logStream;
    this.logStream = null;
    if (logStream && !logStream.destroyed && !logStream.writableEnded) {
      await new Promise((resolve) => {
        logStream.once('error', resolve);
        logStream.end(resolve);
      });
    }
    this.origin = null;
  }

  async validateRuntime() {
    const required = [
      path.join(this.paths.restxRoot, 'artisan'),
      path.join(this.paths.restxRoot, 'vendor', 'autoload.php'),
      path.join(this.paths.restxRoot, 'public', 'build', 'manifest.json'),
    ];

    try {
      await Promise.all(required.map((file) => access(file)));
    } catch {
      throw new Error(`Offline POS runtime is incomplete at ${this.paths.restxRoot}.`);
    }
  }

  async prepareRuntime(initialSync = false) {
    const database = await open(this.paths.databasePath, 'a');
    await database.close();
    await this.backupDatabase();
    this.onStatus({ state: 'starting', message: 'Preparing local database…' });
    await this.runArtisan(['artisan', 'migrate', '--force']);
    let needsBootstrap = initialSync;
    if (!needsBootstrap) {
      try { await access(this.paths.bootstrapMarker); } catch { needsBootstrap = true; }
    }
    if (needsBootstrap) {
      this.onStatus({ state: 'starting', message: 'Downloading business data…' });
      await this.runArtisan(['artisan', 'local-hub:bootstrap', '--initial']);
      await writeFile(this.paths.bootstrapMarker, new Date().toISOString(), 'utf8');
    }
  }

  async backupDatabase() {
    const database = await stat(this.paths.databasePath);
    if (database.size === 0) return;

    const timestamp = new Date().toISOString().replaceAll(':', '-');
    await copyFile(this.paths.databasePath, path.join(this.paths.backupsRoot, `before-startup-${timestamp}.sqlite`));
    const backups = (await readdir(this.paths.backupsRoot))
      .filter((name) => name.startsWith('before-startup-') && name.endsWith('.sqlite'))
      .sort()
      .reverse();
    await Promise.all(backups.slice(5).map((name) => unlink(path.join(this.paths.backupsRoot, name))));
  }

  runtimeEnvironment(overrides = {}) {
    let allowInsecureLoopback = false;
    try {
      allowInsecureLoopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(this.terminal.server_origin).hostname);
    } catch { /* setup validation prevents invalid origins */ }
    return {
      ...process.env,
      APP_ENV: 'production', APP_DEBUG: 'false', APP_KEY: this.terminal.app_key,
      APP_URL: 'http://127.0.0.1', DB_CONNECTION: 'sqlite', DB_DATABASE: this.paths.databasePath,
      CACHE_STORE: 'file', SESSION_DRIVER: 'file', QUEUE_CONNECTION: 'database',
      LARAVEL_STORAGE_PATH: this.paths.storageRoot,
      APP_EVENTS_CACHE: laravelCachePath(path.join(this.paths.bootstrapCacheRoot, 'events.php')),
      APP_CONFIG_CACHE: laravelCachePath(path.join(this.paths.bootstrapCacheRoot, 'config.php')),
      APP_ROUTES_CACHE: laravelCachePath(path.join(this.paths.bootstrapCacheRoot, 'routes.php')),
      LOCAL_HUB_ENABLED: 'true', LOCAL_HUB_MODE: 'hub', LOCAL_HUB_ID: this.terminal.terminal_id,
      LOCAL_HUB_TENANT_ID: String(this.terminal.tenant_id),
      LOCAL_HUB_BRANCH_ID: String(this.terminal.branch_id),
      LOCAL_HUB_BRANCH_NAME: this.terminal.branch_name,
      LOCAL_HUB_LOCATION_ID: String(this.terminal.location_id),
      LOCAL_HUB_LOCATION_NAME: this.terminal.location_name,
      LOCAL_HUB_BRAND_NAME: this.terminal.brand_name || this.terminal.tenant_name,
      LOCAL_HUB_BRAND_LOGO_URL: this.terminal.brand_logo_url || '',
      LOCAL_HUB_BRAND_ICON_URL: this.terminal.brand_icon_url || '',
      LOCAL_HUB_BRAND_PRIMARY_COLOR: this.terminal.brand_primary_color || '',
      LOCAL_HUB_CLOUD_URL: this.terminal.server_origin, LOCAL_HUB_CLOUD_TOKEN: this.syncToken,
      LOCAL_HUB_ALLOW_INSECURE_LOOPBACK: allowInsecureLoopback ? 'true' : 'false',
      ...overrides,
    };
  }

  spawnProcess(args, env = {}) {
    const child = spawn(this.paths.phpPath, args, {
      cwd: this.paths.restxRoot, env: this.runtimeEnvironment(env), windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.processes.push(child);
    this.attachLogs(child);
    return child;
  }

  attachLogs(child) {
    for (const output of [child.stdout, child.stderr]) {
      output?.on('data', (chunk) => {
        if (this.logStream && !this.logStream.destroyed && !this.logStream.writableEnded) {
          this.logStream.write(chunk);
        }
      });
    }
  }

  runArtisan(args) {
    return new Promise((resolve, reject) => {
      let commandOutput = '';
      const child = spawn(this.paths.phpPath, args, {
        cwd: this.paths.restxRoot, env: this.runtimeEnvironment(), windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.attachLogs(child);
      for (const output of [child.stdout, child.stderr]) {
        output?.on('data', (chunk) => { commandOutput += chunk; });
      }
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code === 0) return resolve();
        const message = commandOutput.trim().split(/\r?\n/).filter(Boolean).at(-1);
        reject(new Error(message || `Local setup command failed with code ${code}.`));
      });
    });
  }
}
