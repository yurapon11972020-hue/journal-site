$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$envPath = Join-Path $projectRoot ".env.local"

Write-Host "Настройка публичных ссылок Яндекс.Диска (без OAuth-токена)" -ForegroundColor Cyan
Write-Host "Вводи ссылки по одной. Пустая строка — закончить ввод." -ForegroundColor Gray
Write-Host "Можно дать группе своё имя: ИСиП-25/9 = https://disk.yandex.ru/i/ССЫЛКА" -ForegroundColor Gray
Write-Host "Ссылка на папку (/d/...) сама развернётся во все Excel-файлы внутри." -ForegroundColor Gray

$links = @()
while ($true) {
  $index = $links.Count + 1
  $link = Read-Host "Ссылка $index"
  if ([string]::IsNullOrWhiteSpace($link)) { break }
  $links += $link.Trim()
}

if ($links.Count -eq 0) {
  $links = @("https://disk.yandex.ru/i/jr0lr00cUQp0FQ", "https://disk.yandex.ru/i/QZZ5ghsJ_w7xAg", "https://disk.yandex.ru/i/ezTOIqg1oAictA")
  Write-Host "Ссылки не введены, беру ссылки журналов по умолчанию." -ForegroundColor Yellow
}

$minutes = Read-Host "Интервал обновления в минутах (по умолчанию 30)"
if ([string]::IsNullOrWhiteSpace($minutes)) {
  $minutes = "30"
}

$maxFiles = Read-Host "Сколько последних версий хранить на каждую группу (по умолчанию 2)"
if ([string]::IsNullOrWhiteSpace($maxFiles)) {
  $maxFiles = "2"
}

$joinedLinks = [string]::Join(",", $links)

@"
JOURNAL_SOURCE=yandex-public-cache
YANDEX_DISK_PUBLIC_URLS=$joinedLinks
JOURNAL_CACHE_INTERVAL_MINUTES=$minutes
JOURNAL_CACHE_MAX_FILES=$maxFiles
JOURNAL_CACHE_DIR=./.journal-cache
JOURNAL_REFRESH_FROM_HOUR=5
JOURNAL_REFRESH_TO_HOUR=24
JOURNAL_TIMEZONE_OFFSET_HOURS=5
"@ | Set-Content -Path $envPath -Encoding UTF8

Write-Host "Готово: создан файл .env.local с $($links.Count) ссылкой(ами)" -ForegroundColor Green
Write-Host "Теперь можно запускать: npm run dev" -ForegroundColor Yellow
