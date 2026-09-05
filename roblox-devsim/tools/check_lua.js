#!/usr/bin/env node
// Быстрая проверка синтаксиса Lua-файлов (без Studio).
// Запуск:  node roblox-devsim/tools/check_lua.js roblox-devsim/src
// Требует:  npm i luaparse   (или запускается через npx)
const fs = require("fs");
const path = require("path");

let luaparse;
try {
  luaparse = require("luaparse");
} catch (e) {
  console.error("Нет пакета luaparse. Установи: npm i luaparse");
  process.exit(2);
}

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (p.endsWith(".lua") || p.endsWith(".luau")) out.push(p);
  }
  return out;
}

const roots = process.argv.slice(2);
if (roots.length === 0) roots.push("roblox-devsim/src");

const files = [];
for (const r of roots) {
  const st = fs.statSync(r);
  if (st.isDirectory()) walk(r, files);
  else files.push(r);
}

let bad = 0;
for (const f of files.sort()) {
  const src = fs.readFileSync(f, "utf8");
  try {
    luaparse.parse(src, { luaVersion: "5.1", comments: false });
    console.log("ok   " + f);
  } catch (err) {
    bad++;
    console.log("FAIL " + f + "  ->  " + err.message);
  }
}
console.log("\n" + (files.length - bad) + "/" + files.length + " файлов без ошибок синтаксиса");
process.exit(bad === 0 ? 0 : 1);
