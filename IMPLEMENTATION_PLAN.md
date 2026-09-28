# Rest-X Windows Application Implementation Plan

## 1. Goal

Build a Windows Electron application that runs Rest-X locally, continues operating without internet access, and synchronizes supported operations with the configured Rest-X server when connectivity returns.

## Implementation status

The offline-first MVP described here is implemented. The Electron shell, first-run discovery and setup, tenant-scoped manager authentication, 2FA, branch/location binding, terminal registration and revocation, DPAPI-protected sync credential, initial reference bootstrap, local SQLite runtime, scheduler/queue processes, outbox synchronization, conflict status UI, rolling database backups, runtime staging, and release verification are present.

Production deployment, Windows code-signing, installer generation, and clean-machine acceptance testing remain release operations because they require the production server, signing certificate, and release environment. They do not require additional application architecture.

The desktop application will reuse the existing Laravel, React, Inertia, permission, localization, and local-hub synchronization code. It will not create a second business UI or duplicate backend rules in Electron.

## 2. First-release scope

Each Windows installation is permanently bound to:

- one Rest-X server;
- one tenant;
- one branch;
- one location; and
- one registered terminal identity.

The first release supports offline POS operations for the configured location. Multi-branch owners can use cloud reporting and management, but a local terminal will not mix operational data from several locations.

## 3. Architecture

```text
Electron application
    |
    | starts and monitors
    v
Bundled PHP runtime + local Laravel application
    |
    | reads and writes
    v
Local SQLite database + durable outbox
    |
    | synchronizes over HTTPS when online
    v
Configured Rest-X cloud or customer server
```

Electron will always load the local Laravel application. It will not switch the browser window between local and remote URLs.

## 4. Server and tenant discovery

### Tenant-specific server URL

Examples:

```text
https://spice-garden.restaurant-x.one
https://pos.spicegarden.com
```

The hostname identifies the tenant. Electron calls a public discovery endpoint and receives safe tenant presentation data.

### Shared server URL

Example:

```text
https://restaurant-x.one
```

A shared URL cannot identify one tenant. Electron also asks for a restaurant code, such as `spice-garden`.

The discovery endpoint accepts the restaurant code and resolves the tenant before authentication.

### Discovery response

```json
{
  "server_mode": "tenant",
  "tenant": {
    "id": 12,
    "code": "spice-garden",
    "name": "Spice Garden",
    "logo_url": "https://restaurant-x.one/media/logo.png"
  },
  "authentication": {
    "password": true,
    "pin": true,
    "two_factor": false
  }
}
```

Discovery must not expose users, branches, private settings, credentials, subscription secrets, or operational data.

## 5. First-run setup flow

1. Electron starts its bundled local runtime.
2. Electron shows the terminal setup screen.
3. Manager enters the HTTPS server URL.
4. Electron calls server discovery.
5. If the URL is shared, Electron asks for the restaurant code.
6. Electron displays the resolved restaurant name and logo.
7. Owner or branch manager signs in using existing Rest-X credentials.
8. Server returns only branches and locations available to that user.
9. Electron automatically selects a single option or displays a selector when several options exist.
10. Manager enters a terminal name, such as `Main Till`.
11. Electron registers the terminal for the selected tenant, branch, and location.
12. Server returns a terminal UUID and a dedicated synchronization token.
13. Electron encrypts the token with Windows DPAPI.
14. Electron downloads the first scoped reference snapshot.
15. Local Laravel imports tenant, branch, location, staff, roles, menu, table, tax, printer, and permitted settings data.
16. Electron verifies local health and displays the local staff login screen.

Only an owner or authorized branch manager may register or reconfigure a terminal.

## 6. Daily login flow

After setup, users do not enter the server URL, restaurant code, tenant, branch, or location again.

Staff authenticate against the local database with an existing Rest-X credential:

- username or email plus password; or
- username plus employee PIN when PIN login is enabled.

The local database contains password and PIN hashes, not plaintext credentials. Local authentication therefore continues when internet access is unavailable.

Every login must enforce all of these rules:

- user is active;
- user belongs to the terminal tenant;
- user may access the terminal branch;
- user may access the terminal location; and
- user has permission for the requested feature.

The cloud API currently permits the same email address in different tenants. Cloud setup authentication must therefore include the resolved tenant. It must not search by email without tenant scope.

## 7. Terminal identity

The terminal configuration contains non-secret scope information:

```json
{
  "schema_version": 1,
  "server_origin": "https://restaurant-x.one",
  "tenant_id": 12,
  "branch_id": 27,
  "location_id": 45,
  "terminal_id": "a2fe40d1-bbcb-4fca-830a-4f3fb5fbe25e",
  "terminal_name": "Main Till"
}
```

The synchronization token is stored separately with Windows DPAPI. The installer, application source, and configuration file must never contain a production token.

## 8. Required cloud API

### Discover server or tenant

```http
GET /api/v1/desktop/discovery
GET /api/v1/desktop/discovery?tenant=spice-garden
```

Responsibilities:

- validate the hostname and optional restaurant code;
- resolve one active tenant;
- return safe branding and authentication capabilities; and
- indicate whether a restaurant code is required.

### Setup login

```http
POST /api/v1/desktop/setup/login
```

Example request:

```json
{
  "tenant": "spice-garden",
  "login": "manager",
  "password": "secret"
}
```

Responsibilities:

- authenticate within the resolved tenant;
- enforce rate limits and 2FA when configured;
- require terminal-setup permission; and
- return a short-lived setup token.

### Available scopes

```http
GET /api/v1/desktop/setup/scopes
Authorization: Bearer <short-lived-setup-token>
```

Return only branches and locations accessible to the authenticated manager.

### Register terminal

```http
POST /api/v1/desktop/terminals
Authorization: Bearer <short-lived-setup-token>
```

Example request:

```json
{
  "terminal_uuid": "a2fe40d1-bbcb-4fca-830a-4f3fb5fbe25e",
  "name": "Main Till",
  "branch_id": 27,
  "location_id": 45,
  "platform": "windows_pos",
  "capabilities": ["orders", "offline_outbox", "printing"]
}
```

The server stores only the synchronization token hash. Plaintext token is returned once.

### Existing APIs to reuse

- local-hub reference bootstrap;
- local-hub sync ingestion;
- sync status and conflict handling;
- local-hub backups;
- health endpoint; and
- existing business APIs used by the local Laravel application.

## 9. Cloud data model

Add a cloud-side terminal registration table with at least:

- UUID;
- tenant ID;
- branch ID;
- location ID;
- terminal name;
- token hash;
- capabilities;
- registered-by user ID;
- last-seen timestamp;
- application version;
- status;
- revoked timestamp; and
- created and updated timestamps.

Cloud synchronization middleware should resolve terminal credentials from this table. Existing environment-based trusted-hub configuration may remain temporarily for migration, but database-backed registrations become the normal path.

## 10. Local data and offline behavior

Writable files live under:

```text
%APPDATA%\RestaurantX POS\
├─ database\
├─ storage\
├─ backups\
├─ logs\
├─ certificates\
├─ terminal.json
└─ secrets\
```

Offline behavior:

- business changes commit to the local database first;
- cloud-bound changes create durable outbox records in the same transaction;
- each mutation receives a stable operation UUID and request hash;
- application restart does not remove pending operations;
- Cash and Pay Later remain available;
- verified Card, QR, online wallet, charge, verification, and refund operations remain blocked;
- UI displays `Online`, `Offline`, `Syncing`, or `Conflict`; and
- permanent sync failures require manual review.

## 11. Electron responsibilities

Electron will:

- enforce one application instance;
- create and protect application-data directories;
- start bundled PHP and local Laravel processes;
- start scheduler and required queue processing;
- wait for the local health endpoint;
- open the local Rest-X UI;
- display a recovery page when startup fails;
- monitor and restart failed local processes with bounded retries;
- expose only minimal IPC methods;
- encrypt and retrieve terminal secrets through Windows DPAPI;
- provide backup, logs, service restart, diagnostics, and full-exit actions; and
- preserve local data during application upgrades.

Electron security settings:

```js
{
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true
}
```

Electron must block unexpected navigation, popup windows, arbitrary external protocols, and unapproved HTTP server URLs.

## 12. Laravel responsibilities

Local Laravel remains responsible for:

- authentication;
- tenant, branch, and location authorization;
- UI rendering;
- business validation;
- orders and payments;
- printing and KDS behavior;
- database transactions;
- outbox creation;
- synchronization;
- conflict management; and
- backups.

Electron must not duplicate these rules.

## 13. Implementation phases

### Phase 1: Desktop runtime

- Create Electron shell.
- Bundle PHP runtime.
- Start local Laravel.
- Load local UI.
- Add process health and shutdown handling.

Acceptance: Rest-X opens on a clean Windows computer without separately installed PHP or web-server software.

### Phase 2: Server discovery

- Add discovery endpoint.
- Support tenant-specific and shared URLs.
- Add restaurant-code fallback.
- Validate HTTPS and server identity.
- Display resolved tenant branding.

Acceptance: Electron resolves exactly one tenant without exposing private data.

### Phase 3: Setup authentication and scope selection

- Add tenant-scoped setup login.
- Add setup permission.
- Return authorized branches and locations.
- Add automatic single-option selection.
- Add branch and location selector.

Acceptance: Unauthorized users cannot register or reconfigure terminals.

### Phase 4: Terminal registration

- Add terminal registration table and model.
- Issue one-time plaintext synchronization token.
- Store only token hash on server.
- Encrypt token locally with DPAPI.
- Add terminal revocation and reconfiguration controls.

Acceptance: Revoked terminal cannot bootstrap or synchronize.

### Phase 5: Bootstrap and local login

- Download scoped reference data.
- Import local tenant, branch, location, staff, roles, permissions, and POS configuration.
- Enforce terminal tenant and location during login.
- Support password and PIN login offline.

Acceptance: Authorized staff can restart Windows without internet and log in locally.

### Phase 6: Offline POS and synchronization

- Verify local order and payment transactions.
- Enqueue supported mutations.
- Run background synchronization.
- Display connectivity and outbox status.
- Add retry and manual-review screens.

Acceptance: One offline operation produces exactly one cloud operation after reconnection.

### Phase 7: Packaging and recovery

- Create Windows installer.
- Keep application code read-only and customer data writable.
- Back up data before migrations.
- Preserve data during upgrade and uninstall.
- Add logs and diagnostic export.
- Sign release artifacts.

Acceptance: Fresh install, upgrade, rollback, restart, and uninstall preserve expected customer data.

## 14. Required tests

1. Tenant-specific URL resolves correct tenant.
2. Shared URL requires a valid restaurant code.
3. Unknown, inactive, or mismatched tenant is rejected.
4. Login is scoped to resolved tenant.
5. Same email in two tenants does not authenticate against wrong tenant.
6. User sees only authorized branches and locations.
7. User without setup permission cannot register terminal.
8. Terminal registration token is returned only once.
9. Token is stored encrypted locally and hashed remotely.
10. Revoked terminal cannot bootstrap or sync.
11. Initial reference import contains only configured scope.
12. Local password and PIN login work without internet.
13. User from another tenant or location cannot log in locally.
14. Offline Cash and Pay Later orders survive application restart.
15. Online-only payments remain blocked offline.
16. Reconnection synchronizes each operation exactly once.
17. Conflicting operation enters manual review.
18. Upgrade preserves terminal configuration and local database.
19. Backup restores into a clean installation.
20. Logs and diagnostics never expose credentials or tokens.

## 15. First-release exclusions

Delay these features until core offline POS passes acceptance:

- one terminal serving several tenants;
- one local database mixing several locations;
- automatic terminal movement between branches;
- offline owner-wide multi-branch reporting;
- automatic updates before code signing and rollback are proven; and
- offline support for every accounting, HR, inventory, and SaaS administration workflow.

## 16. Delivery order

Implement in this order:

1. Electron local runtime.
2. Discovery endpoint.
3. Tenant-scoped setup login.
4. Branch and location selection.
5. Terminal registration and secure token storage.
6. Reference bootstrap.
7. Offline staff login.
8. Offline POS and synchronization verification.
9. Installer, backup, diagnostics, and signing.

This order proves the desktop runtime and tenant binding before expanding offline business operations.
