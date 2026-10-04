$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$linuxRoot = (wsl -d Ubuntu-24.04 -- wslpath -a $root).Trim()
wsl -d Ubuntu-24.04 -- bash "$linuxRoot/scripts/start-densepose-wsl.sh"
