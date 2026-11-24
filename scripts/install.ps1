param(
  [string]$TargetDir = (Join-Path $env:USERPROFILE ".gemini\config\plugins\liquid-canvas")
)
$ErrorActionPreference = 'Stop'

$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))

# Locate Node runtime (system node or Antigravity bundled agy-node)
$NodeExe = $null
$cmd = Get-Command node -ErrorAction SilentlyContinue
if ($cmd -and $cmd.Source) {
  $NodeExe = $cmd.Source
} else {
  $agyNode = Join-Path $env:APPDATA "Antigravity\bin\agy-node.cmd"
  if (Test-Path $agyNode) { $NodeExe = $agyNode }
}

if (-not $NodeExe) {
  throw "Could not find node or agy-node.cmd to run build script."
}

Write-Host "Building dist/board.html..."
& $NodeExe (Join-Path $Root "scripts\build.mjs")
if ($LASTEXITCODE -ne 0) { throw "Build failed." }

$Target = [System.IO.Path]::GetFullPath($TargetDir)
New-Item -ItemType Directory -Force $Target | Out-Null

# Copy runtime plugin files cleanly (without source tests/vendor)
$Items = @("plugin.json", "mcp_config.json", "README.md", "LICENSE")
foreach ($item in $Items) {
  Copy-Item -Force (Join-Path $Root $item) (Join-Path $Target $item)
}

foreach ($dir in @("assets", "dist", "server", "skills")) {
  $srcDir = Join-Path $Root $dir
  $dstDir = Join-Path $Target $dir
  if (Test-Path $dstDir) { Remove-Item -Recurse -Force $dstDir }
  Copy-Item -Recurse -Force $srcDir $dstDir
}

$Vendor = Join-Path $Root "ui\vendor"
$NoticeDir = Join-Path $Target "ui\vendor"
$NoticeFiles = @(
  (Join-Path $Vendor "EXT_APPS_LICENSE.txt")
  (Join-Path $Vendor "THIRD_PARTY_NOTICES.txt")
)
New-Item -ItemType Directory -Force -Path $NoticeDir | Out-Null
Copy-Item -LiteralPath $NoticeFiles -Destination $NoticeDir -Force

Write-Host "Installed Liquid Canvas plugin to: $Target"
