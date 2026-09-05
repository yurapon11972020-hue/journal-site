# Собрать игру одной командой (Windows PowerShell).
# Правый клик по файлу -> "Выполнить с помощью PowerShell".
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command python3 -ErrorAction SilentlyContinue }
if (-not $python) {
    Write-Host "Не найден Python. Скачай его тут: https://www.python.org/downloads/ (галочка 'Add to PATH')" -ForegroundColor Red
    Read-Host "Enter — закрыть"
    exit 1
}

& $python.Source "roblox-devsim/tools/build_place.py" @args
Write-Host ""
Write-Host "Файл лежит в roblox-devsim/build/DevSim.rbxlx — открой его в Roblox Studio." -ForegroundColor Green
Read-Host "Enter — закрыть"
