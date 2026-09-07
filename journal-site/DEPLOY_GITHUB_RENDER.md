# Развёртывание на Render

Сначала выполните npm ci, npm run check, npm run build. В репозиторий включайте package-lock.json; не включайте .env.local, data, .test-data, .journal-cache, node_modules или .next.

Используйте render.yaml: Node 24, Build Command «npm ci && npm run build», Start Command «npm start». На Render задайте собственные YANDEX_DISK_PUBLIC_URLS, JOURNAL_GROUP_ACCESS_CODES, JOURNAL_SESSION_SECRET и PUBLIC_SITE_URL. Пустая конфигурация доступа закрывает журнал.

PUBLIC_SITE_URL — фактический https-адрес сервиса. Для одной группы вместо карты кодов можно задать JOURNAL_ACCESS_CODE. Операторский JOURNAL_ADMIN_CODE необязателен. Настройки Telegram см. TELEGRAM_BOT.md.

Кэш /tmp/journal-cache не переживает очистку/перезапуск непостоянного инстанса. Для сохранения snapshots после рестарта нужен постоянный диск. Текущие блокировки и rate limits работают внутри одного процесса; при нескольких репликах требуется общее состояние.

В этой работе публикация и изменение внешнего сервиса не выполнялись. Обновлённый архив предназначен для существующей установки Next.js/Render.
