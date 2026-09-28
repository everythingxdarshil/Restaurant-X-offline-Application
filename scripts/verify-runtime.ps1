[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$php = Join-Path $projectRoot 'resources\php\php.exe'
$restx = Join-Path $projectRoot 'resources\restx'

foreach ($required in @(
    $php,
    (Join-Path $restx 'artisan'),
    (Join-Path $restx 'vendor\autoload.php'),
    (Join-Path $restx 'modulization\modules.json'),
    (Join-Path $restx 'public\index.php'),
    (Join-Path $restx 'public\build\manifest.json')
)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Packaged runtime file is missing: $required" }
}
foreach ($forbidden in @('.env', 'node_modules', 'storage', 'tests', 'database\database.sqlite')) {
    if (Test-Path -LiteralPath (Join-Path $restx $forbidden)) { throw "Forbidden runtime content is present: $forbidden" }
}

$modules = & $php -r "echo json_encode(get_loaded_extensions());"
if ($LASTEXITCODE -ne 0) { throw 'Bundled PHP could not start.' }
$loaded = $modules | ConvertFrom-Json
foreach ($extension in @('curl', 'fileinfo', 'mbstring', 'openssl', 'pdo_sqlite')) {
    if ($loaded -notcontains $extension) { throw "Bundled PHP extension is missing: $extension" }
}

& $php (Join-Path $restx 'artisan') --version
if ($LASTEXITCODE -ne 0) { throw 'The staged Laravel application could not start.' }
Write-Host 'Rest-X Windows runtime verification passed.'
