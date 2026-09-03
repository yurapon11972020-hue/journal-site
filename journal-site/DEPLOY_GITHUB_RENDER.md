# Публикация проекта на GitHub и Render

Этот проект рассчитан на Render Web Service, потому что ему нужен сервер: приложение скачивает Excel с публичной ссылки Яндекс.Диска, хранит локальный кэш и обновляет файл каждые 30 минут.

## 1. Проверка локально

```powershell
npm install --registry=https://registry.npmjs.org/
npm run dev
```

Открой:

```text
http://localhost:3000
```

## 2. Загрузка на GitHub

Создай пустой репозиторий на GitHub, например `journal-site`.

Потом в PowerShell в папке проекта выполни:

```powershell
git init
git add .
git commit -m "Initial journal site deploy"
git branch -M main
git remote add origin https://github.com/ТВОЙ-ЛОГИН/journal-site.git
git push -u origin main
```

Файл `.env.local` не попадёт в GitHub, потому что он указан в `.gitignore`.

## 3. Публикация на Render через обычный Web Service

1. Зайди на Render.
2. Нажми **New** → **Web Service**.
3. Подключи GitHub и выбери репозиторий `journal-site`.
4. Выставь настройки:

| Настройка | Значение |
|---|---|
| Runtime / Language | Node |
| Root Directory | оставь пустым (корень репозитория) |
| Build Command | `npm install && npm run build` |
| Start Command | `npm start` |
| Instance Type | Free или любой платный |

5. В Environment добавь переменные:

```env
NODE_VERSION=20.11.1
NEXT_TELEMETRY_DISABLED=1
JOURNAL_SOURCE=yandex-public-cache
YANDEX_DISK_PUBLIC_URLS=https://disk.yandex.ru/i/jr0lr00cUQp0FQ,https://disk.yandex.ru/i/QZZ5ghsJ_w7xAg
JOURNAL_CACHE_INTERVAL_MINUTES=30
JOURNAL_CACHE_MAX_FILES=2
JOURNAL_CACHE_DIR=/tmp/journal-cache
```

`YANDEX_DISK_PUBLIC_URLS` — список групп. Несколько ссылок разделяются запятой или переносом строки,
ссылка на папку разворачивается во все Excel-файлы внутри.
Как добавлять группы и что проверять — в [`SETUP_GROUPS.md`](./SETUP_GROUPS.md).

6. Нажми **Create Web Service**.

После успешной сборки сайт будет доступен по адресу вида:

```text
https://journal-site.onrender.com
```

## 4. Публикация на Render через Blueprint

В проект уже добавлен файл `render.yaml`. Если хочешь использовать его:

1. На Render открой **Blueprints**.
2. Нажми **New Blueprint Instance**.
3. Выбери этот GitHub-репозиторий.
4. Render прочитает настройки из `render.yaml`.
5. Нажми **Deploy Blueprint**.

## 5. Как будут обновляться журналы

- При старте сервера скачивается актуальный Excel.
- Потом сервер скачивает новую копию раз в 30 минут.
- В кэше хранится только 2 последних файла.
- На бесплатном Render сервис может засыпать. Когда кто-то снова откроет сайт, сервер проснётся и заново скачает свежий Excel.

## 6. Если Render выдаст ошибку

Смотри вкладку **Logs** в Render. Самые частые причины:

- Яндекс.Диск-ссылка не публичная.
- На Яндекс.Диске файл был удалён или заменён на непохожий формат.
- `npm install` не смог поставить зависимости.
- Используется не та версия Node.js.
