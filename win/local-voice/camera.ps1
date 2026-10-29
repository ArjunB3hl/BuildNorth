# Starts the local camera coach (inference/pose-coach) for the Rhythm Windows app's Camera workout (see README.md).
# Keep this window open while you work out; Ctrl+C stops it.
#   powershell -ExecutionPolicy Bypass -File win\local-voice\camera.ps1
# It needs the speech setup (tools/setup_voice_windows.sh) and the camera assets (WEB_KOKORO=0 tools/fetch_assets.sh).
# Run it or start.ps1, not both at once on an 8 GB PC: each loads its own Parakeet and Kokoro (about 1.5 GB).
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$pose = Join-Path $repo 'inference\pose-coach'
$python = Join-Path $pose '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
  Write-Error 'Set up local speech first, in Git Bash: cd inference/pose-coach && bash tools/setup_voice_windows.sh'
}
if (-not (Test-Path (Join-Path $pose 'web\vendor\tasks-vision-1.1.0'))) {
  Write-Error 'Fetch the camera assets first, in Git Bash: cd inference/pose-coach && WEB_KOKORO=0 bash tools/fetch_assets.sh'
}
# Claude coaches through Claude Code on your Claude sign-in, never an API key (server/claude_code.py removes every
# ANTHROPIC_*/CLAUDE* variable before it starts Claude Code).
$env:POSE_CLAUDE_TRANSPORT = 'cli'
# No coach session logs: they would keep the measured events and your transcribed words.
$env:POSE_COACH_LOG = '0'
# Anything the page saves (only "Save set for debugging", off by default: body landmarks, no images) goes here.
# Delete the folder to remove it.
$env:POSE_DATA_DIR = Join-Path $pose '.data\windows-app'
New-Item -ItemType Directory -Force $env:POSE_DATA_DIR | Out-Null
Write-Host 'Starting the camera coach on http://127.0.0.1:8765. Speech models load in the background; keep this window open.'
& $python (Join-Path $pose 'server\dev_server.py') --port 8765
