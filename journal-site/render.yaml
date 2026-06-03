services:
  - type: web
    name: journal-site
    runtime: node
    plan: free
    buildCommand: npm install --package-lock=false --registry=https://registry.npmjs.org/ --no-audit --no-fund && npm run build
    startCommand: npm start
    autoDeploy: true
    envVars:
      - key: NODE_VERSION
        value: 20.11.1
      - key: NEXT_TELEMETRY_DISABLED
        value: "1"
      - key: JOURNAL_SOURCE
        value: yandex-public-cache
      - key: YANDEX_DISK_PUBLIC_URL
        value: https://disk.yandex.ru/i/sGTYC8nUWYAsRw
      - key: JOURNAL_CACHE_INTERVAL_MINUTES
        value: "30"
      - key: JOURNAL_CACHE_MAX_FILES
        value: "2"
      - key: JOURNAL_CACHE_DIR
        value: /tmp/journal-cache
