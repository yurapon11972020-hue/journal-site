$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$envPath = Join-Path $projectRoot '.env.local'
Write-Host 'Настройка публичных ссылок Яндекс.Диска. Остальные настройки сохранятся.'
Write-Host 'Введите ссылки по одной; пустая строка завершает ввод. Формат: Название = https://disk.yandex.ru/i/ВАША_ССЫЛКА'
$links = @()
while ($true) {
  $entry = Read-Host ('Ссылка ' + ($links.Count + 1))
  if ([string]::IsNullOrWhiteSpace($entry)) { break }
  $urlText = ($entry -replace '^.*?=\s*(?=https://)', '').Split('#')[0].Trim()
  $journalUri = $null
  if (-not [Uri]::TryCreate($urlText, [UriKind]::Absolute, [ref]$journalUri) -or $journalUri.Scheme -ne 'https' -or $journalUri.Host -notin @('disk.yandex.ru', 'disk.yandex.com', 'yadi.sk') -or $journalUri.UserInfo -or -not $journalUri.IsDefaultPort -or $journalUri.Query -or $journalUri.AbsolutePath -notmatch '^/(i|d)/[A-Za-z0-9_-]+/?$' -or $entry -match '["''$`\r\n]') {
    throw 'Нужна корректная HTTPS-ссылка Яндекс.Диска без дополнительных параметров.'
  }
  $links += $entry.Trim()
}
if (-not $links.Count) { Write-Host 'Ссылки не введены. Файл настроек не изменён.'; return }
$intervalText = Read-Host 'Интервал в минутах (30 по умолчанию)'
$interval = 30
if ($intervalText -and (-not [int]::TryParse($intervalText, [ref]$interval) -or $interval -lt 1)) { throw 'Интервал должен быть положительным целым числом.' }
$updates = [ordered]@{
  JOURNAL_SOURCE = 'yandex-public-cache'
  YANDEX_DISK_PUBLIC_URLS = '"' + [string]::Join(',', $links) + '"'
  JOURNAL_CACHE_INTERVAL_MINUTES = [string]$interval
}
$lines = if (Test-Path -LiteralPath $envPath) { @(Get-Content -LiteralPath $envPath) } else { @() }
foreach ($key in $updates.Keys) {
  $value = [string]$updates[$key]
  $pattern = '^\s*' + [regex]::Escape($key) + '\s*='
  $found = $false
  $lines = @($lines | ForEach-Object {
    if ($_ -match $pattern) {
      if (-not $found) { $key + '=' + $value; $found = $true }
    } else { $_ }
  })
  if (-not $found) { $lines += $key + '=' + $value }
}
[IO.File]::WriteAllLines($envPath, [string[]]$lines)
Write-Host 'Источник обновлён. Настройте групповые коды по README.md и перезапустите сервер.'
