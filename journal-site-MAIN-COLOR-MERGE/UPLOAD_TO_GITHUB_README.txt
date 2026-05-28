ВАЖНО ДЛЯ GITHUB:
1. Распакуй этот ZIP.
2. Открой папку journal-site-FULLY-FIXED.
3. На GitHub загружай ВСЕ файлы и папки ИЗНУТРИ этой папки, а не сам ZIP.
4. В репозитории должны быть папки app, components, data, lib.
5. После загрузки нажми Commit changes.
6. Потом в Render нажми Manual Deploy -> Deploy latest commit.

Render environment variables:
NODE_VERSION=24.14.1
NEXT_TELEMETRY_DISABLED=1
JOURNAL_SOURCE=yandex-public-cache
YANDEX_DISK_PUBLIC_URL=https://disk.yandex.ru/i/sGTYC8nUWYAsRw
JOURNAL_CACHE_INTERVAL_MINUTES=30
JOURNAL_CACHE_MAX_FILES=2
JOURNAL_CACHE_DIR=/tmp/journal-cache

YANDEX_DISK_PUBLIC_PATH не добавляй. Если уже есть, удали.
