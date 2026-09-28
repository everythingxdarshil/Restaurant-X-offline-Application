[CmdletBinding()]
param(
    [string]$SourceRoot = (Join-Path $PSScriptRoot '..\..\Rest-X'),
    [string]$PhpRoot = (Split-Path -Parent (Get-Command php -ErrorAction Stop).Source)
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$resourcesRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'resources'))
$sourceRoot = [System.IO.Path]::GetFullPath($SourceRoot)
$phpRoot = [System.IO.Path]::GetFullPath($PhpRoot)
$restxTarget = [System.IO.Path]::GetFullPath((Join-Path $resourcesRoot 'restx'))
$phpTarget = [System.IO.Path]::GetFullPath((Join-Path $resourcesRoot 'php'))

foreach ($target in @($restxTarget, $phpTarget)) {
    if (-not $target.StartsWith($resourcesRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to stage outside $resourcesRoot"
    }
}

foreach ($required in @(
    (Join-Path $sourceRoot 'artisan'),
    (Join-Path $sourceRoot 'vendor\autoload.php'),
    (Join-Path $sourceRoot 'public\build\manifest.json'),
    (Join-Path $phpRoot 'php.exe')
)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Required runtime input is missing: $required" }
}

foreach ($target in @($restxTarget, $phpTarget)) {
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    New-Item -ItemType Directory -Path $target | Out-Null
}

Get-ChildItem -LiteralPath $phpRoot -Force | Copy-Item -Destination $phpTarget -Recurse -Force

foreach ($directory in @('app', 'bootstrap', 'config', 'modulization', 'resources', 'routes', 'vendor')) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot $directory) -Destination $restxTarget -Recurse -Force
}
$databaseTarget = Join-Path $restxTarget 'database'
New-Item -ItemType Directory -Path $databaseTarget | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceRoot 'database\migrations') -Destination $databaseTarget -Recurse -Force

$publicTarget = Join-Path $restxTarget 'public'
New-Item -ItemType Directory -Path $publicTarget | Out-Null
foreach ($directory in @('build', 'assets', 'images', 'sounds', 'support')) {
    $source = Join-Path $sourceRoot "public\$directory"
    if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination $publicTarget -Recurse -Force }
}
foreach ($file in @('index.php', '.htaccess', 'favicon.ico', 'robots.txt', 'offline.html', 'sw.js')) {
    $source = Join-Path $sourceRoot "public\$file"
    if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination $publicTarget -Force }
}
foreach ($file in @('artisan', 'composer.json', 'composer.lock')) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot $file) -Destination $restxTarget -Force
}

foreach ($forbidden in @('.env', 'node_modules', 'storage', 'tests', 'database\database.sqlite')) {
    if (Test-Path -LiteralPath (Join-Path $restxTarget $forbidden)) { throw "Forbidden runtime content was staged: $forbidden" }
}

Write-Host "Runtime staged under $resourcesRoot"
Write-Host 'Run scripts\verify-runtime.ps1 before creating a release.'
