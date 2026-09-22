#!/usr/bin/env node
/**
 * Подготовка проекта на новом компьютере: `npm run setup`.
 *
 * Делает ровно то, что руками делать скучно и легко забыть, —
 * создаёт .env.local из шаблона и говорит, чего не хватает.
 * Ничего не перезаписывает: если .env.local уже есть, он остаётся как есть.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envLocal = path.join(root, '.env.local');
const envExample = path.join(root, '.env.example');

const MIN_NODE_MAJOR = 20;
const MIN_NODE_MINOR = 9;

/** Секреты: в репозитории их нет, вписываются руками. */
const SECRETS = [
  ['TELEGRAM_BOT_TOKEN', 'токен бота от @BotFather — нужен, только если поднимаешь бота локально'],
  ['TELEGRAM_WEBHOOK_SECRET', 'любая своя строка из латиницы, цифр, дефиса и подчёркивания'],
  ['DATABASE_URL', 'строка подключения к Postgres (Neon) — без неё подписки живут только в памяти'],
];

function checkNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  const tooOld = major < MIN_NODE_MAJOR || (major === MIN_NODE_MAJOR && minor < MIN_NODE_MINOR);

  if (tooOld) {
    console.log(`✗ Node.js ${process.versions.node} — нужен ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}+`);
    console.log('  Поставь свежий с https://nodejs.org и запусти setup заново.');
    return false;
  }

  console.log(`✓ Node.js ${process.versions.node}`);
  return true;
}

function prepareEnv() {
  if (fs.existsSync(envLocal)) {
    console.log('✓ .env.local уже есть — не трогаю');
    return fs.readFileSync(envLocal, 'utf8');
  }

  if (!fs.existsSync(envExample)) {
    console.log('✗ Нет .env.example — репозиторий склонирован не полностью');
    return null;
  }

  const template = fs.readFileSync(envExample, 'utf8');
  fs.writeFileSync(envLocal, template, 'utf8');
  console.log('✓ Создал .env.local из .env.example');
  return template;
}

/** Задана ли переменная: строка без комментария и с непустым значением. */
function isFilled(env, name) {
  const line = env.split('\n').find((row) => row.trim().startsWith(`${name}=`));
  return Boolean(line && line.slice(line.indexOf('=') + 1).trim());
}

console.log('Подготовка journal-site\n');

if (!checkNode()) {
  process.exit(1);
}

if (!fs.existsSync(path.join(root, 'node_modules'))) {
  console.log('• Зависимости не установлены — выполни: npm install');
}

const env = prepareEnv();

if (env) {
  const links = env.split('\n').find((row) => row.trim().startsWith('YANDEX_DISK_PUBLIC_URLS='));
  const count = links ? links.split('=').slice(1).join('=').split(',').filter(Boolean).length : 0;
  console.log(`✓ Групп в YANDEX_DISK_PUBLIC_URLS: ${count}`);

  const missing = SECRETS.filter(([name]) => !isFilled(env, name));

  if (missing.length) {
    console.log('\nНе заданы (сайт и журнал работают и без них):');
    for (const [name, hint] of missing) {
      console.log(`  ${name} — ${hint}`);
    }
    console.log('\nНа Render эти же переменные живут в Environment, а не в файле.');
  }
}

console.log('\nДальше:');
console.log('  npm install   — если ещё не ставил');
console.log('  npm run dev   — сайт на http://localhost:3000');
console.log('  npm run check — типы, линтер и тесты');
