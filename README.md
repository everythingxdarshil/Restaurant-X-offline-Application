# Rest-X Windows

Electron host for the Rest-X offline-first Windows POS. The application binds one installation to one server, tenant, branch, and location. It runs the existing Laravel/React application locally with SQLite and synchronizes through the Rest-X local-hub APIs.

## Current flow

1. On first launch, enter the Rest-X HTTPS server URL and restaurant code when required.
2. Sign in as an owner or branch manager. Two-factor authentication is supported.
3. Choose an authorized branch and location and name the terminal.
4. The server registers the terminal. Its sync token is hashed on the server and encrypted locally with Windows DPAPI.
5. The app imports scoped reference data, starts local Laravel, the scheduler, and the database queue worker, then displays the local UI.
6. Later launches use the saved binding. POS writes remain local while offline and the existing outbox synchronizes when connectivity returns.

Customer data is stored under `%APPDATA%\RestaurantX POS`. Application upgrades do not replace that directory.

## Open in PhpStorm

Open `C:\EverythingX\Projects\Rest-X windows application` as a project. For application code, also attach `C:\EverythingX\Projects\Rest-X` as a second content root. Use Node.js 22 or newer and PHP 8.3.

For source-mode testing, set these optional environment variables when the sibling folders or executables differ:

```powershell
$env:RESTX_SOURCE_PATH = 'C:\EverythingX\Projects\Rest-X'
$env:RESTX_PHP_PATH = 'C:\php-8.3.30\php.exe'
npm start
```

No Vite server is needed; Electron serves the existing compiled assets through local Laravel.

## Prepare a Windows release

The Laravel frontend assets and Composer dependencies must already exist in the source project. Stage only the production runtime:

```powershell
.\scripts\stage-runtime.ps1 -SourceRoot 'C:\EverythingX\Projects\Rest-X' -PhpRoot 'C:\php-8.3.30'
.\scripts\verify-runtime.ps1
npm test
```

The configured release pipeline creates the NSIS installer in `dist`. Production releases must be code-signed with the organization's Windows signing certificate before distribution. Do not commit staged production secrets, `.env` files, terminal tokens, SQLite databases, or `%APPDATA%` content.

## Server deployment

Deploy the matching Rest-X backend changes first, including the `local_hub_installations` migration. Run normal production migrations on the server. Its `LOCAL_HUB_MODE` must be `cloud`, and the desktop server URL must use a valid HTTPS certificate.

Managers can list and revoke terminals through:

- `GET /api/v1/desktop/terminals`
- `DELETE /api/v1/desktop/terminals/{installation}`

Both require a short-lived desktop setup token obtained through the tenant-scoped setup login.

## Recovery

The startup screen shows errors and provides restart and log-folder actions. Runtime logs are in `%APPDATA%\RestaurantX POS\logs`. Preserve the whole `%APPDATA%\RestaurantX POS` folder before manual recovery or moving a terminal. Revoking a terminal on the server immediately blocks future bootstrap and sync requests from its credential.
