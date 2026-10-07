# Manual portable build (bypasses electron-builder node_modules copy hang)
# Usage: powershell -ExecutionPolicy Bypass -File scripts/build-portable.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path $MyInvocation.MyCommand.Path -Parent | Split-Path -Parent

$releaseDir = Join-Path $root "release"
$electronCache = "$env:LOCALAPPDATA\electron\Cache\electron-v44.4.2-win32-x64.zip"
$unpacked = Join-Path $releaseDir "BiliDownloader-win-unpacked"
$appDir = Join-Path $unpacked "resources\app"

Write-Host "==> Clean old artifacts" -ForegroundColor Cyan
Remove-Item -Recurse -Force $releaseDir -ErrorAction SilentlyContinue

Write-Host "==> Extract electron runtime" -ForegroundColor Cyan
if (-not (Test-Path $electronCache)) {
    Write-Host "electron cache missing, download first:" -ForegroundColor Red
    Write-Host "  curl -L -o `"$electronCache`" `"https://npmmirror.com/mirrors/electron/v44.4.2/electron-v44.4.2-win32-x64.zip`"" -ForegroundColor Yellow
    exit 1
}
Expand-Archive -Path $electronCache -DestinationPath $unpacked -Force
Rename-Item -Path (Join-Path $unpacked "electron.exe") -NewName "BiliDownloader.exe"

Write-Host "==> Copy app source" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $appDir | Out-Null
Copy-Item (Join-Path $root "package.json") $appDir
Copy-Item -Recurse -Force (Join-Path $root "out") $appDir

Write-Host "==> Install production deps only (npm install --omit=dev)" -ForegroundColor Cyan
Push-Location $appDir
& npm.cmd install --omit=dev --no-audit --no-fund --loglevel=error 2>&1 | ForEach-Object { Write-Host "  $_" }
Pop-Location

Write-Host "==> Verify artifacts" -ForegroundColor Cyan
$checks = @(
    @{ Name = "BiliDownloader.exe"; Path = (Join-Path $unpacked "BiliDownloader.exe") },
    @{ Name = "package.json";      Path = (Join-Path $appDir "package.json") },
    @{ Name = "out/main/index.js"; Path = (Join-Path $appDir "out\main\index.js") },
    @{ Name = "ffmpeg.exe";        Path = (Join-Path $appDir "node_modules\@ffmpeg-installer\win32-x64\ffmpeg.exe") }
)
$ok = $true
foreach ($c in $checks) {
    if (Test-Path $c.Path) { Write-Host "  [OK] $($c.Name)" -ForegroundColor Green }
    else { Write-Host "  [MISSING] $($c.Name)" -ForegroundColor Red; $ok = $false }
}
if (-not $ok) { Write-Host "Missing required files, abort" -ForegroundColor Red; exit 1 }

$totalMB = [math]::Round((Get-ChildItem $unpacked -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 0)
Write-Host ""
Write-Host "==> Done: $unpacked ($totalMB MB)" -ForegroundColor Green
Write-Host "    Double-click BiliDownloader.exe to run" -ForegroundColor Green
Write-Host ""

# zip
$zipPath = Join-Path $releaseDir "BiliDownloader-0.1.0-x64.zip"
Write-Host "==> Packing zip: $zipPath" -ForegroundColor Cyan
Compress-Archive -Path "$unpacked\*" -DestinationPath $zipPath -Force
$zipMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host "==> zip done: $zipPath ($zipMB MB)" -ForegroundColor Green
