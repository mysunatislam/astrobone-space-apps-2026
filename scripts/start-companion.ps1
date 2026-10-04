param(
  [string]$RuntimeRoot = 'E:\AstroBoneRuntime',
  [ValidateSet('llama3.2:3b', 'llama3.2:1b', 'gemma3:4b', 'gemma3:1b')]
  [string]$Model = 'llama3.2:3b',
  [ValidateSet(5173, 5174, 5180, 5181)][int]$Port = 5180
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $root '.artifacts\companion'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$python = Join-Path $root '.venv-companion\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) {
  throw 'Create .venv-companion and install requirements-companion.txt first. See README.'
}
$env:ASTROBONE_LOCAL_MODEL = $Model
$env:ASTROBONE_COMPANION_DB = Join-Path $RuntimeRoot 'data\crew.sqlite3'
$env:ASTROBONE_OLLAMA_URL = 'http://127.0.0.1:11434'
$env:OLLAMA_HOST = '127.0.0.1:11434'
$env:OLLAMA_MODELS = Join-Path $RuntimeRoot 'models'
$env:OLLAMA_NO_CLOUD = '1'
$env:OLLAMA_MAX_LOADED_MODELS = '1'
$ollama = Join-Path $RuntimeRoot 'ollama\ollama.exe'
try { $null = Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 }
catch {
  if (Test-Path -LiteralPath $ollama) {
    Start-Process -FilePath $ollama -ArgumentList 'serve' -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'ollama.log') -RedirectStandardError (Join-Path $logs 'ollama-error.log') | Out-Null
  } else { Write-Warning 'Ollama is not installed. Deterministic local reviews remain available.' }
}

function Wait-Endpoint([string]$Url) {
  for ($i = 0; $i -lt 30; $i++) {
    try { return Invoke-RestMethod $Url -TimeoutSec 3 }
    catch { Start-Sleep -Milliseconds 500 }
  }
  throw "Service did not start: $Url. Check $logs"
}
$apiPort = Get-NetTCPConnection -LocalPort 8010 -State Listen -ErrorAction SilentlyContinue
if (-not $apiPort) {
  Start-Process -FilePath $python -ArgumentList '-m uvicorn companion.app:app --host 127.0.0.1 --port 8010' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'api.log') -RedirectStandardError (Join-Path $logs 'api-error.log') | Out-Null
}
$health = Wait-Endpoint 'http://127.0.0.1:8010/api/companion/health'
if (-not $health.local_only) { throw 'Port 8010 is occupied by an unexpected service.' }
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  $html = (Invoke-WebRequest "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 5).Content
  if ($html -notmatch 'AstroBone') { throw "Port $Port is occupied. Use -Port 5181." }
} else {
  $node = (Get-Command node -ErrorAction Stop).Source
  Start-Process -FilePath $node -ArgumentList "node_modules/vite/bin/vite.js --host 127.0.0.1 --port $Port --strictPort" -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'web.log') -RedirectStandardError (Join-Path $logs 'web-error.log') | Out-Null
  $null = Wait-Endpoint "http://127.0.0.1:$Port/"
}
Write-Output "AstroBone: http://127.0.0.1:$Port/#crew-companion"
Write-Output "API: http://127.0.0.1:8010/docs"
Write-Output "Local model: $Model. Logs: $logs"
Write-Output 'This starts loopback-only background services. It does not expose crew observations on your network.'
