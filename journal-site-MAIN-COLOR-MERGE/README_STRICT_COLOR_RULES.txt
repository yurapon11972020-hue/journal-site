Обновление STRICT COLOR RULES

Что изменено:
- Цвет получает только настоящая оценка 1-5, средний балл, Н, Н/У, ЭН/Э/Н.
- Н/ОТР и Н/У/ОТР не окрашиваются.
- Зачёт, нет оценок, освобождение, отработка и любые другие текстовые примечания не окрашиваются.
- Убрано окрашивание по случайной цифре внутри текста: строка с текстом и цифрой больше не считается оценкой.
- Логика определения отметок вынесена в lib/mark-classifier.ts, чтобы условия было проще поддерживать.

Render:
Root Directory: journal-site-MAIN-STRICT-COLOR-RULES
Build Command: npm install --package-lock=false --registry=https://registry.npmjs.org/ --no-audit --no-fund && npm run build
Start Command: npm start
