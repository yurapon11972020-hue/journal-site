# Journal Site

Проект на **Next.js**, который читает Excel-журнал на сервере, преобразует его в данные для сайта и показывает журнал в браузере.

Главный режим сейчас — **публичная ссылка Яндекс.Диска без OAuth-токена**:

1. сервер скачивает Excel с Яндекс.Диска в локальный кэш;
2. сайт читает уже скачанный локальный файл;
3. каждые 30 минут сервер скачивает новую копию;
4. старые копии удаляются, чтобы не забивать память;
5. после перезапуска непостоянного сервера, например Render, файл снова скачивается при старте или первом запросе.

## 1. Что нужно для запуска

- Node.js **20.9+**
- npm

## 2. Установка

```bash
npm install
```

## 3. Быстрый старт на локалке

В проекте уже есть `.env.local` с публичной ссылкой:

```env
JOURNAL_SOURCE=yandex-public-cache
YANDEX_DISK_PUBLIC_URL=https://disk.yandex.ru/i/sGTYC8nUWYAsRw
YANDEX_DISK_PUBLIC_PATH=
JOURNAL_CACHE_INTERVAL_MINUTES=30
JOURNAL_CACHE_MAX_FILES=2
JOURNAL_CACHE_DIR=./.journal-cache
```

Запуск:

```bash
npm run dev
```

Сайт откроется на:

```text
http://localhost:3000
```

JSON API:

```text
http://localhost:3000/api/journal
```

## 4. Как работает кэш журнала

Режим `yandex-public-cache` делает так:

- при запуске сервера Next.js пытается скачать Excel в папку `.journal-cache`;
- если сервер стартовал, но стартовая загрузка не сработала, первый запрос к сайту всё равно скачает файл;
- после этого каждые `JOURNAL_CACHE_INTERVAL_MINUTES` минут скачивается новая копия;
- сайт всегда читает последнюю скачанную копию;
- `JOURNAL_CACHE_MAX_FILES=2` означает: когда появилась 3-я копия, 1-я удаляется; когда появилась 4-я, удаляется 2-я.

Для Render можно оставить так, либо поставить кэш в `/tmp`:

```env
JOURNAL_CACHE_DIR=/tmp/journal-cache
```

Важно: Render без постоянного диска очищает файлы после перезапуска сервера. Это нормально: при новом старте журнал снова скачается с Яндекс.Диска.

## 5. Режим без интернета для тестов

Если нужно временно работать только с локальным файлом:

```env
JOURNAL_SOURCE=local
JOURNAL_LOCAL_PATH=./data/journal.xlsx
```

## 6. Старый приватный режим с OAuth-токеном

Он оставлен в коде, но для новой ссылки не нужен.

```env
JOURNAL_SOURCE=yandex-private
YANDEX_DISK_OAUTH_TOKEN=твой_токен
YANDEX_DISK_PATH=disk:/путь/к/файлу.xlsx
```

## 7. GitHub

В GitHub нужно отправлять код, но не нужно отправлять:

- `node_modules`
- `.next`
- `.env.local`
- `.journal-cache`

Они уже указаны в `.gitignore`.

Для GitHub можно хранить только `.env.example`, а реальные переменные задавать локально или в настройках Render.

## 8. Render

Build command:

```bash
npm install && npm run build
```

Start command:

```bash
npm run start
```

Environment variables на Render:

```env
JOURNAL_SOURCE=yandex-public-cache
YANDEX_DISK_PUBLIC_URL=https://disk.yandex.ru/i/sGTYC8nUWYAsRw
YANDEX_DISK_PUBLIC_PATH=
JOURNAL_CACHE_INTERVAL_MINUTES=30
JOURNAL_CACHE_MAX_FILES=2
JOURNAL_CACHE_DIR=/tmp/journal-cache
```

## 9. Что уже реализовано

- серверное чтение `.xlsx`;
- скачивание публичного файла Яндекс.Диска без токена;
- локальный кэш Excel-файла;
- автообновление кэша каждые 30 минут;
- удаление старых версий кэша;
- автоматический разбор предметных листов;
- определение списка студентов;
- подсчет среднего балла по каждому предмету;
- подсчет пропусков `н` и `н/у`;
- API маршрут `/api/journal`;
- страница выбора группы;
- страница журнала группы;
- режим карточки студента и рейтинг группы.

## 10. Безопасность

Для публичной ссылки OAuth-токен не используется. Достаточно, чтобы Excel-файл был доступен по ссылке на Яндекс.Диске.

Если когда-нибудь снова включишь приватный режим, токен должен храниться только в `.env.local` или в переменных окружения Render. Его нельзя вставлять во frontend-код и нельзя коммитить в GitHub.

## Если `npm install` упал с `Exit handler never called!`

Это ошибка npm или повреждённого кэша/lock-файла, а не ошибка кода проекта. На Windows можно выполнить из папки проекта:

```powershell
node -v
npm -v
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue
npm cache clean --force
npm install --registry=https://registry.npmjs.org/
npm run dev
```

Если снова появляется `Exit handler never called!`, обнови npm и повтори установку:

```powershell
npm install -g npm@latest
npm install --registry=https://registry.npmjs.org/
npm run dev
```

Для этого проекта желательно использовать Node.js 20.9 или новее.

## Быстрая публикация на GitHub и Render

В проект добавлен `render.yaml`, поэтому его можно публиковать на Render как Web Service или через Blueprint.

Команды для GitHub:

```powershell
git init
git add .
git commit -m "Initial journal site deploy"
git branch -M main
git remote add origin https://github.com/ТВОЙ-ЛОГИН/journal-site.git
git push -u origin main
```

Настройки Render Web Service:

- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Environment variables уже описаны в `render.yaml` и `DEPLOY_GITHUB_RENDER.md`.

Подробная инструкция: см. `DEPLOY_GITHUB_RENDER.md`.


## Обновление: строгие правила цветов

Цветом выделяются только настоящие оценки, средний балл и точные отметки Н/НУ/ЭН.
Служебные записи вроде Н/ОТР, Н/У/ОТР, «Нет оценок», «Зачет» и любые произвольные надписи остаются без цветной заливки.
