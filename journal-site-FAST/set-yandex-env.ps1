$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$envPath = Join-Path $projectRoot ".env.local"

Write-Host "Настройка публичной ссылки Яндекс.Диска без OAuth-токена" -ForegroundColor Cyan
$link = Read-Host "Публичная ссылка на Excel-файл"

if ([string]::IsNullOrWhiteSpace($link)) {
  $link = "https://disk.yandex.ru/i/sGTYC8nUWYAsRw"
}

$minutes = Read-Host "Интервал обновления в минутах (по умолчанию 30)"
if ([string]::IsNullOrWhiteSpace($minutes)) {
  $minutes = "30"
}

$maxFiles = Read-Host "Сколько последних версий хранить (по умолчанию 2)"
if ([string]::IsNullOrWhiteSpace($maxFiles)) {
  $maxFiles = "2"
}

@"
JOURNAL_SOURCE=yandex-public-cache
YANDEX_DISK_PUBLIC_URL=$link
YANDEX_DISK_PUBLIC_PATH=
JOURNAL_CACHE_INTERVAL_MINUTES=$minutes
JOURNAL_CACHE_MAX_FILES=$maxFiles
JOURNAL_CACHE_DIR=./.journal-cache
"@ | Set-Content -Path $envPath -Encoding UTF8

Write-Host "Готово: создан файл .env.local" -ForegroundColor Green
Write-Host "Теперь можно запускать: npm run dev" -ForegroundColor Yellow
