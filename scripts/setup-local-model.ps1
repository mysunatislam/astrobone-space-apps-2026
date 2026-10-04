param([string]$RuntimeRoot = 'E:\AstroBoneRuntime', [string]$Model = 'llama3.2:3b')
$ErrorActionPreference = 'Stop'
if ($Model -notin @('llama3.2:3b', 'gemma3:4b')) { throw 'Use an approved local model.' }
New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
$exe = Join-Path $RuntimeRoot 'ollama\ollama.exe'
if (-not (Test-Path -LiteralPath $exe)) {
  $archive = Join-Path $RuntimeRoot 'ollama-windows-amd64.zip'
  $expected = '8f3fd071a2a2f9497b562f43502c77c2b701a99d1ee5dfda28da8c786373063b'
  $cached = (Test-Path -LiteralPath $archive) -and ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -eq $expected)
  if (-not $cached) {
    & curl.exe --fail --location --retry 2 --continue-at - --output $archive 'https://github.com/ollama/ollama/releases/download/v0.34.2/ollama-windows-amd64.zip'
    if ($LASTEXITCODE -ne 0) { throw 'Ollama download failed. Rerun to resume the partial download.' }
  }
  $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw 'Ollama archive checksum mismatch.' }
  Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $RuntimeRoot 'ollama') -Force
}
$env:OLLAMA_HOST = '127.0.0.1:11434'
$env:OLLAMA_MODELS = Join-Path $RuntimeRoot 'models'
$env:OLLAMA_NO_CLOUD = '1'
$env:OLLAMA_MAX_LOADED_MODELS = '1'
try { $null = Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 3 }
catch {
  Start-Process -FilePath $exe -ArgumentList 'serve' -WindowStyle Hidden -RedirectStandardOutput (Join-Path $RuntimeRoot 'server.log') -RedirectStandardError (Join-Path $RuntimeRoot 'server-error.log') | Out-Null
  Start-Sleep -Seconds 4
}
& $exe pull $Model
if ($LASTEXITCODE -ne 0) { throw 'Language model download failed.' }
& $exe pull embeddinggemma
if ($LASTEXITCODE -ne 0) { throw 'Embedding model download failed.' }
Write-Output "Local models ready. Runtime: $RuntimeRoot; language model: $Model"
