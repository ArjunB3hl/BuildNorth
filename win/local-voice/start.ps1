# Starts the Rhythm local voice helper for the Windows app (see README.md). Keep this window open while you use local
# voice in Coach or Claude Code in Camera workout; Ctrl+C stops it and removes its token.
#   powershell -ExecutionPolicy Bypass -File win\local-voice\start.ps1
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$python = Join-Path $repo 'inference\pose-coach\.venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
  Write-Error 'Set up local speech first, in Git Bash: cd inference/pose-coach && bash tools/setup_voice_windows.sh'
}
# The token goes in the app's own data folder: the app reads it there, web pages cannot.
$package = Get-AppxPackage -Name NorthAssistant | Select-Object -First 1
if (-not $package) { Write-Error 'The Rhythm Windows app is not installed on this PC (build it with npm run windows in win/).' }
$state = Join-Path $env:LOCALAPPDATA "Packages\$($package.PackageFamilyName)\LocalState"
New-Item -ItemType Directory -Force $state | Out-Null
Write-Host 'Starting Rhythm local voice. Models load in the background (about a minute); keep this window open.'
& $python (Join-Path $PSScriptRoot 'service.py') --token-file (Join-Path $state 'local-voice.token')
