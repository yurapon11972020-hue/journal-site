Быстрая версия:
- удалены package-lock.json и .npmrc, чтобы Render качал пакеты с обычного npm;
- добавлен кэш распарсенного Excel в памяти сервера;
- при открытии главной страницы журнал заранее подготавливается в фоне;
- добавлен экран загрузки для страницы группы.

Render:
Root Directory: journal-site-FAST
Build Command: npm install --package-lock=false --registry=https://registry.npmjs.org/ --no-audit --no-fund && npm run build
Start Command: npm start
NODE_VERSION=20.11.1
