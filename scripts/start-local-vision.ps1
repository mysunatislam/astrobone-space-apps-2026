param([string]$Runtime = 'E:\AstroBoneRuntime\vision', [int]$Port = 8011, [ValidateSet('cpu','cuda')][string]$Device = 'cuda')
$ErrorActionPreference = 'Stop'
$env:ASTROBONE_VISION_RUNTIME = $Runtime
$env:ASTROBONE_VISION_DEVICE = $Device
Set-Location (Split-Path $PSScriptRoot -Parent)
& (Join-Path $Runtime 'venv\Scripts\python.exe') -m uvicorn vision.app:app --host 127.0.0.1 --port $Port
