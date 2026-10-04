param([string]$Runtime = 'E:\AstroBoneRuntime\vision', [switch]$Gpu)
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$Python = Join-Path $Runtime 'venv\Scripts\python.exe'
New-Item -ItemType Directory -Force -Path $Runtime | Out-Null
if (-not (Test-Path -LiteralPath $Python)) {
    & (Join-Path $Root '.venv-companion\Scripts\python.exe') -m venv (Join-Path $Runtime 'venv')
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 environment creation failed' }
}
$env:PIP_CACHE_DIR = Join-Path $Runtime 'pip-cache'
$env:TEMP = Join-Path $Runtime 'tmp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
$env:PIP_DEFAULT_TIMEOUT = '180'
$env:PIP_RETRIES = '5'
& $Python -m pip install 'torch==2.8.0' --index-url https://download.pytorch.org/whl/cpu
if ($LASTEXITCODE -ne 0) { throw 'PyTorch installation failed' }
& $Python -m pip install 'numpy>=1.26,<3' 'onnxruntime==1.23.2' 'opencv-python==4.12.0.88' 'tqdm>=4,<5' 'mhr==1.0.1' 'pymomentum-cpu==0.1.114.post0' 'fastapi>=0.115,<1' 'uvicorn>=0.30,<1'
if ($LASTEXITCODE -ne 0) { throw 'Vision dependencies failed' }
& $Python -m pip install --no-deps 'rtmlib==0.0.16'
if ($LASTEXITCODE -ne 0) { throw 'RTMLib installation failed' }
if ($Gpu) {
    & $Python -m pip uninstall -y onnxruntime
    & $Python -m pip install 'onnxruntime-gpu[cuda,cudnn]==1.23.2'
    if ($LASTEXITCODE -ne 0) { throw 'CUDA runtime installation failed' }
}
& $Python (Join-Path $PSScriptRoot 'prepare-vision-models.py') --runtime $Runtime
if ($LASTEXITCODE -ne 0) { throw 'Model preparation failed' }
Write-Host "Ready. Run scripts\start-local-vision.ps1 -Runtime '$Runtime'"
